import type { Prisma } from "@/generated/prisma/client";
import { DEFAULT_ROLES } from "@/lib/permissions";
import { presetFor } from "@/lib/pay-presets";
import { holidaysFor } from "@/lib/holiday-presets";

type Tx = Prisma.TransactionClient;

export interface NewBusinessInput {
  name: string;
  country: string;
  region: string;
  timezone: string;
  currency: string;
}

/**
 * Creates a business with its default roles (Spec §3.1), and pay rules / break
 * rules seeded from the province preset (unconfirmed until the owner reviews them).
 */
export async function createBusinessWithDefaults(tx: Tx, input: NewBusinessInput) {
  const preset = presetFor(input.country, input.region);
  const business = await tx.business.create({
    data: {
      name: input.name,
      country: input.country,
      region: input.region,
      timezone: input.timezone,
      currency: input.currency,
      minorAgeThreshold: preset.minorAgeThreshold,
      vacationPayPercent: preset.vacationPayPercent,
    },
  });
  const roles: Record<string, { id: string }> = {};
  for (const r of DEFAULT_ROLES) {
    roles[r.key] = await tx.role.create({
      data: {
        businessId: business.id,
        name: r.name,
        rank: r.rank,
        permissions: r.permissions,
        isSystem: true,
        isOwner: r.isOwner,
      },
      select: { id: true },
    });
  }
  await tx.payRules.create({
    data: {
      businessId: business.id,
      presetKey: preset.key,
      dailyThresholdHours: preset.dailyThresholdHours,
      dailyMultiplier: preset.dailyMultiplier,
      dailySecondThresholdHours: preset.dailySecondThresholdHours,
      dailySecondMultiplier: preset.dailySecondMultiplier,
      weeklyThresholdHours: preset.weeklyThresholdHours,
      weeklyMultiplier: preset.weeklyMultiplier,
      minimumDailyPayHours: preset.minimumDailyPayHours,
      maxSplitShiftSpanHours: preset.maxSplitShiftSpanHours,
      holidayMinEmploymentDays: preset.holidayMinEmploymentDays,
      holidayMinDaysWorkedLookback: preset.holidayMinDaysWorkedLookback,
      holidayLookbackDays: preset.holidayLookbackDays,
      holidayAverageDivisor: preset.holidayAverageDivisor,
      holidayAverageFixedDivisor: preset.holidayAverageFixedDivisor,
      holidayPremiumRequiresEligibility: preset.holidayPremiumRequiresEligibility,
    },
  });
  for (const br of preset.breakRules) {
    await tx.breakRule.create({ data: { businessId: business.id, ...br } });
  }
  const year = new Date().getUTCFullYear();
  const holidays = [...holidaysFor(input.country, input.region, year), ...holidaysFor(input.country, input.region, year + 1)];
  if (holidays.length) {
    await tx.holiday.createMany({
      data: holidays.map((h) => ({ businessId: business.id, date: new Date(`${h.date}T00:00:00Z`), name: h.name, isStatutory: true, premiumMultiplier: preset.holidayPremiumMultiplier })),
      skipDuplicates: true,
    });
  }
  return { business, roles: roles as Record<(typeof DEFAULT_ROLES)[number]["key"], { id: string }> };
}
