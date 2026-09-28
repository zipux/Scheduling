import "server-only";
import { z } from "zod";
import { tenantDb, type TenantDb } from "@/server/db/tenant";
import { env } from "@/lib/env";
import { pinDigest, timingSafeEqualHex } from "@/lib/crypto";
import {
  evaluateGeofence,
  isEarlyLeave,
  isLate,
  isMissingClockOut,
  matchShiftForClockIn,
  offlineSkewOk,
  PIN_LOCK_MINUTES,
  PIN_MAX_ATTEMPTS,
  roundPunch,
  type GeofenceOverride,
  type PunchPosition,
  type ShiftCandidate,
} from "@/lib/clock";
import type { TimeFlag } from "@/lib/time-flags";
import { parsePermissions } from "@/lib/permissions";
import { checkBreaks } from "./break-check";

/**
 * Punching (§7.1–§7.3). Shared by the personal clock (session + PIN) and kiosk
 * devices (device token + PIN). Everything is decided server-side.
 */

export class ClockError extends Error {
  constructor(
    public code:
      | "NO_ACCESS"
      | "PIN_WRONG"
      | "PIN_LOCKED"
      | "PIN_NOT_SET"
      | "ALREADY_IN"
      | "NOT_IN"
      | "ON_BREAK"
      | "NOT_ON_BREAK"
      | "TOO_EARLY"
      | "UNSCHEDULED_NOT_ALLOWED"
      | "NEEDS_PREVIOUS_FINISH"
      | "GEO_NO_POSITION"
      | "GEO_OUTSIDE"
      | "SKEW"
      | "MODE_DISABLED",
    message: string,
    public detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ClockError";
  }
}

export type PunchAction = "in" | "break_start" | "break_end" | "out";

export const punchSchema = z.object({
  action: z.enum(["in", "break_start", "break_end", "out"]),
  pin: z.string().regex(/^\d{4,6}$/).optional(),
  position: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100_000) }).nullable().optional(),
  locationId: z.string().min(1).optional(),
});

export interface PunchActor {
  businessId: string;
  membershipId: string;
  source: "personal" | "kiosk";
  kioskDeviceId?: string;
  kioskLocationId?: string;
}

export interface PunchOptions {
  /** Offline-queued punch: the device's clock at punch time (§7.1). */
  deviceTime?: Date;
  /**
   * The PIN was already verified by the caller (kiosk ticket), or this is an
   * offline personal punch authenticated by the session at sync time.
   */
  skipPin?: boolean;
  now?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// PIN (§7.1): HMAC per membership, 5 wrong attempts → locked 5 minutes, all logged.
// ─────────────────────────────────────────────────────────────────────────────

export async function verifyPin(db: TenantDb, membershipId: string, pin: string | undefined, source: string, kioskDeviceId?: string, now = new Date()) {
  const profile = await db.employeeProfile.findUnique({ where: { membershipId } });
  if (!profile?.pinHmac) throw new ClockError("PIN_NOT_SET", "No PIN is set. Set one from the app first.");
  if (profile.pinLockedUntil && profile.pinLockedUntil > now) {
    // Attempts while locked are logged too; they don't extend the lock.
    await db.pinAttempt.create({ data: { membershipId, success: false, source, kioskDeviceId: kioskDeviceId ?? null } as never });
    throw new ClockError("PIN_LOCKED", "Too many wrong PINs. Try again in a few minutes.", { until: profile.pinLockedUntil.toISOString() });
  }
  const ok = !!pin && timingSafeEqualHex(await pinDigest(env().PIN_HMAC_SECRET, membershipId, pin), profile.pinHmac);
  await db.pinAttempt.create({ data: { membershipId, success: ok, source, kioskDeviceId: kioskDeviceId ?? null } as never });
  if (ok) {
    if (profile.pinFailedAttempts) await db.employeeProfile.update({ where: { membershipId }, data: { pinFailedAttempts: 0, pinLockedUntil: null } });
    return;
  }
  const attempts = profile.pinFailedAttempts + 1;
  const lock = attempts >= PIN_MAX_ATTEMPTS;
  await db.employeeProfile.update({
    where: { membershipId },
    data: { pinFailedAttempts: lock ? 0 : attempts, pinLockedUntil: lock ? new Date(now.getTime() + PIN_LOCK_MINUTES * 60_000) : null },
  });
  if (lock) throw new ClockError("PIN_LOCKED", `Too many wrong PINs. Locked for ${PIN_LOCK_MINUTES} minutes.`);
  throw new ClockError("PIN_WRONG", "That PIN isn't right.", { remaining: PIN_MAX_ATTEMPTS - attempts });
}

// ─────────────────────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────────────────────

export async function openEntryFor(db: TenantDb, membershipId: string) {
  return db.timeEntry.findFirst({
    where: { membershipId, clockOut: null, NOT: { clockIn: null } },
    orderBy: { clockIn: "desc" },
    include: { breaks: { orderBy: { startsAt: "asc" } }, flags: true },
  });
}

export async function clockStatus(businessId: string, membershipId: string, now = new Date()) {
  const db = tenantDb(businessId);
  const business = await db.business.findUniqueOrThrow({ where: { id: businessId } });
  await raiseMissingClockOuts(businessId, now);
  const open = await openEntryFor(db, membershipId);
  const stale = open && isMissingClockOut(open, now, business.maxShiftHours) ? open : null;
  const answered = stale ? await db.correctionRequest.findFirst({ where: { timeEntryId: stale.id, status: "pending" } }) : null;
  return {
    open: stale ? null : open,
    onBreak: !stale && !!open?.breaks.some((b) => !b.endsAt),
    // §7.3.3: the previous shift's finish time must be answered before clocking in again.
    needsPreviousFinish: stale && !answered ? { entryId: stale.id, clockIn: stale.clockIn! } : null,
    staleAnswered: !!answered,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Punch
// ─────────────────────────────────────────────────────────────────────────────

async function shiftCandidates(db: TenantDb, membershipId: string, now: Date): Promise<ShiftCandidate[]> {
  const rows = await db.shift.findMany({
    where: {
      membershipId,
      status: "published",
      deletedAt: null,
      startsAt: { lte: new Date(now.getTime() + 13 * 3600_000) },
      endsAt: { gte: new Date(now.getTime() - 3600_000) },
    },
  });
  return rows.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, locationId: s.locationId, positionId: s.positionId, geofenceOverride: (s.geofenceOverride as GeofenceOverride) ?? null }));
}

export async function punch(actor: PunchActor, input: z.infer<typeof punchSchema>, opts: PunchOptions = {}) {
  const db = tenantDb(actor.businessId);
  const serverTime = opts.now ?? new Date();
  const business = await db.business.findUniqueOrThrow({ where: { id: actor.businessId } });
  if (actor.source === "personal" && !business.clockModePersonal) throw new ClockError("MODE_DISABLED", "Clocking in on your own phone is turned off here. Use the kiosk.");
  if (actor.source === "kiosk" && !business.clockModeKiosk) throw new ClockError("MODE_DISABLED", "Kiosk mode is turned off.");

  const m = await db.membership.findUnique({ where: { id: actor.membershipId }, include: { locations: true } });
  if (!m || m.status !== "active" || m.accessRevokedAt) throw new ClockError("NO_ACCESS", "This person can't clock in here.");

  const offline = !!opts.deviceTime;
  if (offline && !offlineSkewOk(opts.deviceTime!, serverTime, business.maxClockSkewMinutes)) {
    throw new ClockError("SKEW", "This punch's device time is too far ahead of the server's clock.");
  }
  if (!opts.skipPin) await verifyPin(db, actor.membershipId, input.pin, actor.source, actor.kioskDeviceId, serverTime);

  const t = opts.deviceTime ?? serverTime;
  const source = offline ? "offline" : actor.source;
  const baseFlags: TimeFlag[] = offline ? ["OFFLINE_QUEUED"] : [];
  const open = await openEntryFor(db, actor.membershipId);

  const geoFor = async (locationId: string, override: GeofenceOverride) => {
    const loc = await db.location.findUniqueOrThrow({ where: { id: locationId } });
    const g = evaluateGeofence({
      source: actor.source === "kiosk" ? "kiosk" : offline ? "offline" : "personal",
      location: { mode: loc.geofenceMode, lat: loc.lat, lng: loc.lng, radiusM: loc.radiusM },
      override,
      position: (input.position as PunchPosition | null | undefined) ?? null,
    });
    if (!g.accept) {
      if (g.refuseReason === "NO_POSITION") {
        throw new ClockError("GEO_NO_POSITION", "This location needs your position to clock in. Allow location access for this site in your browser settings, then try again.");
      }
      throw new ClockError("GEO_OUTSIDE", `You're about ${Math.round(g.distanceM ?? 0)} m from ${loc.name}. Move closer to clock in.`, { distanceM: g.distanceM });
    }
    return g;
  };

  const addFlags = async (entryId: string, flags: { type: TimeFlag; detail?: object }[]) => {
    for (const f of flags) await db.timeEntryFlag.create({ data: { timeEntryId: entryId, type: f.type, detail: (f.detail ?? undefined) as never } as never });
  };

  const pos = input.position ?? null;

  if (input.action === "in") {
    if (open) {
      if (isMissingClockOut(open, serverTime, business.maxShiftHours)) {
        const answered = await db.correctionRequest.findFirst({ where: { timeEntryId: open.id, status: "pending" } });
        if (!answered) throw new ClockError("NEEDS_PREVIOUS_FINISH", "When did your last shift finish? Answer that first.", { entryId: open.id, clockIn: open.clockIn!.toISOString() });
      } else {
        throw new ClockError("ALREADY_IN", "You're already clocked in.");
      }
    }
    const match = matchShiftForClockIn(await shiftCandidates(db, actor.membershipId, t), t, business.earlyClockInMinutes);
    if (match.kind === "too_early" && !offline) {
      throw new ClockError("TOO_EARLY", `Your shift starts at ${match.shift.startsAt.toISOString()}. You can clock in from ${match.allowedFrom.toISOString()}.`, {
        allowedFrom: match.allowedFrom.toISOString(),
      });
    }
    const shift = match.kind === "shift" ? match.shift : null;
    if (!shift && !business.allowUnscheduledClockIn) throw new ClockError("UNSCHEDULED_NOT_ALLOWED", "You don't have a shift now, and unscheduled clock-ins aren't allowed here.");
    const locationId = shift?.locationId ?? actor.kioskLocationId ?? (input.locationId && m.locations.some((l) => l.locationId === input.locationId) ? input.locationId : m.locations[0]?.locationId);
    if (!locationId) throw new ClockError("NO_ACCESS", "You aren't assigned to a location.");
    // At a kiosk the entry records the kiosk's location (where they actually are).
    const g = await geoFor(actor.kioskLocationId ?? locationId, shift?.geofenceOverride ?? null);
    const flags: { type: TimeFlag; detail?: object }[] = [
      ...baseFlags.map((type) => ({ type, detail: { deviceTime: t.toISOString(), serverTime: serverTime.toISOString() } })),
      ...g.flags.map((type) => ({ type, detail: { distanceM: g.distanceM ?? null, accuracy: pos?.accuracy ?? null, lat: pos?.lat ?? null, lng: pos?.lng ?? null } })),
    ];
    if (!shift) flags.push({ type: "UNSCHEDULED" });
    else if (isLate(t, shift, business.lateToleranceMinutes)) flags.push({ type: "LATE", detail: { minutes: Math.round((t.getTime() - shift.startsAt.getTime()) / 60_000) } });
    const entry = await db.timeEntry.create({
      data: {
        membershipId: actor.membershipId,
        locationId: actor.kioskLocationId ?? locationId,
        shiftId: shift?.id ?? null,
        positionId: shift?.positionId ?? null,
        clockIn: t,
        clockInRounded: roundPunch(t, "in", business.roundingMode, business.roundingIntervalMinutes),
        inLat: pos?.lat ?? null,
        inLng: pos?.lng ?? null,
        inAccuracy: pos?.accuracy ?? null,
        source,
        inDeviceTime: offline ? t : null,
        inServerTime: serverTime,
        kioskDeviceId: actor.kioskDeviceId ?? null,
      } as never,
    });
    await addFlags(entry.id, flags);
    return { entryId: entry.id, action: "in" as const, at: t, flags: flags.map((f) => f.type) };
  }

  if (input.action === "break_start" || input.action === "break_end") {
    if (!open) throw new ClockError("NOT_IN", "You're not clocked in.");
    const openBreak = open.breaks.find((b) => !b.endsAt);
    if (input.action === "break_start") {
      if (openBreak) throw new ClockError("ON_BREAK", "You're already on a break.");
      await db.breakEntry.create({ data: { timeEntryId: open.id, startsAt: t } as never });
    } else {
      if (!openBreak) throw new ClockError("NOT_ON_BREAK", "You're not on a break.");
      await db.breakEntry.update({ where: { id: openBreak.id }, data: { endsAt: t } });
    }
    if (offline) await addFlags(open.id, [{ type: "OFFLINE_QUEUED", detail: { action: input.action, deviceTime: t.toISOString(), serverTime: serverTime.toISOString() } }]);
    return { entryId: open.id, action: input.action, at: t, flags: baseFlags };
  }

  // Clock out.
  if (!open || isMissingClockOut(open, serverTime, business.maxShiftHours)) {
    // §7.3: a clock-out with no clock-in — never invent the start.
    const locationId = actor.kioskLocationId ?? (input.locationId && m.locations.some((l) => l.locationId === input.locationId) ? input.locationId : m.locations[0]?.locationId);
    if (!locationId) throw new ClockError("NO_ACCESS", "You aren't assigned to a location.");
    const g = await geoFor(locationId, null);
    const entry = await db.timeEntry.create({
      data: {
        membershipId: actor.membershipId,
        locationId,
        clockIn: null,
        clockOut: t,
        clockOutRounded: roundPunch(t, "out", business.roundingMode, business.roundingIntervalMinutes),
        outLat: pos?.lat ?? null,
        outLng: pos?.lng ?? null,
        outAccuracy: pos?.accuracy ?? null,
        source,
        outDeviceTime: offline ? t : null,
        outServerTime: serverTime,
        kioskDeviceId: actor.kioskDeviceId ?? null,
      } as never,
    });
    const flags: { type: TimeFlag; detail?: object }[] = [{ type: "MISSING_CLOCK_IN" }, ...baseFlags.map((type) => ({ type })), ...g.flags.map((type) => ({ type, detail: { distanceM: g.distanceM ?? null } }))];
    await addFlags(entry.id, flags);
    await notifyTimeManagers(db, actor.membershipId, "Missing clock-in", "A clock-out was recorded with no matching clock-in.");
    return { entryId: entry.id, action: "out" as const, at: t, flags: flags.map((f) => f.type) };
  }

  const shift = open.shiftId ? await db.shift.findUnique({ where: { id: open.shiftId } }) : null;
  const g = await geoFor(actor.kioskLocationId ?? open.locationId, (shift?.geofenceOverride as GeofenceOverride) ?? null);
  const openBreak = open.breaks.find((b) => !b.endsAt);
  if (openBreak) await db.breakEntry.update({ where: { id: openBreak.id }, data: { endsAt: t } });
  await db.timeEntry.update({
    where: { id: open.id },
    data: {
      clockOut: t,
      clockOutRounded: roundPunch(t, "out", business.roundingMode, business.roundingIntervalMinutes),
      outLat: pos?.lat ?? null,
      outLng: pos?.lng ?? null,
      outAccuracy: pos?.accuracy ?? null,
      outDeviceTime: offline ? t : null,
      outServerTime: serverTime,
    },
  });
  const existing = new Set(open.flags.map((f) => f.type));
  const flags: { type: TimeFlag; detail?: object }[] = [
    ...baseFlags.map((type) => ({ type, detail: { action: "out", deviceTime: t.toISOString(), serverTime: serverTime.toISOString() } })),
    ...g.flags.filter((f) => !existing.has(f)).map((type) => ({ type, detail: { at: "out", distanceM: g.distanceM ?? null } })),
  ];
  if (shift && isEarlyLeave(t, shift, business.lateToleranceMinutes)) flags.push({ type: "EARLY_LEAVE", detail: { minutes: Math.round((shift.endsAt.getTime() - t.getTime()) / 60_000) } });
  await addFlags(open.id, flags);
  const missed = await checkBreaks(db, open.id, {
    notify: (mid) => notifyTimeManagers(db, mid, "Break missed", "A required break wasn't punched. Resolve it before the timesheet can be approved."),
  });
  return { entryId: open.id, action: "out" as const, at: t, flags: [...flags.map((f) => f.type), ...(missed.length ? (["BREAK_MISSED"] as TimeFlag[]) : [])] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Missing clock-out (§7.3): flag, exclude, notify — never write an end time.
// ─────────────────────────────────────────────────────────────────────────────

async function notifyTimeManagers(db: TenantDb, subjectMembershipId: string, title: string, body: string) {
  const members = await db.membership.findMany({ where: { status: "active", accessRevokedAt: null }, include: { role: true } });
  const subject = members.find((m) => m.id === subjectMembershipId);
  for (const m of members) {
    if (m.id === subjectMembershipId) continue;
    const holds = m.role.isOwner || parsePermissions(m.role.permissions).includes("timeclock.edit");
    if (holds && (m.role.isOwner || !subject || m.role.rank < subject.role.rank)) {
      await db.notification.create({ data: { membershipId: m.id, type: "time.flag", title, body, payload: { subjectMembershipId } } as never });
    }
  }
}

export async function raiseMissingClockOuts(businessId: string, now = new Date()) {
  const db = tenantDb(businessId);
  const business = await db.business.findUniqueOrThrow({ where: { id: businessId } });
  const cutoff = new Date(now.getTime() - business.maxShiftHours * 3600_000);
  const stale = await db.timeEntry.findMany({
    where: { clockOut: null, clockIn: { lt: cutoff }, flags: { none: { type: "MISSING_CLOCK_OUT" } } },
    select: { id: true, membershipId: true, clockIn: true },
  });
  for (const e of stale) {
    await db.timeEntryFlag.create({ data: { timeEntryId: e.id, type: "MISSING_CLOCK_OUT", detail: { clockIn: e.clockIn!.toISOString() } } as never });
    await db.notification.create({
      data: { membershipId: e.membershipId, type: "time.flag", title: "Did you forget to clock out?", body: "Tell us when your last shift finished next time you open the clock." } as never,
    });
    await notifyTimeManagers(db, e.membershipId, "Missing clock-out", "Someone is still clocked in past the maximum shift length.");
  }
  return stale.length;
}
