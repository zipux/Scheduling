import "server-only";
import { z } from "zod";
import { accessibleLocationIds, assertCan, hasPermission, type BusinessContext } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { can } from "@/lib/permissions";
import {
  addDaysKey,
  dateKeyInTz,
  hoursBetween,
  isDateKey,
  localToUtc,
  shiftInstants,
  timeInTz,
  weekDays,
  weekStartKey,
} from "@/lib/time";
import {
  computeWarnings,
  DEFAULT_MIN_REST_HOURS,
  paidHours,
  type AvailabilityRuleLite,
  type ScheduleWarning,
  type WShift,
} from "@/lib/schedule-warnings";
import { wageOn, type WageRow } from "@/lib/wages";
import { enqueueScheduleChange, loadShiftForNotify, weekOfShift } from "./schedule-notify";
import { checkEligible } from "./requests/common";

// ─────────────────────────────────────────────────────────────────────────────
// Input schemas
// ─────────────────────────────────────────────────────────────────────────────

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const geofenceOverrideSchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("off") }),
    z.object({
      mode: z.literal("custom"),
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
      radiusM: z.coerce.number().int().min(10).max(5000),
    }),
  ])
  .nullable();

export const shiftInputSchema = z.object({
  date: z.string().refine(isDateKey, "Choose a date"),
  start: time,
  end: time,
  breakMinutes: z.coerce.number().int().min(0).max(240).default(0),
  locationId: z.string().min(1, "Choose a location"),
  positionId: z.string().min(1).nullable(),
  membershipId: z.string().min(1).nullable(),
  notes: z.string().trim().max(500).optional().default(""),
  geofenceOverride: geofenceOverrideSchema.optional().default(null),
});
export type ShiftInput = z.infer<typeof shiftInputSchema>;

const MAX_SHIFT_HOURS = 24;

// ─────────────────────────────────────────────────────────────────────────────
// Warnings loader
// ─────────────────────────────────────────────────────────────────────────────

type ShiftLike = {
  id: string;
  membershipId: string | null;
  startsAt: Date;
  endsAt: Date;
  breakMinutes: number;
  positionId: string | null;
  locationId: string;
};

/** Loads everything the warning engine needs for a batch of shifts, in a few queries. */
export async function warningsFor(ctx: BusinessContext, shifts: ShiftLike[]): Promise<Map<string, ScheduleWarning[]>> {
  const result = new Map<string, ScheduleWarning[]>();
  const assigned = shifts.filter((s) => s.membershipId);
  if (!assigned.length) return result;
  const people = [...new Set(assigned.map((s) => s.membershipId!))];
  const from = new Date(Math.min(...assigned.map((s) => s.startsAt.getTime())) - 8 * 86400_000);
  const to = new Date(Math.max(...assigned.map((s) => s.endsAt.getTime())) + 8 * 86400_000);

  const [personShifts, timeOff, availability, profiles, positions, locations, rules] = await Promise.all([
    ctx.db.shift.findMany({
      where: { membershipId: { in: people }, deletedAt: null, startsAt: { lt: to }, endsAt: { gt: from } },
      select: { id: true, membershipId: true, startsAt: true, endsAt: true, breakMinutes: true, positionId: true, locationId: true },
    }),
    ctx.db.timeOffRequest.findMany({
      where: { membershipId: { in: people }, status: "approved", startsAt: { lt: to }, endsAt: { gt: from } },
      select: { membershipId: true, startsAt: true, endsAt: true },
    }),
    ctx.db.availabilityRule.findMany({ where: { membershipId: { in: people }, status: "approved" } }),
    ctx.db.employeeProfile.findMany({ where: { membershipId: { in: people } }, select: { membershipId: true, dateOfBirth: true } }),
    ctx.db.position.findMany({ select: { id: true, requiresMinimumAge: true } }),
    ctx.db.location.findMany({ select: { id: true, timezone: true } }),
    ctx.db.payRules.findUnique({ where: { businessId: ctx.businessId } }),
  ]);
  const tzOf = new Map(locations.map((l) => [l.id, l.timezone]));
  const tz = (id: string) => tzOf.get(id) ?? ctx.business.timezone;
  const toW = (s: ShiftLike): WShift => ({ ...s, tz: tz(s.locationId) });
  const minAge = new Map(positions.map((p) => [p.id, p.requiresMinimumAge]));
  const dob = new Map(profiles.map((p) => [p.membershipId, p.dateOfBirth?.toISOString().slice(0, 10) ?? null]));
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  for (const s of assigned) {
    // Include the unsaved/in-memory version of `s` in place of its stored copy.
    const mine = [...personShifts.filter((p) => p.membershipId === s.membershipId && p.id !== s.id), ...assigned.filter((a) => a.membershipId === s.membershipId && a.id !== s.id && !personShifts.some((p) => p.id === a.id))];
    result.set(
      s.id,
      computeWarnings(toW(s), {
        personShifts: mine.map(toW),
        dob: dob.get(s.membershipId!) ?? null,
        positionMinAge: s.positionId ? (minAge.get(s.positionId) ?? null) : null,
        approvedTimeOff: timeOff.filter((t) => t.membershipId === s.membershipId),
        availability: availability
          .filter((a) => a.membershipId === s.membershipId)
          .map<AvailabilityRuleLite>((a) => ({
            weekday: a.weekday,
            kind: a.kind,
            startMinutes: a.startMinutes,
            endMinutes: a.endMinutes,
            effectiveFrom: a.effectiveFrom.toISOString().slice(0, 10),
            requestId: a.requestId,
          })),
        dailyThresholdHours: num(rules?.dailyThresholdHours),
        weeklyThresholdHours: num(rules?.weeklyThresholdHours),
        maxSplitShiftSpanHours: num(rules?.maxSplitShiftSpanHours),
        minRestHours: DEFAULT_MIN_REST_HOURS,
      }),
    );
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────

async function resolveInput(ctx: BusinessContext, input: ShiftInput) {
  const allowed = await accessibleLocationIds(ctx);
  if (!allowed.includes(input.locationId)) throw new UserError("Choose a location you manage.", { locationId: ["Not available"] });
  const location = await ctx.db.location.findUniqueOrThrow({ where: { id: input.locationId } });
  if (input.positionId) {
    const p = await ctx.db.position.findUnique({ where: { id: input.positionId } });
    if (!p || p.archivedAt) throw new UserError("Choose a position.", { positionId: ["Not available"] });
  }
  if (input.membershipId) {
    const m = await ctx.db.membership.findUnique({ where: { id: input.membershipId } });
    if (!m || m.status !== "active" || m.accessRevokedAt) throw new UserError("That person can't be scheduled.", { membershipId: ["Not available"] });
  }
  const { startsAt, endsAt } = shiftInstants(input.date, input.start, input.end, location.timezone);
  const len = hoursBetween(startsAt, endsAt);
  if (len <= 0 || len > MAX_SHIFT_HOURS) throw new UserError("A shift must be between 1 minute and 24 hours.", { end: ["Check the times"] });
  if (input.breakMinutes / 60 >= len) throw new UserError("The break is longer than the shift.", { breakMinutes: ["Too long"] });
  return { location, startsAt, endsAt };
}

async function loadEditable(ctx: BusinessContext, id: string) {
  assertCan(ctx, "schedule.edit");
  const shift = await loadShiftForNotify(ctx.db, id);
  if (!shift || shift.deletedAt) throw new UserError("Shift not found.");
  const allowed = await accessibleLocationIds(ctx);
  if (!allowed.includes(shift.locationId)) throw new UserError("Shift not found.");
  return shift;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

export async function previewWarnings(ctx: BusinessContext, input: ShiftInput & { id?: string | null }) {
  assertCan(ctx, "schedule.edit");
  const { startsAt, endsAt } = await resolveInput(ctx, input);
  const probe = { id: input.id ?? "__new__", membershipId: input.membershipId, startsAt, endsAt, breakMinutes: input.breakMinutes, positionId: input.positionId, locationId: input.locationId };
  const warnings = (await warningsFor(ctx, [probe])).get(probe.id) ?? [];
  // §6.0: the same eligibility predicate as trades — informational for a deliberate assignment.
  const ineligible = input.membershipId ? (await checkEligible(ctx, input.membershipId, probe)).reasons : [];
  return { warnings, ineligible };
}

export async function createShift(ctx: BusinessContext, input: ShiftInput) {
  assertCan(ctx, "schedule.edit");
  const { startsAt, endsAt } = await resolveInput(ctx, input);
  const shift = await ctx.db.shift.create({
    data: {
      locationId: input.locationId,
      positionId: input.positionId,
      membershipId: input.membershipId,
      startsAt,
      endsAt,
      breakMinutes: input.breakMinutes,
      notes: input.notes || null,
      geofenceOverride: input.geofenceOverride ?? undefined,
      status: "draft",
    } as never,
  });
  return { id: shift.id, warnings: (await warningsFor(ctx, [shift])).get(shift.id) ?? [] };
}

export async function updateShift(ctx: BusinessContext, id: string, input: ShiftInput) {
  const before = await loadEditable(ctx, id);
  const { location, startsAt, endsAt } = await resolveInput(ctx, input);
  if (before.status === "published") {
    // Tell both the old and the new assignee, with what they saw before.
    await enqueueScheduleChange(ctx.db, before, id, [before.membershipId, input.membershipId], weekOfShift({ startsAt }, location.timezone));
    const oldWeek = weekOfShift(before, before.location.timezone);
    if (oldWeek !== weekOfShift({ startsAt }, location.timezone)) {
      await enqueueScheduleChange(ctx.db, before, id, [before.membershipId], oldWeek);
    }
  }
  const shift = await ctx.db.shift.update({
    where: { id },
    data: {
      locationId: input.locationId,
      positionId: input.positionId,
      membershipId: input.membershipId,
      startsAt,
      endsAt,
      breakMinutes: input.breakMinutes,
      notes: input.notes || null,
      geofenceOverride: input.geofenceOverride ?? undefined,
    },
  });
  return { id: shift.id, warnings: (await warningsFor(ctx, [shift])).get(shift.id) ?? [] };
}

/** Drag & drop: move to another day and/or person, keeping local start/end times. */
export async function moveShift(ctx: BusinessContext, id: string, to: { date: string; membershipId: string | null }) {
  const s = await loadEditable(ctx, id);
  const tz = s.location.timezone;
  return updateShift(ctx, id, {
    date: to.date,
    start: timeInTz(s.startsAt, tz),
    end: timeInTz(s.endsAt, tz),
    breakMinutes: s.breakMinutes,
    locationId: s.locationId,
    positionId: s.positionId,
    membershipId: to.membershipId,
    notes: s.notes ?? "",
    geofenceOverride: (s.geofenceOverride as ShiftInput["geofenceOverride"]) ?? null,
  });
}

export async function deleteShift(ctx: BusinessContext, id: string) {
  const s = await loadEditable(ctx, id);
  if (s.status === "draft") {
    await ctx.db.shift.delete({ where: { id } });
    return;
  }
  await enqueueScheduleChange(ctx.db, s, id, [s.membershipId], weekOfShift(s, s.location.timezone));
  await ctx.db.shift.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "SHIFT_DELETED", targetType: "Shift", targetId: id });
}

export const weekScopeSchema = z.object({
  weekStart: z.string().refine(isDateKey, "Invalid week"),
  locationIds: z.array(z.string().min(1)).min(1),
});

async function scopedLocations(ctx: BusinessContext, requested: string[]) {
  const allowed = await accessibleLocationIds(ctx);
  const ids = requested.filter((id) => allowed.includes(id));
  if (!ids.length) throw new UserError("Choose a location you manage.");
  return ctx.db.location.findMany({ where: { id: { in: ids } } });
}

/** UTC window that certainly contains the local week in every location's timezone. */
function weekWindow(weekStart: string) {
  return { from: new Date(`${addDaysKey(weekStart, -1)}T00:00:00Z`), to: new Date(`${addDaysKey(weekStart, 8)}T00:00:00Z`) };
}

async function shiftsInWeek(ctx: BusinessContext, weekStart: string, locations: { id: string; timezone: string }[], extra: object = {}) {
  const { from, to } = weekWindow(weekStart);
  const rows = await ctx.db.shift.findMany({
    where: { locationId: { in: locations.map((l) => l.id) }, deletedAt: null, startsAt: { gte: from, lt: to }, ...extra },
    include: { location: { select: { name: true, timezone: true } }, position: { select: { name: true, color: true, requiresMinimumAge: true } } },
    orderBy: { startsAt: "asc" },
  });
  const days = new Set(weekDays(weekStart));
  return rows.filter((s) => days.has(dateKeyInTz(s.startsAt, s.location.timezone)));
}

export async function publishWeek(ctx: BusinessContext, input: z.infer<typeof weekScopeSchema>) {
  assertCan(ctx, "schedule.publish");
  const locations = await scopedLocations(ctx, input.locationIds);
  const drafts = await shiftsInWeek(ctx, input.weekStart, locations, { status: "draft" });
  for (const s of drafts) {
    // Staff never saw a draft, so "before" is null: they get "shift added".
    if (s.membershipId) await enqueueScheduleChange(ctx.db, null, s.id, [s.membershipId], input.weekStart);
  }
  const now = new Date();
  await ctx.db.shift.updateMany({ where: { id: { in: drafts.map((d) => d.id) } }, data: { status: "published", publishedAt: now } });
  await audit({
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action: "SCHEDULE_PUBLISHED",
    data: { weekStart: input.weekStart, locationIds: locations.map((l) => l.id), shifts: drafts.length },
  });
  return { published: drafts.length };
}

/** Copies last week's shifts (same local times, same people) into this week as drafts. */
export async function copyPreviousWeek(ctx: BusinessContext, input: z.infer<typeof weekScopeSchema>) {
  assertCan(ctx, "schedule.edit");
  const locations = await scopedLocations(ctx, input.locationIds);
  const source = await shiftsInWeek(ctx, addDaysKey(input.weekStart, -7), locations);
  const existing = await shiftsInWeek(ctx, input.weekStart, locations);
  const key = (loc: string, m: string | null, p: string | null, s: Date, e: Date) => `${loc}|${m}|${p}|${s.toISOString()}|${e.toISOString()}`;
  const have = new Set(existing.map((s) => key(s.locationId, s.membershipId, s.positionId, s.startsAt, s.endsAt)));
  let created = 0;
  for (const s of source) {
    const tz = s.location.timezone;
    const date = addDaysKey(dateKeyInTz(s.startsAt, tz), 7);
    const { startsAt, endsAt } = shiftInstants(date, timeInTz(s.startsAt, tz), timeInTz(s.endsAt, tz), tz);
    if (have.has(key(s.locationId, s.membershipId, s.positionId, startsAt, endsAt))) continue;
    const person = s.membershipId ? await ctx.db.membership.findUnique({ where: { id: s.membershipId } }) : null;
    await ctx.db.shift.create({
      data: {
        locationId: s.locationId,
        positionId: s.positionId,
        membershipId: person && person.status === "active" && !person.accessRevokedAt ? s.membershipId : null,
        startsAt,
        endsAt,
        breakMinutes: s.breakMinutes,
        notes: s.notes,
        geofenceOverride: s.geofenceOverride ?? undefined,
        status: "draft",
      } as never,
    });
    created++;
  }
  return { created };
}

// ─────────────────────────────────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────────────────────────────────

export const templateSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(60),
  start: time,
  end: time,
  breakMinutes: z.coerce.number().int().min(0).max(240).default(0),
  locationId: z.string().min(1).nullable(),
  positionId: z.string().min(1).nullable(),
  notes: z.string().trim().max(500).optional().default(""),
});

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

export async function createTemplate(ctx: BusinessContext, input: z.infer<typeof templateSchema>) {
  assertCan(ctx, "schedule.edit");
  const start = toMinutes(input.start);
  let end = toMinutes(input.end);
  if (end <= start) end += 1440;
  return ctx.db.shiftTemplate.create({
    data: { name: input.name, startMinutes: start, endMinutes: end, breakMinutes: input.breakMinutes, locationId: input.locationId, positionId: input.positionId, notes: input.notes || null } as never,
  });
}

export async function deleteTemplate(ctx: BusinessContext, id: string) {
  assertCan(ctx, "schedule.edit");
  const n = await ctx.db.shiftTemplate.deleteMany({ where: { id } });
  if (!n.count) throw new UserError("Template not found.");
}

export function templateTimes(t: { startMinutes: number; endMinutes: number }) {
  const fmt = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return { start: fmt(t.startMinutes), end: fmt(t.endMinutes) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading a week
// ─────────────────────────────────────────────────────────────────────────────

export interface ScheduledWages {
  byDay: Record<string, number>;
  week: number;
  hoursByDay: Record<string, number>;
  missingWage: number;
}

/** Scheduled wages (§5.3): scheduled hours (after planned unpaid breaks) × hourly wage. Salaried staff are excluded. */
export function scheduledWages(
  shifts: { membershipId: string | null; startsAt: Date; endsAt: Date; breakMinutes: number; positionId: string | null; tz: string }[],
  wagesByMember: Map<string, WageRow[]>,
  days: string[],
): ScheduledWages {
  const byDay: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]));
  const hoursByDay: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]));
  let missingWage = 0;
  for (const s of shifts) {
    if (!s.membershipId) continue;
    const day = dateKeyInTz(s.startsAt, s.tz);
    if (!(day in byDay)) continue;
    const h = paidHours(s);
    hoursByDay[day] += h;
    const w = wageOn(wagesByMember.get(s.membershipId) ?? [], day, s.positionId);
    if (!w) missingWage++;
    else if (w.type === "hourly") byDay[day] += Math.round(h * w.rateCents);
  }
  return { byDay, hoursByDay, week: Object.values(byDay).reduce((a, b) => a + b, 0), missingWage };
}

export async function loadWeek(ctx: BusinessContext, weekStart: string, locationIds: string[]) {
  const locations = await scopedLocations(ctx, locationIds);
  const manager = hasPermission(ctx, "schedule.edit");
  const days = weekDays(weekStart);
  const shifts = await shiftsInWeek(ctx, weekStart, locations, manager ? {} : { status: "published" });
  const members = await ctx.db.membership.findMany({
    where: {
      status: "active",
      accessRevokedAt: null,
      OR: [
        { locations: { some: { locationId: { in: locations.map((l) => l.id) } } } },
        { id: { in: shifts.map((s) => s.membershipId).filter((m): m is string => !!m) } },
      ],
    },
    include: { user: { select: { name: true } }, positions: { select: { positionId: true } }, locations: { select: { locationId: true } }, role: { select: { rank: true } } },
    orderBy: [{ role: { rank: "asc" } }, { createdAt: "asc" }],
  });
  const warnings = manager ? await warningsFor(ctx, shifts) : new Map<string, ScheduleWarning[]>();
  const showWages = can(ctx.actor, "wages.view");
  let wages: ScheduledWages | null = null;
  if (showWages) {
    const rows = await ctx.db.wage.findMany({ where: { membershipId: { in: members.map((m) => m.id) } } });
    const byMember = new Map<string, WageRow[]>();
    for (const r of rows) {
      const list = byMember.get(r.membershipId) ?? [];
      list.push({ rateCents: r.rateCents, type: r.type, positionId: r.positionId, effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10) });
      byMember.set(r.membershipId, list);
    }
    wages = scheduledWages(shifts.map((s) => ({ ...s, tz: s.location.timezone })), byMember, days);
  }
  const holidays = await ctx.db.holiday.findMany({
    where: { date: { gte: new Date(`${days[0]}T00:00:00Z`), lte: new Date(`${days[6]}T00:00:00Z`) } },
    orderBy: { date: "asc" },
  });
  return { days, locations, shifts, members, warnings, wages, holidays, manager, showWages };
}

/** Future shifts with warnings, for the manager dashboard (§5.1). */
export async function upcomingWarnings(ctx: BusinessContext, horizonDays = 21) {
  if (!hasPermission(ctx, "schedule.edit")) return [];
  const allowed = await accessibleLocationIds(ctx);
  const now = new Date();
  const shifts = await ctx.db.shift.findMany({
    where: { locationId: { in: allowed }, deletedAt: null, membershipId: { not: null }, startsAt: { gte: now, lt: new Date(now.getTime() + horizonDays * 86400_000) } },
    include: { location: { select: { name: true, timezone: true } }, membership: { include: { user: { select: { name: true } } } } },
    orderBy: { startsAt: "asc" },
    take: 500,
  });
  const w = await warningsFor(ctx, shifts);
  return shifts.filter((s) => (w.get(s.id)?.length ?? 0) > 0).map((s) => ({ shift: s, warnings: w.get(s.id)! }));
}

/** For the location switcher default: where is this member's next or current shift? */
export async function nextShiftLocation(ctx: BusinessContext) {
  const s = await ctx.db.shift.findFirst({
    where: { membershipId: ctx.membership.id, deletedAt: null, status: "published", endsAt: { gt: new Date() } },
    orderBy: { startsAt: "asc" },
    select: { locationId: true },
  });
  return s?.locationId ?? null;
}

/** The member's own published shifts for the next five weeks (§5.3 "My shifts"). */
export function myUpcomingShifts(ctx: BusinessContext, days = 35) {
  const now = new Date();
  return ctx.db.shift.findMany({
    where: {
      membershipId: ctx.membership.id,
      status: "published",
      deletedAt: null,
      endsAt: { gte: now },
      startsAt: { lt: new Date(now.getTime() + days * 86400_000) },
    },
    include: { location: { select: { name: true, timezone: true } }, position: { select: { name: true, color: true } } },
    orderBy: { startsAt: "asc" },
  });
}

export function currentWeekStart(tz: string) {
  return weekStartKey(dateKeyInTz(new Date(), tz));
}

export function shiftDateKey(s: { startsAt: Date }, tz: string) {
  return dateKeyInTz(s.startsAt, tz);
}

export { localToUtc };
