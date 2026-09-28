import "server-only";
import { can, canReviewRequest, parsePermissions, type Permission, type RequestPermission } from "@/lib/permissions";
import { isEligibleFor, type EligibilityCandidate, type EligibilityShift } from "@/lib/eligibility";
import { ForbiddenError, type BusinessContext } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import type { TenantDb } from "@/server/db/tenant";

/** In-app notification, shown immediately (requests aren't batched; §6 "notifications to both sides"). */
export async function notify(db: TenantDb, membershipId: string, type: string, title: string, body: string, payload?: object) {
  await db.notification.create({ data: { membershipId, type, title, body, payload: (payload ?? undefined) as never } as never });
}

/** Everyone who could review a request of this type from `requesterId` (permission + seniority). */
export async function approversFor(ctx: BusinessContext, requesterId: string, perm: Permission) {
  const requester = await ctx.db.membership.findUniqueOrThrow({ where: { id: requesterId }, include: { role: true } });
  const members = await ctx.db.membership.findMany({ where: { status: "active", accessRevokedAt: null }, include: { role: true } });
  return members.filter((m) => {
    if (m.id === requesterId) return false;
    const perms = parsePermissions(m.role.permissions);
    const holds = m.role.isOwner || perms.includes(perm);
    return holds && (m.role.isOwner || m.role.rank < requester.role.rank);
  });
}

export async function notifyApprovers(ctx: BusinessContext, requesterId: string, perm: Permission, title: string, body: string, payload?: object) {
  for (const a of await approversFor(ctx, requesterId, perm)) await notify(ctx.db, a.id, "request.pending", title, body, payload);
}

/**
 * §3.3: may this actor review a request from `requesterId`? Self-approval only
 * when Business.allowSelfTimeOffApproval is on; every self-approval is audited.
 * Self-approval skips the reviewer, never the rules — callers re-check them.
 */
export async function assertCanReview(ctx: BusinessContext, requesterId: string, perm: RequestPermission, requestRef: { type: string; id: string }) {
  const requester = await ctx.db.membership.findUnique({ where: { id: requesterId }, include: { role: true } });
  if (!requester) throw new UserError("Request not found.");
  const r = canReviewRequest(ctx.actor, { membershipId: requester.id, rank: requester.role.rank }, perm, ctx.business.allowSelfTimeOffApproval);
  if (!r.allowed) {
    if (!can(ctx.actor, perm)) throw new ForbiddenError();
    throw new UserError(r.self ? "Self-approval is turned off for this business." : "You can only review requests from people junior to you.");
  }
  return {
    self: r.self,
    async recordSelfApproval() {
      if (r.self) {
        await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "SELF_APPROVED", targetType: requestRef.type, targetId: requestRef.id });
      }
    },
  };
}

/** Escalated (§3.3): self-approval is off and the request has waited longer than escalateAfterHours. */
export function isEscalated(ctx: Pick<BusinessContext, "business">, createdAt: Date, now = new Date()) {
  return !ctx.business.allowSelfTimeOffApproval && now.getTime() - createdAt.getTime() > ctx.business.escalateAfterHours * 3600_000;
}

// ─────────────────────────────────────────────────────────────────────────────
// Eligibility data loading (§6.0)
// ─────────────────────────────────────────────────────────────────────────────

type ShiftForEligibility = { id: string; positionId: string | null; locationId: string; startsAt: Date; endsAt: Date };

export async function eligibilityShift(ctx: BusinessContext, s: ShiftForEligibility): Promise<EligibilityShift> {
  const [loc, pos] = await Promise.all([
    ctx.db.location.findUniqueOrThrow({ where: { id: s.locationId }, select: { timezone: true } }),
    s.positionId ? ctx.db.position.findUnique({ where: { id: s.positionId }, select: { requiresMinimumAge: true } }) : null,
  ]);
  return { ...s, tz: loc.timezone, requiresMinimumAge: pos?.requiresMinimumAge ?? null };
}

export async function loadCandidate(ctx: BusinessContext, membershipId: string, around: { startsAt: Date; endsAt: Date }): Promise<EligibilityCandidate> {
  const from = new Date(around.startsAt.getTime() - 2 * 86400_000);
  const to = new Date(around.endsAt.getTime() + 2 * 86400_000);
  const m = await ctx.db.membership.findUniqueOrThrow({
    where: { id: membershipId },
    include: { role: true, positions: true, locations: true, profile: { select: { dateOfBirth: true } } },
  });
  const [shifts, timeOff] = await Promise.all([
    ctx.db.shift.findMany({ where: { membershipId, deletedAt: null, startsAt: { lt: to }, endsAt: { gt: from } }, select: { id: true, startsAt: true, endsAt: true } }),
    ctx.db.timeOffRequest.findMany({ where: { membershipId, status: "approved", startsAt: { lt: to }, endsAt: { gt: from } }, select: { startsAt: true, endsAt: true } }),
  ]);
  return {
    membershipId,
    active: m.status === "active" && !m.accessRevokedAt,
    positionIds: m.positions.map((p) => p.positionId),
    locationIds: m.locations.map((l) => l.locationId),
    scopeAll: m.role.isOwner || parsePermissions(m.role.permissions).includes("locations.scope_all"),
    dob: m.profile?.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    shifts,
    approvedTimeOff: timeOff,
  };
}

export async function checkEligible(ctx: BusinessContext, membershipId: string, shift: ShiftForEligibility, ignoreShiftIds: string[] = []) {
  const es = await eligibilityShift(ctx, shift);
  return isEligibleFor(await loadCandidate(ctx, membershipId, shift), es, ignoreShiftIds);
}

const REASON_TEXT: Record<string, string> = {
  INACTIVE: "they no longer have access",
  POSITION: "they don't work that position",
  LOCATION: "they don't work at that location",
  AGE: "they're below the minimum age for that position",
  OVERLAP: "it overlaps another of their shifts",
  TIME_OFF: "they have approved time off then",
};

export function ineligibleMessage(who: "you" | string, reasons: string[]) {
  const text = reasons.map((r) => REASON_TEXT[r] ?? r).join("; ");
  return who === "you" ? `You can't take this shift: ${text.replaceAll("they're", "you're").replaceAll("they ", "you ").replaceAll("their", "your")}.` : `${who} can't take this shift: ${text}.`;
}

/** Prisma unique-constraint violation (e.g. the one-active-claim index). */
export function isUniqueViolation(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
}
