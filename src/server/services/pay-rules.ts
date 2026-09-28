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

export const workDaySchema = z.object({ workDayStartMinutes: z.coerce.number().int().min(0).max(1439) });

export async function saveWorkDayStart(ctx: BusinessContext, input: z.infer<typeof workDaySchema>) {
  assertCan(ctx, "payrules.manage");
  await ctx.db.business.update({ where: { id: ctx.businessId }, data: { workDayStartMinutes: input.workDayStartMinutes } });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "PAY_RULES_UPDATED", data: { workDayStartMinutes: input.workDayStartMinutes } });
}

export const holidayRulesSchema = z
  .object({
    holidayMinEmploymentDays: z.coerce.number().int().min(0).max(3650),
    holidayMinDaysWorkedLookback: z.coerce.number().int().min(0).max(366),
    holidayLookbackDays: z.coerce.number().int().min(1).max(366),
    holidayAverageDivisor: z.enum(["days_worked", "fixed"]).nullable(),
    holidayAverageFixedDivisor: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().int().min(1).max(366).nullable()),
    holidayPremiumRequiresEligibility: z.boolean().default(false),
  })
  .refine((v) => v.holidayAverageDivisor !== "fixed" || v.holidayAverageFixedDivisor, { path: ["holidayAverageFixedDivisor"], message: "Enter the number to divide by" });

export async function saveHolidayRules(ctx: BusinessContext, input: z.infer<typeof holidayRulesSchema>) {
  assertCan(ctx, "payrules.manage");
  await ctx.db.payRules.update({
    where: { businessId: ctx.businessId },
    data: { ...input, holidayAverageFixedDivisor: input.holidayAverageDivisor === "fixed" ? input.holidayAverageFixedDivisor : null },
  });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "PAY_RULES_UPDATED", data: input });
}

export const breakRuleSchema = z.object({
  afterHours: z.coerce.number().min(0.5).max(24),
  breakMinutes: z.coerce.number().int().min(5).max(240),
});

export async function addBreakRule(ctx: BusinessContext, input: z.infer<typeof breakRuleSchema>) {
  assertCan(ctx, "payrules.manage");
  const r = await ctx.db.breakRule.create({ data: input as never });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "BREAK_RULE_ADDED", targetType: "BreakRule", targetId: r.id, data: input });
}

export async function deleteBreakRule(ctx: BusinessContext, id: string) {
  assertCan(ctx, "payrules.manage");
  await ctx.db.breakRule.deleteMany({ where: { id } });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "BREAK_RULE_DELETED", targetType: "BreakRule", targetId: id });
}
