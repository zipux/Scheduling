import "server-only";
import { z } from "zod";
import { randomToken } from "@/lib/crypto";
import { dateKeyInTz, isDateKey } from "@/lib/time";
import type { BusinessContext } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { assertCanReview, notify, notifyApprovers } from "./common";
import { recheckPublishedShifts } from "./conflicts";
import { filterReviewable } from "./timeoff";

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Use HH:MM");

export const availabilitySchema = z.object({
  effectiveFrom: z.string().refine(isDateKey, "Choose a date"),
  /** Index 0 = Sunday … 6 = Saturday. */
  days: z
    .array(
      z
        .object({ kind: z.enum(["all_day", "between", "unavailable"]), start: time.optional(), end: time.optional() })
        .refine((d) => d.kind !== "between" || (d.start && d.end && minutes(d.end) > minutes(d.start)), { message: "Check the hours", path: ["end"] }),
    )
    .length(7),
});
export type AvailabilityInput = z.infer<typeof availabilitySchema>;

/** §6.2: recurring weekly availability with an effective-from date; approval per business setting. */
export async function submitAvailability(ctx: BusinessContext, v: AvailabilityInput) {
  if (v.effectiveFrom < dateKeyInTz(new Date(), ctx.business.timezone)) throw new UserError("Choose today or a later date.", { effectiveFrom: ["In the past"] });
  // A new submission replaces any still-pending one.
  await ctx.db.availabilityRule.updateMany({ where: { membershipId: ctx.membership.id, status: "pending" }, data: { status: "cancelled" } });
  const requestId = `av_${randomToken(12)}`;
  const approved = !ctx.business.availabilityNeedsApproval;
  await ctx.db.availabilityRule.createMany({
    data: v.days.map((d, weekday) => ({
      membershipId: ctx.membership.id,
      weekday,
      kind: d.kind,
      startMinutes: d.kind === "between" ? minutes(d.start!) : null,
      endMinutes: d.kind === "between" ? minutes(d.end!) : null,
      effectiveFrom: new Date(`${v.effectiveFrom}T00:00:00Z`),
      requestId,
      status: approved ? "approved" : "pending",
      reviewedAt: approved ? new Date() : null,
    })) as never,
  });
  if (approved) {
    await recheckPublishedShifts(ctx, ctx.membership.id, { type: "availability", id: requestId });
  } else {
    await notifyApprovers(ctx, ctx.membership.id, "availability.approve", "Availability change", `${ctx.userName} changed their availability from ${v.effectiveFrom}.`, { requestId });
  }
  return { requestId, approved };
}

export async function cancelAvailability(ctx: BusinessContext, requestId: string) {
  const n = await ctx.db.availabilityRule.updateMany({ where: { requestId, membershipId: ctx.membership.id, status: "pending" }, data: { status: "cancelled" } });
  if (!n.count) throw new UserError("Nothing pending to cancel.");
}

export const reviewAvailabilitySchema = z.object({ requestId: z.string().min(1), approve: z.boolean(), note: z.string().trim().max(500).optional().default("") });

export async function reviewAvailability(ctx: BusinessContext, input: z.infer<typeof reviewAvailabilitySchema>) {
  const first = await ctx.db.availabilityRule.findFirst({ where: { requestId: input.requestId } });
  if (!first) throw new UserError("Request not found.");
  if (first.status !== "pending") throw new UserError("This request has already been handled.");
  const authority = await assertCanReview(ctx, first.membershipId, "availability.approve", { type: "AvailabilityRequest", id: input.requestId });
  const n = await ctx.db.availabilityRule.updateMany({
    where: { requestId: input.requestId, status: "pending" },
    data: { status: input.approve ? "approved" : "denied", reviewerId: ctx.membership.id, reviewerNote: input.note || null, reviewedAt: new Date() },
  });
  if (!n.count) throw new UserError("This request has already been handled.");
  await authority.recordSelfApproval();
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: input.approve ? "AVAILABILITY_APPROVED" : "AVAILABILITY_DENIED", targetType: "AvailabilityRequest", targetId: input.requestId });
  let conflicts = 0;
  if (input.approve) conflicts = await recheckPublishedShifts(ctx, first.membershipId, { type: "availability", id: input.requestId });
  if (first.membershipId !== ctx.membership.id) {
    await notify(ctx.db, first.membershipId, "request.reviewed", input.approve ? "Availability approved" : "Availability not approved", input.note || "", { requestId: input.requestId });
  }
  return { conflicts };
}

/** The member's current approved set, and any pending one. */
export async function myAvailability(ctx: BusinessContext) {
  const rows = await ctx.db.availabilityRule.findMany({
    where: { membershipId: ctx.membership.id, status: { in: ["approved", "pending"] } },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  const today = dateKeyInTz(new Date(), ctx.business.timezone);
  const approved = rows.filter((r) => r.status === "approved" && r.effectiveFrom.toISOString().slice(0, 10) <= today);
  const currentId = approved[0]?.requestId;
  return {
    current: currentId ? approved.filter((r) => r.requestId === currentId).sort((a, b) => a.weekday - b.weekday) : [],
    upcoming: rows.filter((r) => r.status === "approved" && r.effectiveFrom.toISOString().slice(0, 10) > today),
    pending: rows.filter((r) => r.status === "pending").sort((a, b) => a.weekday - b.weekday),
  };
}

export async function availabilityToReview(ctx: BusinessContext) {
  if (!ctx.actor.isOwner && !ctx.actor.permissions.has("availability.approve")) return [];
  const rows = await ctx.db.availabilityRule.findMany({ where: { status: "pending" }, orderBy: [{ createdAt: "asc" }, { weekday: "asc" }] });
  const byRequest = new Map<string, typeof rows>();
  for (const r of rows) byRequest.set(r.requestId, [...(byRequest.get(r.requestId) ?? []), r]);
  const groups = [...byRequest.values()].map((g) => ({ membershipId: g[0].membershipId, createdAt: g[0].createdAt, requestId: g[0].requestId, effectiveFrom: g[0].effectiveFrom, days: g }));
  return filterReviewable(ctx, groups, "availability.approve");
}
