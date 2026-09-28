import "server-only";
import { z } from "zod";
import { assertCan, type BusinessContext } from "@/server/auth/context";
import { audit } from "@/server/audit";

const hours = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
  z.number().min(0).max(168).nullable(),
);
const multiplier = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
  z.number().min(1, "At least 1×").max(5).nullable(),
);

export const payRulesSchema = z
  .object({
    dailyThresholdHours: hours,
    dailyMultiplier: multiplier,
    dailySecondThresholdHours: hours,
    dailySecondMultiplier: multiplier,
    weeklyThresholdHours: hours,
    weeklyMultiplier: multiplier,
    minimumDailyPayHours: hours,
    maxSplitShiftSpanHours: hours,
    vacationPayPercent: z.coerce.number().min(0).max(100),
    confirmed: z.literal(true, { error: "Confirm you've reviewed these values" }),
  })
  .superRefine((v, ctx) => {
    const pairs = [
      ["dailyThresholdHours", "dailyMultiplier"],
      ["dailySecondThresholdHours", "dailySecondMultiplier"],
      ["weeklyThresholdHours", "weeklyMultiplier"],
    ] as const;
    for (const [t, m] of pairs) {
      if ((v[t] === null) !== (v[m] === null)) {
        ctx.addIssue({ code: "custom", path: [v[t] === null ? t : m], message: "Set both the threshold and the multiplier, or neither" });
      }
    }
    if (v.dailySecondThresholdHours !== null) {
      if (v.dailyThresholdHours === null || v.dailySecondThresholdHours <= v.dailyThresholdHours) {
        ctx.addIssue({ code: "custom", path: ["dailySecondThresholdHours"], message: "Must be above the first daily threshold" });
      }
      if (v.dailyMultiplier !== null && v.dailySecondMultiplier !== null && v.dailySecondMultiplier < v.dailyMultiplier) {
        ctx.addIssue({ code: "custom", path: ["dailySecondMultiplier"], message: "Must be at least the first daily multiplier" });
      }
    }
  });
export type PayRulesInput = z.infer<typeof payRulesSchema>;

export async function savePayRules(ctx: BusinessContext, input: PayRulesInput) {
  assertCan(ctx, "payrules.manage");
  const before = await ctx.db.payRules.findUnique({ where: { businessId: ctx.businessId } });
  const { vacationPayPercent, confirmed: _confirmed, ...rules } = input;
  void _confirmed;
  await ctx.db.payRules.update({
    where: { businessId: ctx.businessId },
    data: { ...rules, confirmedAt: new Date(), confirmedById: ctx.userId },
  });
  await ctx.db.business.update({ where: { id: ctx.businessId }, data: { vacationPayPercent } });
  await audit({
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action: "PAY_RULES_UPDATED",
    targetType: "PayRules",
    targetId: before?.id,
    data: { before: JSON.parse(JSON.stringify(before)), after: JSON.parse(JSON.stringify(input)) },
  });
}
