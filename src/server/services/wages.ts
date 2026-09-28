import "server-only";
import { z } from "zod";
import { canManagePerson, canViewWage } from "@/lib/permissions";
import { assertCan, ForbiddenError, type BusinessContext } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";

export const wageSchema = z.object({
  membershipId: z.string().min(1),
  rateCents: z.number().int().min(1, "Enter an amount").max(100_000_000),
  type: z.enum(["hourly", "salary"]),
  positionId: z.string().min(1).nullable(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
});

/**
 * Wages are append-only history (§8): a change is a new row with an effective
 * date. It may not take effect inside or before an approved pay period, so an
 * approved timesheet is never rewritten.
 */
export async function addWage(ctx: BusinessContext, input: z.infer<typeof wageSchema>) {
  assertCan(ctx, "wages.edit");
  const target = await ctx.db.membership.findUnique({ where: { id: input.membershipId }, include: { role: true } });
  if (!target) throw new UserError("Person not found.");
  const self = target.id === ctx.membership.id;
  if (self ? !ctx.actor.isOwner : !canManagePerson(ctx.actor, { membershipId: target.id, rank: target.role.rank }, "wages.edit")) {
    throw new UserError(self ? "You can't change your own wage." : "You can only change wages for people junior to you.");
  }
  if (input.type === "salary" && input.positionId) {
    throw new UserError("A salary applies to the person, not a single position.", { positionId: ["Leave blank for salary"] });
  }
  const effective = new Date(`${input.effectiveFrom}T00:00:00Z`);
  const locked = await ctx.db.payPeriod.findFirst({ where: { status: "approved", endDate: { gte: effective } }, orderBy: { endDate: "desc" } });
  if (locked) {
    throw new UserError(
      `That date falls in an approved pay period (ending ${locked.endDate.toISOString().slice(0, 10)}). Choose a later date.`,
      { effectiveFrom: ["Inside an approved pay period"] },
    );
  }
  const wage = await ctx.db.wage.create({
    data: {
      membershipId: target.id,
      rateCents: input.rateCents,
      type: input.type,
      positionId: input.positionId,
      effectiveFrom: effective,
      createdById: ctx.userId,
    } as never,
  });
  await audit({
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action: "WAGE_CHANGED",
    targetType: "Membership",
    targetId: target.id,
    data: { wageId: wage.id, rateCents: input.rateCents, type: input.type, positionId: input.positionId, effectiveFrom: input.effectiveFrom },
  });
  return wage;
}

export async function listWages(ctx: BusinessContext, membershipId: string) {
  if (!canViewWage(ctx.actor, membershipId)) throw new ForbiddenError();
  return ctx.db.wage.findMany({ where: { membershipId }, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }] });
}
