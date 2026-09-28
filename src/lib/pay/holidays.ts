import { addDaysKey } from "../time";
import { daysBetween } from "./periods";
import { payCents } from "./overtime";

/**
 * Statutory holidays (§7.6.4). Two separate amounts:
 *  - WORKED the holiday → premiumMultiplier is the TOTAL rate for those hours
 *    (1.5 = time and a half in all). The hours are already paid once as normal
 *    work, so the premium is hours × rate × (premiumMultiplier − 1). When
 *    `premiumRequiresEligibility` is set (e.g. BC), an ineligible employee gets
 *    regular pay only.
 *  - DID NOT WORK → an average day's pay, subject to the configured eligibility
 *    test (length of employment, days worked in a lookback window).
 * The verdict carries the inputs that produced it, and may be overridden with a reason.
 */

export interface EligibilityRule {
  minEmploymentDays: number;
  minDaysWorked: number;
  lookbackDays: number;
}

export interface AverageDayConfig {
  /** null = not configured by the owner → the amount is not calculated. */
  divisor: "days_worked" | "fixed" | null;
  fixedDivisor: number | null;
}

export interface HolidayInputs {
  holiday: { id: string; date: string; name: string; premiumMultiplier: number };
  hireDate: string | null;
  /** Paid seconds on the holiday's work-day (hourly work), with the rate for each piece. */
  workedOnHoliday: { seconds: number; rateCents: number }[];
  /** Straight-time pay per worked day in the lookback window [date − lookbackDays, date − 1]. */
  lookbackDays: { day: string; straightTimeCents: number }[];
  rule: EligibilityRule;
  premiumRequiresEligibility?: boolean;
  average: AverageDayConfig;
  override?: { eligible: boolean; reason: string } | null;
}

export interface HolidayVerdict {
  holidayId: string;
  worked: boolean;
  eligible: boolean;
  premiumSeconds: number;
  premiumCents: number;
  holidayPayCents: number;
  /** Why the not-worked amount couldn't be calculated, if so. */
  blocked: string | null;
  /** Everything that produced the verdict, for display (§7.6.4). */
  inputs: {
    employmentDays: number | null;
    minEmploymentDays: number;
    daysWorkedInLookback: number;
    minDaysWorked: number;
    lookbackFrom: string;
    lookbackTo: string;
    lookbackStraightTimeCents: number;
    divisor: string | null;
    averageDayCents: number | null;
    premiumMultiplier: number;
    premiumRequiresEligibility: boolean;
    overridden: boolean;
    overrideReason: string | null;
  };
}

export function holidayVerdict(i: HolidayInputs): HolidayVerdict {
  const from = addDaysKey(i.holiday.date, -i.rule.lookbackDays);
  const to = addDaysKey(i.holiday.date, -1);
  const window = i.lookbackDays.filter((d) => d.day >= from && d.day <= to);
  const daysWorked = window.filter((d) => d.straightTimeCents > 0).length;
  const straight = window.reduce((n, d) => n + d.straightTimeCents, 0);
  const employmentDays = i.hireDate ? daysBetween(i.hireDate, i.holiday.date) : null;

  const workedSeconds = i.workedOnHoliday.reduce((n, w) => n + w.seconds, 0);
  const worked = workedSeconds > 0;

  const testPasses = employmentDays !== null && employmentDays >= i.rule.minEmploymentDays && daysWorked >= i.rule.minDaysWorked;
  const eligible = i.override ? i.override.eligible : testPasses;

  const premiumPaid = worked && (eligible || !i.premiumRequiresEligibility);
  const premiumSeconds = premiumPaid ? workedSeconds : 0;
  const extra = Math.max(0, i.holiday.premiumMultiplier - 1);
  const premiumCents = premiumPaid ? i.workedOnHoliday.reduce((n, w) => n + payCents(w.seconds, w.rateCents, extra), 0) : 0;

  let divisorN: number | null = null;
  let blocked: string | null = null;
  if (i.average.divisor === "days_worked") divisorN = daysWorked;
  else if (i.average.divisor === "fixed" && i.average.fixedDivisor && i.average.fixedDivisor > 0) divisorN = i.average.fixedDivisor;
  else blocked = "AVERAGE_DAY_NOT_CONFIGURED";
  const averageDayCents = divisorN === null ? null : divisorN === 0 ? 0 : Math.round(straight / divisorN);

  const holidayPayCents = !worked && eligible && averageDayCents !== null ? averageDayCents : 0;
  return {
    holidayId: i.holiday.id,
    worked,
    eligible,
    premiumSeconds,
    premiumCents,
    holidayPayCents,
    blocked: !worked && eligible ? blocked : null,
    inputs: {
      employmentDays,
      minEmploymentDays: i.rule.minEmploymentDays,
      daysWorkedInLookback: daysWorked,
      minDaysWorked: i.rule.minDaysWorked,
      lookbackFrom: from,
      lookbackTo: to,
      lookbackStraightTimeCents: straight,
      divisor: i.average.divisor === "fixed" ? `fixed:${i.average.fixedDivisor}` : i.average.divisor,
      averageDayCents,
      premiumMultiplier: i.holiday.premiumMultiplier,
      premiumRequiresEligibility: !!i.premiumRequiresEligibility,
      overridden: !!i.override,
      overrideReason: i.override?.reason ?? null,
    },
  };
}
