/**
 * Seeded starting points per country/province (Spec §7.6.2, §7.6.8).
 *
 * These are a convenience the owner must review and confirm on the Pay rules
 * screen. They are NOT a statement of what the law requires, and the app never
 * claims compliance on the owner's behalf.
 */
export interface PayPreset {
  key: string;
  label: string;
  minorAgeThreshold: number;
  dailyThresholdHours: number | null;
  dailyMultiplier: number | null;
  dailySecondThresholdHours: number | null;
  dailySecondMultiplier: number | null;
  weeklyThresholdHours: number | null;
  weeklyMultiplier: number | null;
  minimumDailyPayHours: number | null;
  maxSplitShiftSpanHours: number | null;
  vacationPayPercent: number;
  holidayPremiumMultiplier: number;
  holidayMinEmploymentDays: number;
  holidayMinDaysWorkedLookback: number;
  holidayLookbackDays: number;
  breakRules: { afterHours: number; breakMinutes: number; paidWhenNotTaken: boolean }[];
}

const GENERIC: PayPreset = {
  key: "GENERIC",
  label: "Generic (no local preset)",
  minorAgeThreshold: 19,
  dailyThresholdHours: null,
  dailyMultiplier: null,
  dailySecondThresholdHours: null,
  dailySecondMultiplier: null,
  weeklyThresholdHours: 40,
  weeklyMultiplier: 1.5,
  minimumDailyPayHours: null,
  maxSplitShiftSpanHours: null,
  vacationPayPercent: 4,
  holidayPremiumMultiplier: 1.5,
  holidayMinEmploymentDays: 0,
  holidayMinDaysWorkedLookback: 0,
  holidayLookbackDays: 28,
  breakRules: [],
};

export const PAY_PRESETS: Record<string, PayPreset> = {
  "CA-ON": {
    ...GENERIC,
    key: "CA-ON",
    label: "Canada — Ontario",
    minorAgeThreshold: 18,
    weeklyThresholdHours: 44,
    minimumDailyPayHours: 3,
    breakRules: [{ afterHours: 5, breakMinutes: 30, paidWhenNotTaken: false }],
  },
  "CA-BC": {
    ...GENERIC,
    key: "CA-BC",
    label: "Canada — British Columbia",
    minorAgeThreshold: 19,
    dailyThresholdHours: 8,
    dailyMultiplier: 1.5,
    dailySecondThresholdHours: 12,
    dailySecondMultiplier: 2,
    weeklyThresholdHours: 40,
    weeklyMultiplier: 1.5,
    minimumDailyPayHours: 2,
    maxSplitShiftSpanHours: 12,
    holidayMinEmploymentDays: 30,
    holidayMinDaysWorkedLookback: 15,
    holidayLookbackDays: 30,
    breakRules: [{ afterHours: 5, breakMinutes: 30, paidWhenNotTaken: false }],
  },
  "CA-AB": {
    ...GENERIC,
    key: "CA-AB",
    label: "Canada — Alberta",
    minorAgeThreshold: 18,
    dailyThresholdHours: 8,
    dailyMultiplier: 1.5,
    weeklyThresholdHours: 44,
    weeklyMultiplier: 1.5,
    minimumDailyPayHours: 3,
    breakRules: [{ afterHours: 5, breakMinutes: 30, paidWhenNotTaken: false }],
  },
  "CA-QC": {
    ...GENERIC,
    key: "CA-QC",
    label: "Canada — Québec",
    minorAgeThreshold: 18,
    weeklyThresholdHours: 40,
    minimumDailyPayHours: 3,
    breakRules: [{ afterHours: 5, breakMinutes: 30, paidWhenNotTaken: false }],
  },
  "US-CA": {
    ...GENERIC,
    key: "US-CA",
    label: "United States — California",
    minorAgeThreshold: 18,
    dailyThresholdHours: 8,
    dailyMultiplier: 1.5,
    dailySecondThresholdHours: 12,
    dailySecondMultiplier: 2,
    weeklyThresholdHours: 40,
    weeklyMultiplier: 1.5,
    vacationPayPercent: 0,
    breakRules: [{ afterHours: 5, breakMinutes: 30, paidWhenNotTaken: true }],
  },
  "US-*": { ...GENERIC, key: "US-*", label: "United States — federal baseline", minorAgeThreshold: 18, vacationPayPercent: 0 },
  GENERIC,
};

export function presetFor(country: string, region: string): PayPreset {
  return PAY_PRESETS[`${country}-${region}`] ?? PAY_PRESETS[`${country}-*`] ?? GENERIC;
}
