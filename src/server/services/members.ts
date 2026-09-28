import "server-only";
import { z } from "zod";
import { canManagePerson } from "@/lib/permissions";
import { assertCan, type BusinessContext } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { revokeAllSessions } from "@/server/auth/reauth";
import { activeMembershipCount } from "@/server/auth/memberships";

async function loadTarget(ctx: BusinessContext, membershipId: string) {
  const m = await ctx.db.membership.findUnique({ where: { id: membershipId }, include: { role: true } });
  if (!m) throw new UserError("Person not found.");
  return m;
}

export async function changeMemberRole(ctx: BusinessContext, input: { membershipId: string; roleId: string }) {
  assertCan(ctx, "employees.edit");
  const target = await loadTarget(ctx, input.membershipId);
  if (!canManagePerson(ctx.actor, { membershipId: target.id, rank: target.role.rank }, "employees.edit")) {
    throw new UserError("You can only change roles for people junior to you.");
  }
  const role = await ctx.db.role.findUnique({ where: { id: input.roleId } });
  if (!role) throw new UserError("Role not found.");
  if (!ctx.actor.isOwner && (role.isOwner || role.rank <= ctx.actor.rank)) {
    throw new UserError("You can only assign roles junior to your own.");
  }
  if (target.role.isOwner && !role.isOwner) {
    const owners = await ctx.db.membership.count({ where: { role: { isOwner: true }, status: "active", accessRevokedAt: null } });
    if (owners <= 1) throw new UserError("A business must keep at least one Owner.");
  }
  await ctx.db.membership.update({ where: { id: target.id }, data: { roleId: role.id } });
  await audit({
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action: "ROLE_ASSIGNED",
    targetType: "Membership",
    targetId: target.id,
    data: { from: target.roleId, to: role.id },
  });
}

export const deactivateSchema = z.object({
  membershipId: z.string().min(1),
  employmentEndedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

/**
 * §11: two independent fields. Access is revoked immediately; the payroll end date
 * is separate so the person stays in timesheets/reports for their last cheque.
 */
export async function deactivateMember(ctx: BusinessContext, input: z.infer<typeof deactivateSchema>) {
  assertCan(ctx, "employees.edit");
  if (input.membershipId === ctx.membership.id) throw new UserError("You can't deactivate yourself.");
  const target = await loadTarget(ctx, input.membershipId);
  if (!canManagePerson(ctx.actor, { membershipId: target.id, rank: target.role.rank }, "employees.edit")) {
    throw new UserError("You can only deactivate people junior to you.");
  }
  await ctx.db.membership.update({
    where: { id: target.id },
    data: {
      status: "deactivated",
      accessRevokedAt: new Date(),
      employmentEndedAt: input.employmentEndedAt ? new Date(`${input.employmentEndedAt}T00:00:00Z`) : target.employmentEndedAt,
    },
  });
  // Kill sessions unless the person still works somewhere else (that access is theirs to keep).
  if ((await activeMembershipCount(target.userId)) === 0) await revokeAllSessions(target.userId);
  await audit({
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action: "MEMBER_DEACTIVATED",
    targetType: "Membership",
    targetId: target.id,
    data: { employmentEndedAt: input.employmentEndedAt ?? null },
  });
}

export async function reactivateMember(ctx: BusinessContext, membershipId: string) {
  assertCan(ctx, "employees.edit");
  const target = await loadTarget(ctx, membershipId);
  if (!canManagePerson(ctx.actor, { membershipId: target.id, rank: target.role.rank }, "employees.edit")) {
    throw new UserError("You can only reactivate people junior to you.");
  }
  await ctx.db.membership.update({
    where: { id: target.id },
    data: { status: "active", accessRevokedAt: null, employmentEndedAt: null },
  });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "MEMBER_REACTIVATED", targetType: "Membership", targetId: target.id });
}

export const assignmentsSchema = z.object({
  membershipId: z.string().min(1),
  locationIds: z.array(z.string()),
  positionIds: z.array(z.string()),
});

/** Replace a member's locations and positions (§5.2, §5). */
export async function setMemberAssignments(ctx: BusinessContext, input: z.infer<typeof assignmentsSchema>) {
  assertCan(ctx, "employees.edit");
  const target = await loadTarget(ctx, input.membershipId);
  if (!canManagePerson(ctx.actor, { membershipId: target.id, rank: target.role.rank }, "employees.edit")) {
    throw new UserError("You can only edit people junior to you.");
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.membershipLocation.deleteMany({ where: { membershipId: target.id, locationId: { notIn: input.locationIds } } });
    await tx.membershipPosition.deleteMany({ where: { membershipId: target.id, positionId: { notIn: input.positionIds } } });
    const [haveL, haveP] = await Promise.all([
      tx.membershipLocation.findMany({ where: { membershipId: target.id }, select: { locationId: true } }),
      tx.membershipPosition.findMany({ where: { membershipId: target.id }, select: { positionId: true } }),
    ]);
    const addL = input.locationIds.filter((id) => !haveL.some((h) => h.locationId === id));
    const addP = input.positionIds.filter((id) => !haveP.some((h) => h.positionId === id));
    if (addL.length) await tx.membershipLocation.createMany({ data: addL.map((locationId) => ({ membershipId: target.id, locationId })) as never });
    if (addP.length) await tx.membershipPosition.createMany({ data: addP.map((positionId) => ({ membershipId: target.id, positionId })) as never });
  });
  await audit({
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action: "MEMBER_ASSIGNMENTS_UPDATED",
    targetType: "Membership",
    targetId: target.id,
    data: { locationIds: input.locationIds, positionIds: input.positionIds },
  });
}
