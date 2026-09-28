import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "./auth";
import { rawDb } from "@/server/db/client";
import { tenantDb, type TenantDb } from "@/server/db/tenant";
import { can, parsePermissions, type Actor, type Permission } from "@/lib/permissions";

export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session.user as typeof session.user & { isPlatformAdmin?: boolean; locale?: string };
}

/** Active memberships a user can use right now (access not revoked, business not suspended). */
export function activeMemberships(userId: string) {
  return rawDb.membership.findMany({
    where: { userId, status: "active", accessRevokedAt: null, business: { suspendedAt: null } },
    include: { business: true, role: true },
    orderBy: { createdAt: "asc" },
  });
}

export interface BusinessContext {
  userId: string;
  userName: string;
  businessId: string;
  business: NonNullable<Awaited<ReturnType<typeof loadMembership>>>["business"];
  membership: NonNullable<Awaited<ReturnType<typeof loadMembership>>>;
  actor: Actor;
  db: TenantDb;
}

function loadMembership(userId: string, businessId: string) {
  return rawDb.membership.findFirst({
    where: { userId, businessId, status: "active", accessRevokedAt: null, business: { suspendedAt: null } },
    include: { business: true, role: true, profile: { select: { completedAt: true, pinHmac: true } } },
  });
}

async function buildContext(businessId: string): Promise<BusinessContext | null> {
  const session = await getSession();
  if (!session) return null;
  const membership = await loadMembership(session.user.id, businessId);
  if (!membership) return null;
  return {
    userId: session.user.id,
    userName: session.user.name,
    businessId,
    business: membership.business,
    membership,
    actor: {
      userId: session.user.id,
      membershipId: membership.id,
      isOwner: membership.role.isOwner,
      rank: membership.role.rank,
      permissions: new Set(parsePermissions(membership.role.permissions)),
    },
    db: tenantDb(businessId),
  };
}

/** For pages: redirects to sign-in, or 404s if the user is not an active member (never reveals existence). */
export const requireBusinessPage = cache(async (businessId: string): Promise<BusinessContext> => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const ctx = await buildContext(businessId);
  if (!ctx) notFound();
  return ctx;
});

/** For server actions / route handlers: throws instead of redirecting. */
export async function requireBusinessAction(businessId: string): Promise<BusinessContext> {
  if (typeof businessId !== "string" || !businessId) throw new NotFoundError();
  const ctx = await buildContext(businessId);
  if (!ctx) throw new NotFoundError();
  return ctx;
}

export function assertCan(ctx: Pick<BusinessContext, "actor">, perm: Permission) {
  if (!can(ctx.actor, perm)) throw new ForbiddenError();
}

export function hasPermission(ctx: Pick<BusinessContext, "actor">, perm: Permission) {
  return can(ctx.actor, perm);
}

/** Location ids this member may see (Spec §5.2). */
export async function accessibleLocationIds(ctx: BusinessContext): Promise<string[]> {
  if (can(ctx.actor, "locations.scope_all")) {
    const all = await ctx.db.location.findMany({ where: { archivedAt: null }, select: { id: true } });
    return all.map((l) => l.id);
  }
  const mine = await ctx.db.membershipLocation.findMany({
    where: { membershipId: ctx.membership.id, location: { archivedAt: null } },
    select: { locationId: true },
  });
  return mine.map((l) => l.locationId);
}
