import "server-only";
import { z } from "zod";
import { assertCan, type BusinessContext } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { createLocation, locationSchema } from "./locations";
import { payRulesSchema, savePayRules } from "./pay-rules";

export const setupSchema = z.object({
  location: locationSchema,
  payPeriodFrequency: z.enum(["weekly", "biweekly", "semimonthly", "monthly"]),
  payPeriodAnchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the first day of a pay period"),
  payRules: payRulesSchema,
});

/** Owner setup wizard (§4.1): first location + geofence, pay period, pay rules, roles confirmed. */
export async function completeSetup(ctx: BusinessContext, input: z.infer<typeof setupSchema>) {
  assertCan(ctx, "business.settings");
  assertCan(ctx, "payrules.manage");
  if (ctx.business.setupCompletedAt) throw new UserError("Setup is already complete.");
  const loc = await createLocation(ctx, input.location);
  await ctx.db.membershipLocation.create({ data: { membershipId: ctx.membership.id, locationId: loc.id } as never });
  await savePayRules(ctx, input.payRules);
  await ctx.db.business.update({
    where: { id: ctx.businessId },
    data: {
      payPeriodFrequency: input.payPeriodFrequency,
      payPeriodAnchorDate: new Date(`${input.payPeriodAnchorDate}T00:00:00Z`),
      setupCompletedAt: new Date(),
    },
  });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "BUSINESS_SETUP_COMPLETED" });
}
