import { wageOn, type WageRow } from "../wages";
import { isBlocking, type TimeFlag } from "../time-flags";
import { overtimeWeeks, periodsPerYear, workDayOf, inPeriod, type Frequency, type Period } from "./periods";
import { workedSeconds, unpaidBreakSeconds, type EntryTimes } from "./hours";
import { breakViolations, type BreakRuleInput } from "./breaks";
import { allocateWeek, payCents, type Allocation, type OvertimeRules, type WorkItem } from "./overtime";
import { holidayVerdict, type AverageDayConfig, type EligibilityRule, type HolidayVerdict } from "./holidays";

/**
 * Timesheet calculation (§7.5, §7.6). Pure: same inputs, same numbers.
 *
 * Anything the spec leaves open is NOT guessed: the result carries a `blocked`
 * reason instead of a number, and approval is refused (PROGRESS.md "Blocked").
 */

export interface PayEntry extends EntryTimes {
  id: string;
  tz: string;
  positionId: string | null;
  flags: { id?: string; type: TimeFlag; resolved: boolean }[];
}

export interface HolidayDef {
  id: string;
  date: string;
  name: string;
  isStatutory: boolean;
  premiumMultiplier: number;
  eligibilityRule?: Partial<EligibilityRule> | null;
  override?: { eligible: boolean; reason: string } | null;
}

export interface TimesheetInput {
  period: Period;
  frequency: Frequency;
  anchor: string | null;
  workDayStartMinutes: number;
  rules: OvertimeRules & { minimumDailyPayHours: number | null };
  vacationPayPercent: number;
  breakRules: BreakRuleInput[];
  holidayRule: EligibilityRule;
  /** When true, working a holiday earns the premium only if the eligibility test passes. */
  holidayPremiumRequiresEligibility?: boolean;
  average: AverageDayConfig;
  wages: WageRow[];
  hireDate: string | null;
  /** Entries in the period AND in the holiday lookback window before it. */
  entries: PayEntry[];
  holidays: HolidayDef[];
}

export type BlockedCode = "NO_WAGE" | "WEEK_UNDEFINED" | "AVERAGE_DAY_NOT_CONFIGURED";

export interface PayLine {
  kind: "regular" | "overtime" | "min_daily_topup" | "holiday_premium" | "holiday_pay" | "salary";
  seconds: number;
  rateCents: number;
  multiplier: number;
  cents: number;
  label: string;
}

export interface TimesheetResult {
  period: Period;
  salaried: boolean;
  days: { workDay: string; seconds: number; breakSeconds: number; entryIds: string[] }[];
  workedSeconds: number;
  regularSeconds: number;
  overtime: { tier: "daily1" | "daily2" | "weekly"; multiplier: number; seconds: number }[];
  breakSeconds: number;
  topUpSeconds: number;
  holidays: HolidayVerdict[];
  lines: PayLine[];
  grossCents: number;
  vacationAccruedCents: number;
  unresolvedFlags: { entryId: string; flagId?: string; type: TimeFlag; blocking: boolean }[];
  unpayableEntryIds: string[];
  breakViolations: { entryId: string; afterHours: number; breakMinutes: number; longestStretchSeconds: number }[];
  blocked: { code: BlockedCode; detail: string }[];
}

const H = 3600;

const sum = (list: Allocation[], k: "daily1" | "daily2" | "weekly") => list.reduce((n, a) => n + a[k], 0);

/** Weighted-average straight-time rate in cents/hour (unrounded; the pay line rounds once). */
function weightedRate(parts: { seconds: number; rateCents: number }[]): number {
  const secs = parts.reduce((n, p) => n + p.seconds, 0);
  return secs ? parts.reduce((n, p) => n + p.seconds * p.rateCents, 0) / secs : 0;
}

export function entryWorkDay(e: PayEntry, workDayStartMinutes: number): string | null {
  const anchor = e.clockIn ?? e.clockOut;
  return anchor ? workDayOf(anchor, e.tz, workDayStartMinutes) : null;
}

export function calculateTimesheet(input: TimesheetInput): TimesheetResult {
  const blocked: TimesheetResult["blocked"] = [];
  const withDay = input.entries.map((e) => ({ e, day: entryWorkDay(e, input.workDayStartMinutes) }));
  const mine = withDay.filter((x) => x.day && inPeriod(input.period, x.day));

  // Rate: the wage in force on the work-day the hours were worked, so a raise applies
  // from its effective date. Salaried status is judged on the period's first day.
  const rateFor = (day: string, positionId: string | null) => wageOn(input.wages, day, positionId);
  const general = rateFor(input.period.start, null);
  const salaried = general?.type === "salary";

  const unresolvedFlags = mine.flatMap(({ e }) =>
    e.flags.filter((f) => !f.resolved).map((f) => ({ entryId: e.id, flagId: f.id, type: f.type, blocking: isBlocking(f.type) })),
  );
  const unpayableEntryIds: string[] = [];
  const items: WorkItem[] = [];
  const dayMap = new Map<string, { seconds: number; breakSeconds: number; entryIds: string[] }>();
  const violations: TimesheetResult["breakViolations"] = [];

  for (const { e, day } of mine) {
    const secs = workedSeconds(e);
    const d = dayMap.get(day!) ?? { seconds: 0, breakSeconds: 0, entryIds: [] };
    d.entryIds.push(e.id);
    dayMap.set(day!, d);
    if (secs === null) {
      unpayableEntryIds.push(e.id);
      continue;
    }
    d.seconds += secs;
    d.breakSeconds += unpaidBreakSeconds(e);
    for (const v of breakViolations(e, input.breakRules)) {
      violations.push({ entryId: e.id, afterHours: v.rule.afterHours, breakMinutes: v.rule.breakMinutes, longestStretchSeconds: v.longestStretchSeconds });
    }
    if (salaried) continue;
    const wage = rateFor(day!, e.positionId);
    if (!wage || wage.type !== "hourly") {
      if (!blocked.some((b) => b.code === "NO_WAGE")) blocked.push({ code: "NO_WAGE", detail: `No hourly wage is in force on ${day}.` });
      continue;
    }
    items.push({ entryId: e.id, workDay: day!, start: (e.clockInRounded ?? e.clockIn)!, seconds: secs, rateCents: wage.rateCents });
  }

  const lines: PayLine[] = [];
  const overtime: TimesheetResult["overtime"] = [];
  let regularSeconds = 0;

  if (salaried) {
    // Salaried: no hourly calculation and excluded from overtime (§8).
    const cents = Math.round(general!.rateCents / periodsPerYear(input.frequency));
    lines.push({ kind: "salary", seconds: 0, rateCents: general!.rateCents, multiplier: 1, cents, label: "Salary" });
  } else if (items.length) {
    const hasWeekly = input.rules.weeklyThresholdHours !== null && input.rules.weeklyMultiplier !== null;
    let weeks = overtimeWeeks(input.frequency, input.period);
    if (!weeks) {
      if (hasWeekly) {
        blocked.push({
          code: "WEEK_UNDEFINED",
          detail: "Weekly overtime is set, but the spec doesn't define which week applies for semi-monthly or monthly pay periods.",
        });
      }
      // Daily overtime doesn't depend on weeks: treat the period as one block with no weekly threshold.
      weeks = [input.period];
    }
    const rules: OvertimeRules = !overtimeWeeks(input.frequency, input.period) ? { ...input.rules, weeklyThresholdHours: null, weeklyMultiplier: null } : input.rules;

    const agg = new Map<string, PayLine>();
    const add = (kind: PayLine["kind"], seconds: number, rateCents: number, multiplier: number, label: string) => {
      if (!seconds) return;
      const k = `${kind}|${label}|${rateCents}|${multiplier}`;
      const l = agg.get(k) ?? { kind, seconds: 0, rateCents, multiplier, cents: 0, label };
      l.seconds += seconds;
      agg.set(k, l);
    };

    for (const w of weeks) {
      const weekItems = items.filter((i) => i.workDay >= w.start && i.workDay <= w.end);
      if (!weekItems.length) continue;
      const r = allocateWeek(weekItems, rules);
      regularSeconds += r.regularSeconds;
      for (const b of r.buckets) {
        const existing = overtime.find((o) => o.tier === b.tier && o.multiplier === b.multiplier);
        if (existing) existing.seconds += b.seconds;
        else overtime.push({ ...b });
      }
      const m1 = r.buckets.find((b) => b.tier === "daily1")?.multiplier ?? 1;
      const m2 = r.buckets.find((b) => b.tier === "daily2")?.multiplier ?? 1;
      const mw = r.buckets.find((b) => b.tier === "weekly")?.multiplier ?? 1;
      // Straight time is paid at each hour's own rate. Overtime is paid at the weighted-average
      // straight-time rate of the hours it was measured against: daily overtime at that
      // work-day's average (all its hours), weekly overtime at the average of the week's
      // non-consumed hours (the ones the weekly threshold counted). One rate → that rate.
      for (const a of r.items) add("regular", a.regular, a.rateCents, 1, "Regular");
      for (const day of new Set(r.items.map((a) => a.workDay))) {
        const list = r.items.filter((a) => a.workDay === day);
        const avg = weightedRate(list.map((a) => ({ seconds: a.seconds, rateCents: a.rateCents })));
        add("overtime", sum(list, "daily1"), avg, m1, `Daily overtime ×${m1}`);
        add("overtime", sum(list, "daily2"), avg, m2, `Daily overtime ×${m2}`);
      }
      if (sum(r.items, "weekly")) {
        const avg = weightedRate(r.items.map((a) => ({ seconds: a.regular + a.weekly, rateCents: a.rateCents })));
        add("overtime", sum(r.items, "weekly"), avg, mw, `Weekly overtime ×${mw}`);
      }
    }
    // Round once per line (seconds × rate × multiplier).
    for (const l of agg.values()) {
      l.cents = payCents(l.seconds, l.rateCents, l.multiplier);
      lines.push(l);
    }
  }

  // Minimum daily pay (§7.6.6): reported for work but worked less → pay the minimum. Not overtime hours.
  let topUpSeconds = 0;
  const minDaily = input.rules.minimumDailyPayHours;
  if (!salaried && minDaily && minDaily > 0) {
    const byDay = new Map<string, WorkItem[]>();
    for (const i of items) byDay.set(i.workDay, [...(byDay.get(i.workDay) ?? []), i]);
    for (const [, list] of byDay) {
      const worked = list.reduce((n, i) => n + i.seconds, 0);
      const min = Math.round(minDaily * H);
      if (worked > 0 && worked < min) {
        const rate = [...list].sort((a, b) => a.start.getTime() - b.start.getTime())[0].rateCents;
        topUpSeconds += min - worked;
        lines.push({ kind: "min_daily_topup", seconds: min - worked, rateCents: rate, multiplier: 1, cents: payCents(min - worked, rate, 1), label: "Minimum daily pay top-up" });
      }
    }
  }

  // Statutory holidays (§7.6.4).
  const holidays: HolidayVerdict[] = [];
  if (!salaried) {
    const straightByDay = new Map<string, number>();
    for (const { e, day } of withDay) {
      if (!day) continue;
      const secs = workedSeconds(e);
      if (secs === null) continue;
      const wage = rateFor(day, e.positionId);
      if (!wage || wage.type !== "hourly") continue;
      straightByDay.set(day, (straightByDay.get(day) ?? 0) + payCents(secs, wage.rateCents, 1));
    }
    for (const h of input.holidays.filter((x) => x.isStatutory && inPeriod(input.period, x.date))) {
      const rule = { ...input.holidayRule, ...(h.eligibilityRule ?? {}) };
      const v = holidayVerdict({
        holiday: h,
        hireDate: input.hireDate,
        workedOnHoliday: items.filter((i) => i.workDay === h.date).map((i) => ({ seconds: i.seconds, rateCents: i.rateCents })),
        lookbackDays: [...straightByDay.entries()].map(([day, straightTimeCents]) => ({ day, straightTimeCents })),
        rule,
        premiumRequiresEligibility: !!input.holidayPremiumRequiresEligibility,
        average: input.average,
        override: h.override ?? null,
      });
      holidays.push(v);
      // The premium line is only the addition on top of the regular line: (multiplier − 1).
      if (v.premiumCents) lines.push({ kind: "holiday_premium", seconds: v.premiumSeconds, rateCents: 0, multiplier: h.premiumMultiplier - 1, cents: v.premiumCents, label: `${h.name} premium` });
      if (v.holidayPayCents) lines.push({ kind: "holiday_pay", seconds: 0, rateCents: 0, multiplier: 1, cents: v.holidayPayCents, label: `${h.name} holiday pay` });
      if (v.blocked && !blocked.some((b) => b.code === "AVERAGE_DAY_NOT_CONFIGURED")) {
        blocked.push({ code: "AVERAGE_DAY_NOT_CONFIGURED", detail: "Set how an average day's pay is calculated on the Pay rules screen." });
      }
    }
  }

  const grossCents = lines.reduce((n, l) => n + l.cents, 0);
  const days = [...dayMap.entries()].map(([workDay, d]) => ({ workDay, ...d })).sort((a, b) => a.workDay.localeCompare(b.workDay));
  return {
    period: input.period,
    salaried,
    days,
    workedSeconds: days.reduce((n, d) => n + d.seconds, 0),
    regularSeconds,
    overtime,
    breakSeconds: days.reduce((n, d) => n + d.breakSeconds, 0),
    topUpSeconds,
    holidays,
    lines,
    grossCents,
    // §7.6.5: vacation accrues on gross wages of the timesheet.
    vacationAccruedCents: Math.round((grossCents * input.vacationPayPercent) / 100),
    unresolvedFlags,
    unpayableEntryIds,
    breakViolations: violations,
    blocked,
  };
}
