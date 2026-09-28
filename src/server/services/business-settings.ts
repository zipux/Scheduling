import "server-only";
import { z } from "zod";
import { CURRENCIES, isValidTimezone } from "@/lib/regions";
import { assertCan, type BusinessContext } from "@/server/auth/context";
import { audit } from "@/server/audit";

const optionalPercent = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
  z.number().min(0).max(200).nullable(),
);

export const businessInfoSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  timezone: z.string().refine(isValidTimezone, "Choose a valid timezone"),
  currency: z.enum(CURRENCIES),
  minorAgeThreshold: z.coerce.number().int().min(14).max(25),
  burdenPercent: optionalPercent,
  burdenNote: z.string().trim().max(300).optional().default(""),
  directoryShowsPhone: z.boolean(),
  directoryShowsEmail: z.boolean(),
  autoChatGroups: z.boolean().default(false),
});

export const requestRulesSchema = z.object({
  allowSelfTimeOffApproval: z.boolean(),
  escalateAfterHours: z.coerce.number().int().min(1).max(720),
  timeOffMinNoticeDays: z.coerce.number().int().min(0).max(365),
  availabilityNeedsApproval: z.boolean(),
  dropNeedsApproval: z.boolean(),
  pickupNeedsApproval: z.boolean(),
  swapNeedsApproval: z.boolean(),
});

export const clockRulesSchema = z
  .object({
    clockModePersonal: z.boolean(),
    clockModeKiosk: z.boolean(),
    earlyClockInMinutes: z.coerce.number().int().min(0).max(240),
    allowUnscheduledClockIn: z.boolean(),
    roundingMode: z.enum(["none", "employee_favour", "nearest"]),
    roundingIntervalMinutes: z.coerce.number().int().refine((v) => [0, 1, 5, 6, 10, 15].includes(v), "Choose 1, 5, 6, 10 or 15"),
    lateToleranceMinutes: z.coerce.number().int().min(0).max(120),
    maxShiftHours: z.coerce.number().int().min(4).max(24),
    maxClockSkewMinutes: z.coerce.number().int().min(1).max(240),
  })
  .refine((v) => v.clockModePersonal || v.clockModeKiosk, { path: ["clockModePersonal"], message: "Enable at least one way to clock in" })
  .refine((v) => v.roundingMode === "none" || v.roundingIntervalMinutes > 0, {
    path: ["roundingIntervalMinutes"],
    message: "Choose a rounding interval",
  });

async function save(ctx: BusinessContext, action: string, data: Record<string, unknown>) {
  assertCan(ctx, "business.settings");
  const before = await ctx.db.business.findUniqueOrThrow({ where: { id: ctx.businessId } });
  await ctx.db.business.update({ where: { id: ctx.businessId }, data });
  const prev = Object.fromEntries(Object.keys(data).map((k) => [k, (before as Record<string, unknown>)[k]]));
  await audit({
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action,
    targetType: "Business",
    targetId: ctx.businessId,
    data: JSON.parse(JSON.stringify({ before: prev, after: data })),
  });
}

export function saveBusinessInfo(ctx: BusinessContext, input: z.infer<typeof businessInfoSchema>) {
  return save(ctx, "BUSINESS_UPDATED", { ...input, burdenNote: input.burdenNote || null });
}

export function saveRequestRules(ctx: BusinessContext, input: z.infer<typeof requestRulesSchema>) {
  return save(ctx, "REQUEST_RULES_UPDATED", input);
}

export function saveClockRules(ctx: BusinessContext, input: z.infer<typeof clockRulesSchema>) {
  return save(ctx, "CLOCK_RULES_UPDATED", { ...input, roundingIntervalMinutes: input.roundingMode === "none" ? 0 : input.roundingIntervalMinutes });
}
