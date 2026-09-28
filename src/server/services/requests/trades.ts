import "server-only";
import { z } from "zod";
import { accessibleLocationIds, type BusinessContext } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { isEligibleFor } from "@/lib/eligibility";
import { enqueueScheduleChange, loadShiftForNotify, weekOfShift } from "../schedule-notify";
import { assertCanReview, checkEligible, eligibilityShift, ineligibleMessage, isUniqueViolation, loadCandidate, notify, notifyApprovers } from "./common";
import { filterReviewable } from "./timeoff";

/**
 * Shift drop / pickup / swap (§6.3).
 *
 * - The original employee stays responsible until a change is approved.
 * - Eligibility (§6.0) failures block every trade.
 * - Claiming happens in a transaction with a conditional update
 *   (`UPDATE … WHERE membershipId IS NULL` / `= dropper`); zero rows means
 *   "already taken". A partial unique index allows at most one pending-or-approved
 *   claim per shift per claimable round.
 */

export const ALREADY_TAKEN = "Someone else just took this shift.";

async function loadTradableShift(ctx: BusinessContext, shiftId: string) {
  const s = await loadShiftForNotify(ctx.db, shiftId);
  if (!s || s.deletedAt || s.status !== "published") throw new UserError("Shift not found.");
  if (s.startsAt <= new Date()) throw new UserError("This shift has already started.");
  return s;
}

async function pendingDrop(ctx: BusinessContext, shiftId: string) {
  return ctx.db.shiftTradeRequest.findFirst({ where: { shiftId, type: "drop", status: "pending" } });
}

/** Moves a shift from `from` to `to` iff it is still assigned to `from` in the same claim round. */
async function transfer(
  tx: Pick<BusinessContext["db"], "shift">,
  shift: { id: string; claimGeneration: number },
  from: string | null,
  to: string | null,
) {
  const n = await tx.shift.updateMany({
    where: { id: shift.id, membershipId: from, claimGeneration: shift.claimGeneration, deletedAt: null },
    data: { membershipId: to, claimGeneration: { increment: 1 } },
  });
  return n.count === 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Drop
// ─────────────────────────────────────────────────────────────────────────────

export async function dropShift(ctx: BusinessContext, shiftId: string) {
  const s = await loadTradableShift(ctx, shiftId);
  if (s.membershipId !== ctx.membership.id) throw new UserError("You can only drop your own shifts.");
  const existing = await ctx.db.shiftTradeRequest.findFirst({ where: { shiftId, status: "pending", type: { in: ["drop", "swap"] } } });
  if (existing) throw new UserError("This shift already has a pending request.");
  const auto = !ctx.business.dropNeedsApproval;
  const req = await ctx.db.shiftTradeRequest.create({
    data: { type: "drop", shiftId, fromMembershipId: ctx.membership.id, status: auto ? "approved" : "pending", reviewedAt: auto ? new Date() : null } as never,
  });
  if (auto) {
    // No approval needed: the shift becomes an open shift right away.
    await enqueueScheduleChange(ctx.db, s, s.id, [ctx.membership.id], weekOfShift(s, s.location.timezone));
    if (!(await transfer(ctx.db, s, ctx.membership.id, null))) throw new UserError("This shift changed. Refresh and try again.");
  } else {
    // Offered to eligible staff while the dropper stays responsible.
    await ctx.db.shift.update({ where: { id: s.id }, data: { claimGeneration: { increment: 1 } } });
    await notifyApprovers(ctx, ctx.membership.id, "trades.approve", "Shift dropped", `${ctx.userName} offered a shift.`, { tradeId: req.id });
  }
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "SHIFT_DROPPED", targetType: "Shift", targetId: s.id, data: { tradeId: req.id, auto } });
  return { id: req.id, auto };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pickup (claim)
// ─────────────────────────────────────────────────────────────────────────────

export async function claimShift(ctx: BusinessContext, shiftId: string) {
  const s = await loadTradableShift(ctx, shiftId);
  const drop = s.membershipId ? await pendingDrop(ctx, shiftId) : null;
  if (s.membershipId && !drop) throw new UserError("This shift isn't available.");
  if (s.membershipId === ctx.membership.id) throw new UserError("This is already your shift.");
  if (!(await accessibleLocationIds(ctx)).includes(s.locationId)) throw new UserError("This shift isn't available.");
  const elig = await checkEligible(ctx, ctx.membership.id, s);
  if (!elig.eligible) throw new UserError(ineligibleMessage("you", elig.reasons));

  const from = s.membershipId; // null for an open shift, the dropper otherwise
  const needsApproval = ctx.business.pickupNeedsApproval || (!!drop && ctx.business.dropNeedsApproval);

  if (needsApproval) {
    try {
      const req = await ctx.db.shiftTradeRequest.create({
        data: { type: "pickup", shiftId, fromMembershipId: from, toMembershipId: ctx.membership.id, claimGeneration: s.claimGeneration, status: "pending" } as never,
      });
      await notifyApprovers(ctx, ctx.membership.id, "trades.approve", "Shift claimed", `${ctx.userName} wants to pick up a shift.`, { tradeId: req.id });
      return { id: req.id, status: "pending" as const };
    } catch (err) {
      if (isUniqueViolation(err)) throw new UserError(ALREADY_TAKEN);
      throw err;
    }
  }

  try {
    const id = await ctx.db.$transaction(async (tx) => {
      if (!(await transfer(tx, s, from, ctx.membership.id))) throw new UserError(ALREADY_TAKEN);
      const req = await tx.shiftTradeRequest.create({
        data: { type: "pickup", shiftId, fromMembershipId: from, toMembershipId: ctx.membership.id, claimGeneration: s.claimGeneration, status: "approved", reviewedAt: new Date() } as never,
      });
      if (drop) await tx.shiftTradeRequest.update({ where: { id: drop.id }, data: { status: "approved", toMembershipId: ctx.membership.id, reviewedAt: new Date() } });
      return req.id;
    });
    await enqueueScheduleChange(ctx.db, s, s.id, [from, ctx.membership.id], weekOfShift(s, s.location.timezone));
    if (from) await notify(ctx.db, from, "request.reviewed", "Your shift was picked up", `${ctx.userName} picked up your shift.`, { tradeId: id });
    await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "SHIFT_PICKED_UP", targetType: "Shift", targetId: s.id, data: { tradeId: id } });
    return { id, status: "approved" as const };
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserError(ALREADY_TAKEN);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Swap
// ─────────────────────────────────────────────────────────────────────────────

export const swapSchema = z.object({ shiftId: z.string().min(1), swapShiftId: z.string().min(1) });

async function assertMutualEligibility(ctx: BusinessContext, mine: { id: string; membershipId: string | null } & Parameters<typeof checkEligible>[2], theirs: typeof mine) {
  const [a, b] = await Promise.all([
    checkEligible(ctx, theirs.membershipId!, mine, [theirs.id]),
    checkEligible(ctx, mine.membershipId!, theirs, [mine.id]),
  ]);
  if (!b.eligible) throw new UserError(ineligibleMessage("you", b.reasons));
  if (!a.eligible) {
    const who = await ctx.db.membership.findUniqueOrThrow({ where: { id: theirs.membershipId! }, include: { user: { select: { name: true } } } });
    throw new UserError(ineligibleMessage(who.displayName ?? who.user.name, a.reasons));
  }
}

export async function proposeSwap(ctx: BusinessContext, input: z.infer<typeof swapSchema>) {
  const mine = await loadTradableShift(ctx, input.shiftId);
  const theirs = await loadTradableShift(ctx, input.swapShiftId);
  if (mine.membershipId !== ctx.membership.id) throw new UserError("You can only swap your own shifts.");
  if (!theirs.membershipId || theirs.membershipId === ctx.membership.id) throw new UserError("Choose a coworker's shift.");
  const busy = await ctx.db.shiftTradeRequest.findFirst({ where: { status: "pending", OR: [{ shiftId: { in: [mine.id, theirs.id] } }, { swapShiftId: { in: [mine.id, theirs.id] } }] } });
  if (busy) throw new UserError("One of these shifts already has a pending request.");
  await assertMutualEligibility(ctx, mine, theirs);
  const req = await ctx.db.shiftTradeRequest.create({
    data: { type: "swap", shiftId: mine.id, swapShiftId: theirs.id, fromMembershipId: ctx.membership.id, toMembershipId: theirs.membershipId, status: "pending" } as never,
  });
  await notify(ctx.db, theirs.membershipId, "request.pending", "Swap proposed", `${ctx.userName} wants to swap shifts with you.`, { tradeId: req.id });
  return { id: req.id };
}

async function executeSwap(ctx: BusinessContext, req: { id: string; shiftId: string; swapShiftId: string | null; fromMembershipId: string | null; toMembershipId: string | null }) {
  const a = await loadTradableShift(ctx, req.shiftId);
  const b = await loadTradableShift(ctx, req.swapShiftId!);
  await assertMutualEligibility(ctx, a, b);
  await ctx.db.$transaction(async (tx) => {
    const ok1 = await transfer(tx, a, req.fromMembershipId, req.toMembershipId);
    const ok2 = await transfer(tx, b, req.toMembershipId, req.fromMembershipId);
    if (!ok1 || !ok2) throw new UserError("One of these shifts has changed since the swap was proposed.");
    await tx.shiftTradeRequest.update({ where: { id: req.id }, data: { status: "approved", reviewedAt: new Date(), reviewerId: ctx.membership.id } });
  });
  await enqueueScheduleChange(ctx.db, a, a.id, [req.fromMembershipId, req.toMembershipId], weekOfShift(a, a.location.timezone));
  await enqueueScheduleChange(ctx.db, b, b.id, [req.fromMembershipId, req.toMembershipId], weekOfShift(b, b.location.timezone));
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "SHIFT_SWAPPED", targetType: "ShiftTradeRequest", targetId: req.id });
}

export const respondSwapSchema = z.object({ id: z.string().min(1), accept: z.boolean() });

/** The coworker accepts or declines; with no approval needed, acceptance completes the swap. */
export async function respondToSwap(ctx: BusinessContext, input: z.infer<typeof respondSwapSchema>) {
  const req = await ctx.db.shiftTradeRequest.findUnique({ where: { id: input.id } });
  if (!req || req.type !== "swap" || req.toMembershipId !== ctx.membership.id) throw new UserError("Request not found.");
  if (req.status !== "pending" || req.coworkerAcceptedAt) throw new UserError("This request has already been answered.");
  if (!input.accept) {
    await ctx.db.shiftTradeRequest.update({ where: { id: req.id }, data: { status: "denied", reviewedAt: new Date() } });
    await notify(ctx.db, req.fromMembershipId!, "request.reviewed", "Swap declined", `${ctx.userName} declined your swap.`, { tradeId: req.id });
    return { completed: false };
  }
  await ctx.db.shiftTradeRequest.update({ where: { id: req.id }, data: { coworkerAcceptedAt: new Date() } });
  if (!ctx.business.swapNeedsApproval) {
    await executeSwap(ctx, req);
    await notify(ctx.db, req.fromMembershipId!, "request.reviewed", "Swap done", `${ctx.userName} accepted your swap.`, { tradeId: req.id });
    return { completed: true };
  }
  await notifyApprovers(ctx, req.fromMembershipId!, "trades.approve", "Swap needs approval", "Two staff agreed to swap shifts.", { tradeId: req.id });
  return { completed: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Manager review (approve / deny) and cancellation
// ─────────────────────────────────────────────────────────────────────────────

export const reviewTradeSchema = z.object({ id: z.string().min(1), approve: z.boolean(), note: z.string().trim().max(500).optional().default("") });

export async function reviewTrade(ctx: BusinessContext, input: z.infer<typeof reviewTradeSchema>) {
  const req = await ctx.db.shiftTradeRequest.findUnique({ where: { id: input.id } });
  if (!req || req.status !== "pending") throw new UserError("This request has already been handled.");
  // The requester: the claimer for a pickup, the proposer for a drop or swap.
  const requester = req.type === "pickup" ? req.toMembershipId! : req.fromMembershipId!;
  const authority = await assertCanReview(ctx, requester, "trades.approve", { type: "ShiftTradeRequest", id: req.id });
  if (req.type === "swap") {
    // The approver must also be senior to the coworker (or be them, under self-approval).
    const other = await ctx.db.membership.findUniqueOrThrow({ where: { id: req.toMembershipId! }, include: { role: true } });
    const ok = ctx.actor.isOwner || other.id === ctx.membership.id ? ctx.business.allowSelfTimeOffApproval || ctx.actor.isOwner : ctx.actor.rank < other.role.rank;
    if (!ok) throw new UserError("You can only approve swaps between people junior to you.");
    if (input.approve && !req.coworkerAcceptedAt) throw new UserError("The coworker hasn't accepted yet.");
  }

  if (!input.approve) {
    await ctx.db.shiftTradeRequest.update({ where: { id: req.id }, data: { status: "denied", reviewerId: ctx.membership.id, reviewerNote: input.note || null, reviewedAt: new Date() } });
    await notify(ctx.db, requester, "request.reviewed", "Request denied", input.note || "Your shift request was denied.", { tradeId: req.id });
    await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "TRADE_DENIED", targetType: "ShiftTradeRequest", targetId: req.id });
    return;
  }

  const s = await loadTradableShift(ctx, req.shiftId);
  if (req.type === "pickup") {
    const elig = await checkEligible(ctx, req.toMembershipId!, s);
    if (!elig.eligible) throw new UserError(ineligibleMessage("They", elig.reasons));
    if (s.claimGeneration !== req.claimGeneration) throw new UserError("This shift has changed since it was claimed.");
    await ctx.db.$transaction(async (tx) => {
      if (!(await transfer(tx, s, req.fromMembershipId, req.toMembershipId))) throw new UserError("This shift has changed since it was claimed.");
      await tx.shiftTradeRequest.update({ where: { id: req.id }, data: { status: "approved", reviewerId: ctx.membership.id, reviewerNote: input.note || null, reviewedAt: new Date() } });
      await tx.shiftTradeRequest.updateMany({ where: { shiftId: s.id, type: "drop", status: "pending" }, data: { status: "approved", toMembershipId: req.toMembershipId, reviewedAt: new Date() } });
    });
    await enqueueScheduleChange(ctx.db, s, s.id, [req.fromMembershipId, req.toMembershipId], weekOfShift(s, s.location.timezone));
    if (req.fromMembershipId) await notify(ctx.db, req.fromMembershipId, "request.reviewed", "Your shift was handed over", "A manager approved the pickup of your shift.", { tradeId: req.id });
  } else if (req.type === "drop") {
    const claim = await ctx.db.shiftTradeRequest.findFirst({ where: { shiftId: s.id, type: "pickup", status: "pending" } });
    if (claim) throw new UserError("Someone has claimed this shift — review their pickup instead.");
    await enqueueScheduleChange(ctx.db, s, s.id, [req.fromMembershipId], weekOfShift(s, s.location.timezone));
    await ctx.db.$transaction(async (tx) => {
      if (!(await transfer(tx, s, req.fromMembershipId, null))) throw new UserError("This shift has changed.");
      await tx.shiftTradeRequest.update({ where: { id: req.id }, data: { status: "approved", reviewerId: ctx.membership.id, reviewerNote: input.note || null, reviewedAt: new Date() } });
    });
  } else {
    await executeSwap(ctx, req);
  }
  await authority.recordSelfApproval();
  await notify(ctx.db, requester, "request.reviewed", "Request approved", input.note || "Your shift request was approved.", { tradeId: req.id });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "TRADE_APPROVED", targetType: "ShiftTradeRequest", targetId: req.id, data: { type: req.type } });
}

export async function cancelTrade(ctx: BusinessContext, id: string) {
  const req = await ctx.db.shiftTradeRequest.findUnique({ where: { id } });
  const mine = req && (req.type === "pickup" ? req.toMembershipId : req.fromMembershipId) === ctx.membership.id;
  if (!req || !mine) throw new UserError("Request not found.");
  if (req.status !== "pending") throw new UserError("Only pending requests can be cancelled.");
  if (req.type === "drop") {
    const claim = await ctx.db.shiftTradeRequest.findFirst({ where: { shiftId: req.shiftId, type: "pickup", status: "pending" } });
    if (claim) throw new UserError("Someone has already claimed this shift; ask a manager.");
  }
  await ctx.db.shiftTradeRequest.update({ where: { id }, data: { status: "cancelled" } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────────────────────────────────────

const SHIFT_VIEW = { location: { select: { name: true, timezone: true } }, position: { select: { name: true, color: true, requiresMinimumAge: true } } } as const;

/** Open and offered shifts this member is eligible for (§6.3 "open to eligible staff"). */
export async function availableShifts(ctx: BusinessContext) {
  const allowed = await accessibleLocationIds(ctx);
  const now = new Date();
  const [open, drops] = await Promise.all([
    ctx.db.shift.findMany({ where: { status: "published", deletedAt: null, membershipId: null, startsAt: { gt: now }, locationId: { in: allowed } }, include: SHIFT_VIEW, orderBy: { startsAt: "asc" }, take: 100 }),
    ctx.db.shiftTradeRequest.findMany({ where: { type: "drop", status: "pending" } }),
  ]);
  const offered = drops.length
    ? await ctx.db.shift.findMany({
        where: { id: { in: drops.map((d) => d.shiftId) }, status: "published", deletedAt: null, startsAt: { gt: now }, locationId: { in: allowed }, membershipId: { not: ctx.membership.id } },
        include: SHIFT_VIEW,
      })
    : [];
  const all = [...open, ...offered];
  if (!all.length) return [];
  const myClaims = await ctx.db.shiftTradeRequest.findMany({ where: { type: "pickup", status: "pending", toMembershipId: ctx.membership.id } });
  const cand = await loadCandidate(ctx, ctx.membership.id, { startsAt: all[0].startsAt, endsAt: all.reduce((m, s) => (s.endsAt > m ? s.endsAt : m), all[0].endsAt) });
  const out = [];
  for (const s of all) {
    const es = { id: s.id, positionId: s.positionId, locationId: s.locationId, startsAt: s.startsAt, endsAt: s.endsAt, tz: s.location.timezone, requiresMinimumAge: s.position?.requiresMinimumAge ?? null };
    if (!isEligibleFor(cand, es).eligible) continue;
    out.push({ shift: s, offered: !!s.membershipId, claimed: myClaims.some((c) => c.shiftId === s.id) });
  }
  return out.sort((a, b) => a.shift.startsAt.getTime() - b.shift.startsAt.getTime());
}

/** Coworkers' shifts this member could swap `myShiftId` with (mutually eligible). */
export async function swapCandidates(ctx: BusinessContext, myShiftId: string) {
  const mine = await loadTradableShift(ctx, myShiftId);
  if (mine.membershipId !== ctx.membership.id) throw new UserError("Shift not found.");
  const allowed = await accessibleLocationIds(ctx);
  const window = 14 * 86400_000;
  const others = await ctx.db.shift.findMany({
    where: {
      status: "published",
      deletedAt: null,
      membershipId: { notIn: [ctx.membership.id] },
      NOT: { membershipId: null },
      locationId: { in: allowed },
      startsAt: { gt: new Date(), gte: new Date(mine.startsAt.getTime() - window), lte: new Date(mine.startsAt.getTime() + window) },
    },
    include: { ...SHIFT_VIEW, membership: { include: { user: { select: { name: true } } } } },
    orderBy: { startsAt: "asc" },
    take: 60,
  });
  const esMine = await eligibilityShift(ctx, mine);
  const meCand = await loadCandidate(ctx, ctx.membership.id, { startsAt: new Date(mine.startsAt.getTime() - window), endsAt: new Date(mine.endsAt.getTime() + window) });
  const out = [];
  for (const o of others) {
    const esTheirs = { id: o.id, positionId: o.positionId, locationId: o.locationId, startsAt: o.startsAt, endsAt: o.endsAt, tz: o.location.timezone, requiresMinimumAge: o.position?.requiresMinimumAge ?? null };
    if (!isEligibleFor(meCand, esTheirs, [mine.id]).eligible) continue;
    const them = await loadCandidate(ctx, o.membershipId!, mine);
    if (!isEligibleFor(them, esMine, [o.id]).eligible) continue;
    out.push(o);
    if (out.length >= 20) break;
  }
  return out;
}

export async function myTrades(ctx: BusinessContext) {
  return ctx.db.shiftTradeRequest.findMany({
    where: { OR: [{ fromMembershipId: ctx.membership.id }, { toMembershipId: ctx.membership.id }], status: "pending" },
    orderBy: { createdAt: "desc" },
  });
}

export async function tradesToReview(ctx: BusinessContext) {
  if (!ctx.actor.isOwner && !ctx.actor.permissions.has("trades.approve")) return [];
  const rows = await ctx.db.shiftTradeRequest.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" } });
  // Swaps reach managers only once the coworker has accepted.
  const reviewable = rows
    .filter((r) => r.type !== "swap" || r.coworkerAcceptedAt)
    .map((r) => ({ ...r, membershipId: r.type === "pickup" ? r.toMembershipId! : r.fromMembershipId! }));
  return filterReviewable(ctx, reviewable, "trades.approve");
}

export async function shiftsById(ctx: BusinessContext, ids: string[]) {
  const rows = await ctx.db.shift.findMany({ where: { id: { in: ids } }, include: { ...SHIFT_VIEW, membership: { include: { user: { select: { name: true } } } } } });
  return new Map(rows.map((r) => [r.id, r]));
}

/** For "My shifts": which shifts already have a pending trade, and which have started. */
export async function tradeState(ctx: BusinessContext, shifts: { id: string; startsAt: Date }[]) {
  const ids = shifts.map((s) => s.id);
  const pending = await ctx.db.shiftTradeRequest.findMany({
    where: { status: "pending", OR: [{ shiftId: { in: ids } }, { swapShiftId: { in: ids } }] },
    select: { shiftId: true, swapShiftId: true },
  });
  const now = new Date();
  return {
    busy: new Set(pending.flatMap((p) => [p.shiftId, p.swapShiftId]).filter((x): x is string => !!x)),
    started: new Set(shifts.filter((s) => s.startsAt <= now).map((s) => s.id)),
  };
}
