import "server-only";
import { z } from "zod";
import { accessibleLocationIds, assertCan, type BusinessContext } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { addDaysKey, dateKeyInTz, isDateKey, localToUtc } from "@/lib/time";
import { assertCanReview, isEscalated, notify, notifyApprovers } from "./common";
import { recheckPublishedShifts } from "./conflicts";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const timeOffSchema = z
  .object({
    type: z.string().min(1, "Choose a type"),
    allDay: z.boolean(),
    startDate: z.string().refine(isDateKey, "Choose a start date"),
    endDate: z.string().refine(isDateKey, "Choose an end date"),
    startTime: time.optional(),
    endTime: time.optional(),
    reason: z.string().trim().max(500).optional().default(""),
  })
  .superRefine((v, c) => {
    if (v.allDay && v.endDate < v.startDate) c.addIssue({ code: "custom", path: ["endDate"], message: "Ends before it starts" });
    if (!v.allDay) {
      if (!v.startTime || !v.endTime) c.addIssue({ code: "custom", path: ["startTime"], message: "Choose the hours" });
      else if (v.endTime <= v.startTime) c.addIssue({ code: "custom", path: ["endTime"], message: "Ends before it starts" });
    }
  });
export type TimeOffInput = z.infer<typeof timeOffSchema>;

/** Timezone used for a member's all-day dates: their first location's, else the business's. */
async function memberTz(ctx: BusinessContext, membershipId: string) {
  const ml = await ctx.db.membershipLocation.findFirst({ where: { membershipId }, include: { location: { select: { timezone: true } } } });
  return ml?.location.timezone ?? ctx.business.timezone;
}

async function memberLocationIds(ctx: BusinessContext, membershipId: string) {
  return (await ctx.db.membershipLocation.findMany({ where: { membershipId }, select: { locationId: true } })).map((l) => l.locationId);
}

/** Blackouts that apply to this person over [startDate, endDate]. */
export async function blackoutsFor(ctx: BusinessContext, membershipId: string, startDate: string, endDate: string) {
  const locs = await memberLocationIds(ctx, membershipId);
  return ctx.db.blackoutPeriod.findMany({
    where: {
      startDate: { lte: new Date(`${endDate}T00:00:00Z`) },
      endDate: { gte: new Date(`${startDate}T00:00:00Z`) },
      OR: [{ locationId: null }, { locationId: { in: locs } }],
    },
    orderBy: { startDate: "asc" },
  });
}

/** The rules that apply to every time-off request, at submission and again at approval (§3.3). */
async function assertRules(ctx: BusinessContext, membershipId: string, v: { type: string; startDate: string; endDate: string }, today: string) {
  const blocked = await blackoutsFor(ctx, membershipId, v.startDate, v.endDate);
  if (blocked.length) {
    const b = blocked[0];
    throw new UserError(
      `Time off can't be requested ${b.startDate.toISOString().slice(0, 10)} – ${b.endDate.toISOString().slice(0, 10)}: ${b.reason}`,
      { startDate: ["Blackout period"] },
    );
  }
  const notice = ctx.business.timeOffMinNoticeDays;
  if (notice > 0 && v.type !== "sick" && v.startDate < addDaysKey(today, notice)) {
    throw new UserError(`Time off needs at least ${notice} days' notice.`, { startDate: [`At least ${notice} days ahead`] });
  }
}

function instants(v: TimeOffInput, tz: string) {
  if (v.allDay) return { startsAt: localToUtc(v.startDate, "00:00", tz), endsAt: localToUtc(addDaysKey(v.endDate, 1), "00:00", tz) };
  return { startsAt: localToUtc(v.startDate, v.startTime!, tz), endsAt: localToUtc(v.startDate, v.endTime!, tz) };
}

export async function requestTimeOff(ctx: BusinessContext, v: TimeOffInput) {
  if (!ctx.business.timeOffTypes.includes(v.type)) throw new UserError("Choose a type.", { type: ["Not available"] });
  const tz = await memberTz(ctx, ctx.membership.id);
  const today = dateKeyInTz(new Date(), tz);
  if (v.startDate < today && v.type !== "sick") throw new UserError("That date has passed.", { startDate: ["In the past"] });
  const endDate = v.allDay ? v.endDate : v.startDate;
  await assertRules(ctx, ctx.membership.id, { type: v.type, startDate: v.startDate, endDate }, today);
  const { startsAt, endsAt } = instants(v, tz);
  const overlapping = await ctx.db.timeOffRequest.findFirst({
    where: { membershipId: ctx.membership.id, status: { in: ["pending", "approved"] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
  });
  if (overlapping) throw new UserError("You already have a request covering some of this time.");
  const req = await ctx.db.timeOffRequest.create({
    data: { membershipId: ctx.membership.id, type: v.type, startsAt, endsAt, allDay: v.allDay, reason: v.reason || null } as never,
  });
  await notifyApprovers(ctx, ctx.membership.id, "timeoff.approve", "Time off requested", `${ctx.userName} requested ${v.type} time off from ${v.startDate}.`, { timeOffId: req.id });
  return { id: req.id };
}

export async function cancelTimeOff(ctx: BusinessContext, id: string) {
  const r = await ctx.db.timeOffRequest.findUnique({ where: { id } });
  if (!r || r.membershipId !== ctx.membership.id) throw new UserError("Request not found.");
  if (r.status !== "pending") throw new UserError("Only pending requests can be cancelled.");
  await ctx.db.timeOffRequest.update({ where: { id }, data: { status: "cancelled" } });
}

export const reviewSchema = z.object({ id: z.string().min(1), approve: z.boolean(), note: z.string().trim().max(500).optional().default("") });

export async function reviewTimeOff(ctx: BusinessContext, input: z.infer<typeof reviewSchema>) {
  const r = await ctx.db.timeOffRequest.findUnique({ where: { id: input.id } });
  if (!r) throw new UserError("Request not found.");
  if (r.status !== "pending") throw new UserError("This request has already been handled.");
  const authority = await assertCanReview(ctx, r.membershipId, "timeoff.approve", { type: "TimeOffRequest", id: r.id });
  if (input.approve) {
    // Self-approval skips the reviewer, never the rules: re-check blackout and notice (as of submission).
    const tz = await memberTz(ctx, r.membershipId);
    const startDate = dateKeyInTz(r.startsAt, tz);
    const endDate = dateKeyInTz(new Date(r.endsAt.getTime() - 1), tz);
    await assertRules(ctx, r.membershipId, { type: r.type, startDate, endDate }, dateKeyInTz(r.createdAt, tz));
  }
  const claimed = await ctx.db.timeOffRequest.updateMany({
    where: { id: r.id, status: "pending" },
    data: { status: input.approve ? "approved" : "denied", reviewerId: ctx.membership.id, reviewerNote: input.note || null, reviewedAt: new Date() },
  });
  if (claimed.count !== 1) throw new UserError("This request has already been handled.");
  await authority.recordSelfApproval();
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: input.approve ? "TIMEOFF_APPROVED" : "TIMEOFF_DENIED", targetType: "TimeOffRequest", targetId: r.id });
  let conflicts = 0;
  if (input.approve) conflicts = await recheckPublishedShifts(ctx, r.membershipId, { type: "timeoff", id: r.id, startsAt: r.startsAt, endsAt: r.endsAt });
  if (r.membershipId !== ctx.membership.id) {
    await notify(ctx.db, r.membershipId, "request.reviewed", input.approve ? "Time off approved" : "Time off denied", input.note || (input.approve ? "Your time off was approved." : "Your time off was denied."), { timeOffId: r.id });
  }
  return { conflicts };
}

export async function myTimeOff(ctx: BusinessContext) {
  return ctx.db.timeOffRequest.findMany({ where: { membershipId: ctx.membership.id }, orderBy: { startsAt: "desc" }, take: 50 });
}

/** Pending time off this actor can review, with the Escalated flag (§3.3). */
export async function timeOffToReview(ctx: BusinessContext) {
  if (!ctx.actor.isOwner && !ctx.actor.permissions.has("timeoff.approve")) return [];
  const pending = await ctx.db.timeOffRequest.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" } });
  return filterReviewable(ctx, pending, "timeoff.approve");
}

export async function filterReviewable<T extends { membershipId: string; createdAt: Date }>(ctx: BusinessContext, rows: T[], perm: "timeoff.approve" | "availability.approve" | "trades.approve") {
  if (!rows.length) return [];
  const members = await ctx.db.membership.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.membershipId))] } },
    include: { role: true, user: { select: { name: true } }, locations: { select: { locationId: true } } },
  });
  const allowed = new Set(await accessibleLocationIds(ctx));
  const out: (T & { requesterName: string; escalated: boolean; self: boolean })[] = [];
  for (const r of rows) {
    const m = members.find((x) => x.id === r.membershipId);
    if (!m) continue;
    const self = m.id === ctx.membership.id;
    const ok = self ? ctx.business.allowSelfTimeOffApproval : ctx.actor.isOwner || ctx.actor.rank < m.role.rank;
    // Location scope: approvers see people at their locations (or everyone with scope_all).
    const inScope = self || ctx.actor.isOwner || ctx.actor.permissions.has("locations.scope_all") || m.locations.some((l) => allowed.has(l.locationId));
    if (ok && inScope) out.push({ ...r, requesterName: m.displayName ?? m.user.name, escalated: isEscalated(ctx, r.createdAt), self });
  }
  void perm;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Blackout periods (§6.1)
// ─────────────────────────────────────────────────────────────────────────────

export const blackoutSchema = z
  .object({
    startDate: z.string().refine(isDateKey, "Choose a date"),
    endDate: z.string().refine(isDateKey, "Choose a date"),
    locationId: z.string().min(1).nullable(),
    reason: z.string().trim().min(1, "Say why — staff see this when they try to book").max(200),
  })
  .refine((v) => v.endDate >= v.startDate, { path: ["endDate"], message: "Ends before it starts" });

export async function createBlackout(ctx: BusinessContext, v: z.infer<typeof blackoutSchema>) {
  assertCan(ctx, "blackout.manage");
  if (v.locationId && !(await accessibleLocationIds(ctx)).includes(v.locationId)) throw new UserError("Location not available.");
  const b = await ctx.db.blackoutPeriod.create({
    data: { startDate: new Date(`${v.startDate}T00:00:00Z`), endDate: new Date(`${v.endDate}T00:00:00Z`), locationId: v.locationId, reason: v.reason } as never,
  });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "BLACKOUT_CREATED", targetType: "BlackoutPeriod", targetId: b.id, data: v });
  return b;
}

export async function deleteBlackout(ctx: BusinessContext, id: string) {
  assertCan(ctx, "blackout.manage");
  const n = await ctx.db.blackoutPeriod.deleteMany({ where: { id } });
  if (!n.count) throw new UserError("Blackout not found.");
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "BLACKOUT_DELETED", targetType: "BlackoutPeriod", targetId: id });
}

export async function upcomingBlackouts(ctx: BusinessContext) {
  return ctx.db.blackoutPeriod.findMany({ where: { endDate: { gte: new Date(new Date().toISOString().slice(0, 10)) } }, orderBy: { startDate: "asc" } });
}
