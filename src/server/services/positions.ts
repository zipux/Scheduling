import "server-only";
import { z } from "zod";
import { assertCan, type BusinessContext } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";

export const positionSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
  requiresMinimumAge: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(12, "12 or more").max(99).nullable(),
  ),
});
export type PositionInput = z.infer<typeof positionSchema>;

export async function createPosition(ctx: BusinessContext, input: PositionInput) {
  assertCan(ctx, "business.settings");
  const dup = await ctx.db.position.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, archivedAt: null } });
  if (dup) throw new UserError("A position with that name already exists.", { name: ["Already exists"] });
  const p = await ctx.db.position.create({ data: input as never });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "POSITION_CREATED", targetType: "Position", targetId: p.id, data: input });
  return p;
}

export async function updatePosition(ctx: BusinessContext, id: string, input: PositionInput) {
  assertCan(ctx, "business.settings");
  const p = await ctx.db.position.findUnique({ where: { id } });
  if (!p) throw new UserError("Position not found.");
  await ctx.db.position.update({ where: { id }, data: input });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "POSITION_UPDATED", targetType: "Position", targetId: id, data: { before: { name: p.name, color: p.color, requiresMinimumAge: p.requiresMinimumAge }, after: input } });
}

export async function setPositionArchived(ctx: BusinessContext, id: string, archived: boolean) {
  assertCan(ctx, "business.settings");
  const p = await ctx.db.position.findUnique({ where: { id } });
  if (!p) throw new UserError("Position not found.");
  await ctx.db.position.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: archived ? "POSITION_ARCHIVED" : "POSITION_RESTORED", targetType: "Position", targetId: id });
}
