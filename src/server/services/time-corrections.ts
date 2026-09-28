import "server-only";
import { z } from "zod";
import { accessibleLocationIds, ForbiddenError, type BusinessContext } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { can, canEditTimeEntry } from "@/lib/permissions";
import { roundPunch } from "@/lib/clock";
import { isBlocking, type TimeFlag } from "@/lib/time-flags";
import { notify, notifyApprovers } from "./requests/common";
import { checkBreaks } from "./break-check";

/**
 * Corrections (§7.4). Reason is mandatory; every change writes an immutable
 * TimeEntryAudit (who, when, before, after, reason). Nobody edits their own
 * entries — absolute, regardless of rank or settings (§3.3).
 */

const reason = z.string().trim().min(3, "Give a reason").max(500);
const instant = z.coerce.date();

function snapshot(e: { clockIn: Date | null; clockOut: Date | null; locationId: string; breaks?: { startsAt: Date; endsAt: Date | null }[] }) {
  return {
    clockIn: e.clockIn?.toISOString() ?? null,
    clockOut: e.clockOut?.toISOString() ?? null,
    locationId: e.locationId,
    breaks: (e.breaks ?? []).map((b) => ({ startsAt: b.startsAt.toISOString(), endsAt: b.endsAt?.toISOString() ?? null })),
  };
}

async function loadForEdit(ctx: BusinessContext, entryId: string, perm: "timeclock.edit" | "timeclock.add") {
  const e = await ctx.db.timeEntry.findUnique({ where: { id: entryId }, include: { breaks: { orderBy: { startsAt: "asc" } }, flags: true } });
  if (!e) throw new UserError("Entry not found.");
  const owner = await ctx.db.membership.findUniqueOrThrow({ where: { id: e.membershipId }, include: { role: true } });
  if (owner.id === ctx.membership.id) throw new ForbiddenError("You can't edit your own time. Ask a manager, or send a correction request.");
  if (!canEditTimeEntry(ctx.actor, { membershipId: owner.id, rank: owner.role.rank }, perm)) {
    if (!can(ctx.actor, perm)) throw new ForbiddenError();
    throw new UserError("You can only edit time for people junior to you.");
  }
  if (!(await accessibleLocationIds(ctx)).includes(e.locationId)) throw new UserError("Entry not found.");
  // Approved periods are locked; only an Owner may change them, and it is audited (§7.5).
  if (e.lockedAt && !ctx.actor.isOwner) throw new UserError("This entry is in an approved pay period. Only an Owner can change it.");
  return e;
}

async function resolveOpenFlags(ctx: BusinessContext, entryId: string, types: TimeFlag[], resolution: string) {
  await ctx.db.timeEntryFlag.updateMany({
    where: { timeEntryId: entryId, type: { in: types }, resolvedAt: null },
    data: { resolvedAt: new Date(), resolvedById: ctx.userId, resolution },
  });
}

export const editEntrySchema = z
  .object({
    entryId: z.string().min(1),
    clockIn: instant.nullable(),
    clockOut: instant.nullable(),
    breaks: z.array(z.object({ startsAt: instant, endsAt: instant })).optional(),
    reason,
  })
  .refine((v) => !v.clockIn || !v.clockOut || v.clockOut > v.clockIn, { path: ["clockOut"], message: "Ends before it starts" })
  .refine((v) => (v.breaks ?? []).every((b) => b.endsAt > b.startsAt), { path: ["breaks"], message: "A break ends before it starts" });

export async function editEntry(ctx: BusinessContext, input: z.infer<typeof editEntrySchema>) {
  const e = await loadForEdit(ctx, input.entryId, "timeclock.edit");
  if (input.clockIn && input.clockOut && (input.breaks ?? []).some((b) => b.startsAt < input.clockIn! || b.endsAt > input.clockOut!)) {
    throw new UserError("Breaks must fall inside the shift.", { breaks: ["Outside the shift"] });
  }
  const business = ctx.business;
  const before = snapshot(e);
  await ctx.db.$transaction(async (tx) => {
    await tx.timeEntry.update({
      where: { id: e.id },
      data: {
        clockIn: input.clockIn,
        clockOut: input.clockOut,
        clockInRounded: input.clockIn ? roundPunch(input.clockIn, "in", business.roundingMode, business.roundingIntervalMinutes) : null,
        clockOutRounded: input.clockOut ? roundPunch(input.clockOut, "out", business.roundingMode, business.roundingIntervalMinutes) : null,
      },
    });
    if (input.breaks) {
      await tx.breakEntry.deleteMany({ where: { timeEntryId: e.id } });
      if (input.breaks.length) await tx.breakEntry.createMany({ data: input.breaks.map((b) => ({ timeEntryId: e.id, ...b })) as never });
    }
    await tx.timeEntryAudit.create({
      data: {
        timeEntryId: e.id,
        actorUserId: ctx.userId,
        action: e.lockedAt ? "lock_override" : "edit",
        before,
        after: snapshot({ ...e, clockIn: input.clockIn, clockOut: input.clockOut, breaks: input.breaks ?? e.breaks }),
        reason: input.reason,
      } as never,
    });
  });
  // A human supplying the missing time is the resolution of the missing-punch flags (§7.7).
  const resolved: TimeFlag[] = [];
  if (input.clockOut) resolved.push("MISSING_CLOCK_OUT");
  if (input.clockIn) resolved.push("MISSING_CLOCK_IN");
  await resolveOpenFlags(ctx, e.id, resolved, `corrected: ${input.reason}`);
  await ctx.db.correctionRequest.updateMany({ where: { timeEntryId: e.id, status: "pending" }, data: { status: "approved", reviewerId: ctx.membership.id, reviewedAt: new Date() } });
  // Re-check the break rule on the corrected entry; a manager's edit that satisfies it is the resolution.
  const stillMissed = await checkBreaks(ctx.db, e.id);
  if (!stillMissed.length) await resolveOpenFlags(ctx, e.id, ["BREAK_MISSED"], `corrected: ${input.reason}`);
  await notify(ctx.db, e.membershipId, "time.edited", "Your time was edited", `Reason: ${input.reason}`, { timeEntryId: e.id });
}

export const resolveBreakSchema = z.discriminatedUnion("resolution", [
  z.object({ flagId: z.string().min(1), resolution: z.literal("taken"), startsAt: instant, endsAt: instant, reason }).refine((v) => v.endsAt > v.startsAt, {
    path: ["endsAt"],
    message: "Ends before it starts",
  }),
  z.object({ flagId: z.string().min(1), resolution: z.literal("missed_paid"), reason }),
]);

/**
 * §7.6.3 resolution of BREAK_MISSED: "break was taken, add it" (adds the break,
 * which is then deducted) or "break was missed, pay it" (worked time stays paid).
 * Either way it's an audited correction.
 */
export async function resolveBreakMissed(ctx: BusinessContext, input: z.infer<typeof resolveBreakSchema>) {
  const f = await ctx.db.timeEntryFlag.findUnique({ where: { id: input.flagId } });
  if (!f || f.resolvedAt || f.type !== "BREAK_MISSED") throw new UserError("Flag not found.");
  const e = await loadForEdit(ctx, f.timeEntryId, "timeclock.edit");
  if (input.resolution === "taken") {
    if (!e.clockIn || !e.clockOut || input.startsAt < e.clockIn || input.endsAt > e.clockOut) throw new UserError("The break must fall inside the shift.");
    await editEntry(ctx, {
      entryId: e.id,
      clockIn: e.clockIn,
      clockOut: e.clockOut,
      breaks: [...e.breaks.map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt ?? e.clockOut! })), { startsAt: input.startsAt, endsAt: input.endsAt }],
      reason: `Break was taken: ${input.reason}`,
    });
    // If the added break still doesn't satisfy the rule, the flag stays open.
    return;
  }
  await ctx.db.timeEntryFlag.update({ where: { id: f.id }, data: { resolvedAt: new Date(), resolvedById: ctx.userId, resolution: `missed_paid: ${input.reason}` } });
  await ctx.db.timeEntryAudit.create({
    data: { timeEntryId: e.id, actorUserId: ctx.userId, action: "resolve_flag", before: { flag: "BREAK_MISSED" }, after: { flag: "BREAK_MISSED", resolution: "missed_paid" }, reason: input.reason } as never,
  });
}

export const addEntrySchema = z
  .object({ membershipId: z.string().min(1), locationId: z.string().min(1), clockIn: instant, clockOut: instant, reason })
  .refine((v) => v.clockOut > v.clockIn, { path: ["clockOut"], message: "Ends before it starts" });

export async function addEntry(ctx: BusinessContext, input: z.infer<typeof addEntrySchema>) {
  const owner = await ctx.db.membership.findUnique({ where: { id: input.membershipId }, include: { role: true } });
  if (!owner) throw new UserError("Person not found.");
  if (owner.id === ctx.membership.id) throw new ForbiddenError("You can't add time for yourself. Ask a manager, or send a correction request.");
  if (!canEditTimeEntry(ctx.actor, { membershipId: owner.id, rank: owner.role.rank }, "timeclock.add")) {
    if (!can(ctx.actor, "timeclock.add")) throw new ForbiddenError();
    throw new UserError("You can only add time for people junior to you.");
  }
  if (!(await accessibleLocationIds(ctx)).includes(input.locationId)) throw new UserError("Choose a location you manage.");
  const b = ctx.business;
  const e = await ctx.db.timeEntry.create({
    data: {
      membershipId: owner.id,
      locationId: input.locationId,
      clockIn: input.clockIn,
      clockOut: input.clockOut,
      clockInRounded: roundPunch(input.clockIn, "in", b.roundingMode, b.roundingIntervalMinutes),
      clockOutRounded: roundPunch(input.clockOut, "out", b.roundingMode, b.roundingIntervalMinutes),
      source: "manual",
    } as never,
  });
  await ctx.db.timeEntryAudit.create({
    data: { timeEntryId: e.id, actorUserId: ctx.userId, action: "create", before: undefined, after: snapshot({ ...e, breaks: [] }), reason: input.reason } as never,
  });
  await notify(ctx.db, owner.id, "time.edited", "Time was added for you", `Reason: ${input.reason}`, { timeEntryId: e.id });
  return { id: e.id };
}

export const resolveFlagSchema = z.object({ flagId: z.string().min(1), reason });

/**
 * Explicit human resolution of a flag (§7.7). Missing-punch flags can only be
 * resolved by supplying the time (editEntry); other flags are confirmed here.
 */
export async function resolveFlag(ctx: BusinessContext, input: z.infer<typeof resolveFlagSchema>) {
  const f = await ctx.db.timeEntryFlag.findUnique({ where: { id: input.flagId } });
  if (!f || f.resolvedAt) throw new UserError("Flag not found.");
  if (f.type === "MISSING_CLOCK_OUT" || f.type === "MISSING_CLOCK_IN") throw new UserError("Enter the missing time to resolve this.");
  if (f.type === "BREAK_MISSED") throw new UserError("Say whether the break was taken or missed.");
  const e = await loadForEdit(ctx, f.timeEntryId, "timeclock.edit");
  await ctx.db.timeEntryFlag.update({ where: { id: f.id }, data: { resolvedAt: new Date(), resolvedById: ctx.userId, resolution: input.reason } });
  await ctx.db.timeEntryAudit.create({
    data: { timeEntryId: e.id, actorUserId: ctx.userId, action: "resolve_flag", before: { flag: f.type }, after: { flag: f.type, resolved: true }, reason: input.reason } as never,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Employee-submitted corrections
// ─────────────────────────────────────────────────────────────────────────────

export const correctionSchema = z
  .object({
    timeEntryId: z.string().min(1).nullable(),
    proposedClockIn: instant.nullable(),
    proposedClockOut: instant.nullable(),
    message: z.string().trim().min(3, "Tell your manager what happened").max(500),
  })
  .refine((v) => v.proposedClockIn || v.proposedClockOut, { path: ["proposedClockOut"], message: "Give at least one time" })
  .refine((v) => !v.proposedClockIn || !v.proposedClockOut || v.proposedClockOut > v.proposedClockIn, { path: ["proposedClockOut"], message: "Ends before it starts" });

/** "I forgot to clock out at 22:00" → goes to approvers; never a punch (§7.3.3, §7.4). */
export async function requestCorrection(ctx: BusinessContext, input: z.infer<typeof correctionSchema>) {
  if (input.timeEntryId) {
    const e = await ctx.db.timeEntry.findUnique({ where: { id: input.timeEntryId } });
    if (!e || e.membershipId !== ctx.membership.id) throw new UserError("Entry not found.");
    if (input.proposedClockOut && e.clockIn && input.proposedClockOut <= e.clockIn) throw new UserError("That's before you clocked in.", { proposedClockOut: ["Before clock-in"] });
    if (input.proposedClockOut && input.proposedClockOut > new Date()) throw new UserError("That time hasn't happened yet.", { proposedClockOut: ["In the future"] });
    const dup = await ctx.db.correctionRequest.findFirst({ where: { timeEntryId: e.id, status: "pending" } });
    if (dup) throw new UserError("You've already sent a correction for this entry.");
  }
  const c = await ctx.db.correctionRequest.create({
    data: { membershipId: ctx.membership.id, timeEntryId: input.timeEntryId, proposedClockIn: input.proposedClockIn, proposedClockOut: input.proposedClockOut, message: input.message } as never,
  });
  await notifyApprovers(ctx, ctx.membership.id, "timeclock.edit", "Time correction requested", `${ctx.userName}: ${input.message}`, { correctionId: c.id });
  return { id: c.id };
}

export const reviewCorrectionSchema = z.object({
  id: z.string().min(1),
  approve: z.boolean(),
  clockIn: instant.nullable().optional(),
  clockOut: instant.nullable().optional(),
  reason,
});

/** A user with timeclock.edit confirms or amends it, with a reason, as a normal audited correction. */
export async function reviewCorrection(ctx: BusinessContext, input: z.infer<typeof reviewCorrectionSchema>) {
  const c = await ctx.db.correctionRequest.findUnique({ where: { id: input.id } });
  if (!c || c.status !== "pending") throw new UserError("This request has already been handled.");
  if (c.membershipId === ctx.membership.id) throw new ForbiddenError("You can't review your own time.");
  if (!input.approve) {
    const owner = await ctx.db.membership.findUniqueOrThrow({ where: { id: c.membershipId }, include: { role: true } });
    if (!canEditTimeEntry(ctx.actor, { membershipId: owner.id, rank: owner.role.rank }, "timeclock.edit")) throw new ForbiddenError();
    await ctx.db.correctionRequest.update({ where: { id: c.id }, data: { status: "denied", reviewerId: ctx.membership.id, reviewerNote: input.reason, reviewedAt: new Date() } });
    await notify(ctx.db, c.membershipId, "request.reviewed", "Correction not accepted", input.reason, { correctionId: c.id });
    return;
  }
  const clockIn = input.clockIn !== undefined ? input.clockIn : c.proposedClockIn;
  const clockOut = input.clockOut !== undefined ? input.clockOut : c.proposedClockOut;
  if (c.timeEntryId) {
    const e = await ctx.db.timeEntry.findUniqueOrThrow({ where: { id: c.timeEntryId } });
    await editEntry(ctx, { entryId: e.id, clockIn: clockIn ?? e.clockIn, clockOut: clockOut ?? e.clockOut, reason: input.reason });
  } else {
    if (!clockIn || !clockOut) throw new UserError("Enter both times to add this entry.");
    const loc = await ctx.db.membershipLocation.findFirst({ where: { membershipId: c.membershipId } });
    if (!loc) throw new UserError("That person has no location.");
    await addEntry(ctx, { membershipId: c.membershipId, locationId: loc.locationId, clockIn, clockOut, reason: input.reason });
  }
  await ctx.db.correctionRequest.update({ where: { id: c.id }, data: { status: "approved", reviewerId: ctx.membership.id, reviewerNote: input.reason, reviewedAt: new Date() } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────────────────────────────────────

/** The "Unresolved time" queue (§7.7): entries with unresolved flags, blocking first. */
export async function unresolvedTime(ctx: BusinessContext) {
  if (!can(ctx.actor, "timeclock.edit")) return [];
  const allowed = await accessibleLocationIds(ctx);
  const flags = await ctx.db.timeEntryFlag.findMany({
    where: { resolvedAt: null, timeEntry: { locationId: { in: allowed } } },
    include: { timeEntry: { include: { breaks: true, location: { select: { name: true, timezone: true } } } } },
    orderBy: { createdAt: "asc" },
    take: 300,
  });
  const people = await ctx.db.membership.findMany({ where: { id: { in: [...new Set(flags.map((f) => f.timeEntry.membershipId))] } }, include: { user: { select: { name: true } }, role: true } });
  const byEntry = new Map<string, { entry: (typeof flags)[number]["timeEntry"]; flags: typeof flags; person: (typeof people)[number] | undefined }>();
  for (const f of flags) {
    const g = byEntry.get(f.timeEntryId) ?? { entry: f.timeEntry, flags: [], person: people.find((p) => p.id === f.timeEntry.membershipId) };
    g.flags.push(f);
    byEntry.set(f.timeEntryId, g);
  }
  return [...byEntry.values()]
    .filter((g) => g.person && g.person.id !== ctx.membership.id)
    .sort((a, b) => Number(b.flags.some((f) => isBlocking(f.type))) - Number(a.flags.some((f) => isBlocking(f.type))));
}

export async function pendingCorrections(ctx: BusinessContext) {
  if (!can(ctx.actor, "timeclock.edit")) return [];
  const rows = await ctx.db.correctionRequest.findMany({ where: { status: "pending", NOT: { membershipId: ctx.membership.id } }, orderBy: { createdAt: "asc" } });
  const people = await ctx.db.membership.findMany({ where: { id: { in: rows.map((r) => r.membershipId) } }, include: { user: { select: { name: true } }, role: true } });
  return rows
    .map((r) => ({ ...r, person: people.find((p) => p.id === r.membershipId)! }))
    .filter((r) => r.person && (ctx.actor.isOwner || ctx.actor.rank < r.person.role.rank));
}

/** An employee sees the full history of their own entries (§7.4). */
export async function myEntries(ctx: BusinessContext, days = 21) {
  return ctx.db.timeEntry.findMany({
    where: { membershipId: ctx.membership.id, OR: [{ clockIn: { gte: new Date(Date.now() - days * 86400_000) } }, { clockIn: null, clockOut: { gte: new Date(Date.now() - days * 86400_000) } }] },
    include: { breaks: { orderBy: { startsAt: "asc" } }, flags: true, location: { select: { name: true, timezone: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function entryHistory(ctx: BusinessContext, entryId: string) {
  const e = await ctx.db.timeEntry.findUnique({ where: { id: entryId } });
  if (!e) throw new UserError("Entry not found.");
  if (e.membershipId !== ctx.membership.id && !can(ctx.actor, "timeclock.edit")) throw new ForbiddenError();
  return ctx.db.timeEntryAudit.findMany({ where: { timeEntryId: entryId }, orderBy: { createdAt: "asc" } });
}

/** Who is working now (§7.3): open entries, excluding MISSING_CLOCK_OUT. */
export async function workingNow(ctx: BusinessContext) {
  const allowed = await accessibleLocationIds(ctx);
  const rows = await ctx.db.timeEntry.findMany({
    where: { clockOut: null, NOT: { clockIn: null }, locationId: { in: allowed }, flags: { none: { type: "MISSING_CLOCK_OUT", resolvedAt: null } } },
    include: { breaks: true, location: { select: { name: true, timezone: true } } },
    orderBy: { clockIn: "asc" },
  });
  const people = await ctx.db.membership.findMany({ where: { id: { in: rows.map((r) => r.membershipId) } }, include: { user: { select: { name: true } } } });
  return rows.map((r) => ({ entry: r, name: people.find((p) => p.id === r.membershipId)?.displayName ?? people.find((p) => p.id === r.membershipId)?.user.name ?? "—", onBreak: r.breaks.some((b) => !b.endsAt) }));
}
