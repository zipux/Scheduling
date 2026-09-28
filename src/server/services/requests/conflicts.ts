import "server-only";
import { z } from "zod";
import { accessibleLocationIds, assertCan, type BusinessContext } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { availabilityOn, type AvailabilityRuleLite } from "@/lib/schedule-warnings";
import { dateKeyInTz, hoursBetween, minutesInTz, weekdayOfKey } from "@/lib/time";
import { moveShift } from "../schedule";

/**
 * §6.4 — approving any availability change or time-off request re-runs the
 * conflict check across the person's PUBLISHED FUTURE shifts. Each conflict
 * becomes a SCHEDULE_CONFLICT item on the manager dashboard.
 */
export async function recheckPublishedShifts(
  ctx: BusinessContext,
  membershipId: string,
  source: { type: "timeoff"; id: string; startsAt: Date; endsAt: Date } | { type: "availability"; id: string },
) {
  const shifts = await ctx.db.shift.findMany({
    where: { membershipId, status: "published", deletedAt: null, startsAt: { gt: new Date() } },
    include: { location: { select: { timezone: true } } },
  });
  let rules: AvailabilityRuleLite[] = [];
  if (source.type === "availability") {
    const rows = await ctx.db.availabilityRule.findMany({ where: { membershipId, status: "approved" } });
    rules = rows.map((a) => ({
      weekday: a.weekday,
      kind: a.kind,
      startMinutes: a.startMinutes,
      endMinutes: a.endMinutes,
      effectiveFrom: a.effectiveFrom.toISOString().slice(0, 10),
      requestId: a.requestId,
    }));
  }
  let created = 0;
  for (const s of shifts) {
    let reason: string | null = null;
    if (source.type === "timeoff") {
      if (s.startsAt < source.endsAt && source.startsAt < s.endsAt) reason = "Approved time off covers this shift";
    } else {
      const day = dateKeyInTz(s.startsAt, s.location.timezone);
      const rule = availabilityOn(rules, day).find((r) => r.weekday === weekdayOfKey(day));
      if (rule?.kind === "unavailable") reason = "Now marked unavailable this day";
      else if (rule?.kind === "between" && rule.startMinutes !== null && rule.endMinutes !== null) {
        const start = minutesInTz(s.startsAt, s.location.timezone);
        const end = start + Math.round(hoursBetween(s.startsAt, s.endsAt) * 60);
        if (start < rule.startMinutes || end > rule.endMinutes) reason = "Now outside their available hours";
      }
    }
    if (!reason) continue;
    const exists = await ctx.db.scheduleConflict.findFirst({ where: { shiftId: s.id, membershipId, resolvedAt: null } });
    if (exists) continue;
    await ctx.db.scheduleConflict.create({
      data: { shiftId: s.id, membershipId, reason, sourceType: source.type, sourceId: source.id } as never,
    });
    created++;
  }
  return created;
}

/** Open conflicts for the dashboard. Conflicts whose shift was reassigned/deleted since resolve themselves. */
export async function openConflicts(ctx: BusinessContext) {
  const allowed = await accessibleLocationIds(ctx);
  const rows = await ctx.db.scheduleConflict.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: "asc" } });
  if (!rows.length) return [];
  const shifts = await ctx.db.shift.findMany({
    where: { id: { in: rows.map((r) => r.shiftId) } },
    include: { location: { select: { name: true, timezone: true } }, membership: { include: { user: { select: { name: true } } } } },
  });
  const out = [];
  for (const c of rows) {
    const s = shifts.find((x) => x.id === c.shiftId);
    if (!s || s.deletedAt || s.membershipId !== c.membershipId || s.endsAt < new Date()) {
      await ctx.db.scheduleConflict.update({ where: { id: c.id }, data: { resolvedAt: new Date(), resolution: "superseded" } });
      continue;
    }
    if (allowed.includes(s.locationId)) out.push({ conflict: c, shift: s });
  }
  return out;
}

export const resolveConflictSchema = z.object({ id: z.string().min(1), action: z.enum(["make_open", "keep"]) });

export async function resolveConflict(ctx: BusinessContext, input: z.infer<typeof resolveConflictSchema>) {
  assertCan(ctx, "schedule.edit");
  const c = await ctx.db.scheduleConflict.findUnique({ where: { id: input.id } });
  if (!c || c.resolvedAt) throw new UserError("Conflict not found.");
  if (input.action === "make_open") {
    const s = await ctx.db.shift.findUniqueOrThrow({ where: { id: c.shiftId }, include: { location: true } });
    await moveShift(ctx, s.id, { date: dateKeyInTz(s.startsAt, s.location.timezone), membershipId: null });
    await ctx.db.shift.update({ where: { id: s.id }, data: { claimGeneration: { increment: 1 } } });
  }
  await ctx.db.scheduleConflict.update({
    where: { id: c.id },
    data: { resolvedAt: new Date(), resolvedById: ctx.userId, resolution: input.action === "make_open" ? "made_open" : "kept" },
  });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "SCHEDULE_CONFLICT_RESOLVED", targetType: "Shift", targetId: c.shiftId, data: { resolution: input.action } });
}
