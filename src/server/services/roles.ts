import "server-only";
import { z } from "zod";
import { PERMISSIONS, can, parsePermissions, type Permission } from "@/lib/permissions";
import { assertCan, type BusinessContext } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";

export const roleSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(60),
  rank: z.coerce.number().int().min(2, "Rank 1 is reserved for Owner").max(99),
  permissions: z.array(z.enum(PERMISSIONS)).default([]),
});
export type RoleInput = z.infer<typeof roleSchema>;

/** Non-owners may only create/edit roles junior to themselves, and only grant permissions they hold. */
function assertCanShape(ctx: BusinessContext, input: RoleInput) {
  if (ctx.actor.isOwner) return;
  if (input.rank <= ctx.actor.rank) {
    throw new UserError("You can only manage roles junior to your own.", { rank: [`Must be greater than ${ctx.actor.rank}`] });
  }
  const extra = input.permissions.filter((p) => !can(ctx.actor, p));
  if (extra.length) {
    throw new UserError("You can't grant permissions you don't hold yourself.", { permissions: extra });
  }
}

export async function createRole(ctx: BusinessContext, input: RoleInput) {
  assertCan(ctx, "roles.manage");
  assertCanShape(ctx, input);
  const role = await ctx.db.role.create({
    data: { name: input.name, rank: input.rank, permissions: input.permissions, isSystem: false, isOwner: false } as never,
  });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "ROLE_CREATED", targetType: "Role", targetId: role.id, data: input });
  return role;
}

async function loadEditable(ctx: BusinessContext, roleId: string) {
  assertCan(ctx, "roles.manage");
  const role = await ctx.db.role.findUnique({ where: { id: roleId } });
  if (!role) throw new UserError("Role not found.");
  if (role.isOwner) throw new UserError("The Owner role always has every permission and can't be changed.");
  if (!ctx.actor.isOwner && role.rank <= ctx.actor.rank) throw new UserError("You can only manage roles junior to your own.");
  return role;
}

export async function updateRole(ctx: BusinessContext, roleId: string, input: RoleInput) {
  const role = await loadEditable(ctx, roleId);
  assertCanShape(ctx, input);
  // A non-owner may not strip a permission they don't hold either (they couldn't restore it).
  if (!ctx.actor.isOwner) {
    const removed = parsePermissions(role.permissions).filter((p) => !input.permissions.includes(p));
    const outOfReach = removed.filter((p: Permission) => !can(ctx.actor, p));
    if (outOfReach.length) throw new UserError("You can't change permissions you don't hold yourself.");
  }
  await ctx.db.role.update({ where: { id: role.id }, data: { name: input.name, rank: input.rank, permissions: input.permissions } });
  await audit({
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action: "ROLE_UPDATED",
    targetType: "Role",
    targetId: role.id,
    data: { before: { name: role.name, rank: role.rank, permissions: role.permissions }, after: input },
  });
}

export async function deleteRole(ctx: BusinessContext, roleId: string) {
  const role = await loadEditable(ctx, roleId);
  const [members, invites] = await Promise.all([
    ctx.db.membership.count({ where: { roleId: role.id } }),
    ctx.db.invitation.count({ where: { roleId: role.id, status: "pending" } }),
  ]);
  if (members || invites) throw new UserError("Move everyone (and pending invitations) off this role before deleting it.");
  await ctx.db.role.delete({ where: { id: role.id } });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "ROLE_DELETED", targetType: "Role", targetId: role.id, data: { name: role.name } });
}
