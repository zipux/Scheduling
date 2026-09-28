/**
 * §7.6.9 — required pay-calculation tests, with expected values written in.
 * READ THESE: they are the part of the build most worth a human's eyes.
 *
 * Unless stated otherwise: America/Toronto, $20.00/h (2000¢), bi-weekly periods
 * anchored Monday 2026-10-05 (periods Oct 5–18, Oct 19–Nov 1), work-day starts 04:00.
 */
import { describe, expect, it } from "vitest";
import { calculateTimesheet, type PayEntry, type TimesheetInput } from "@/lib/pay/calculate";
import { approvalGate } from "@/lib/pay/approval";
import { periodContaining, periodEndsAt, periodHasEnded, workDayOf } from "@/lib/pay/periods";
import { breakViolations } from "@/lib/pay/breaks";
import { localToUtc, addDaysKey } from "@/lib/time";
import type { TimeFlag } from "@/lib/time-flags";

const TZ = "America/Toronto";
const RATE = 2000;
const H = 3600;

let n = 0;
/** An entry from local "YYYY-MM-DD HH:mm" to local "YYYY-MM-DD HH:mm" (Toronto). */
function e(from: string, to: string | null, opts: { breaks?: [string, string][]; flags?: TimeFlag[]; resolved?: boolean; positionId?: string | null } = {}): PayEntry {
  const t = (s: string) => localToUtc(s.slice(0, 10), s.slice(11, 16), TZ);
  return {
    id: `e${++n}`,
    tz: TZ,
    positionId: opts.positionId ?? null,
    clockIn: t(from),
    clockOut: to ? t(to) : null,
    breaks: (opts.breaks ?? []).map(([a, b]) => ({ startsAt: t(a), endsAt: t(b) })),
    flags: (opts.flags ?? []).map((type) => ({ type, resolved: !!opts.resolved })),
  };
}

const BC = { dailyThresholdHours: 8, dailyMultiplier: 1.5, dailySecondThresholdHours: 12, dailySecondMultiplier: 2, weeklyThresholdHours: 40, weeklyMultiplier: 1.5, minimumDailyPayHours: null };
const ON = { dailyThresholdHours: null, dailyMultiplier: null, dailySecondThresholdHours: null, dailySecondMultiplier: null, weeklyThresholdHours: 44, weeklyMultiplier: 1.5, minimumDailyPayHours: null };

function input(entries: PayEntry[], over: Partial<TimesheetInput> = {}): TimesheetInput {
  return {
    period: { start: "2026-10-05", end: "2026-10-18" },
    frequency: "biweekly",
    anchor: "2026-10-05",
    workDayStartMinutes: 240,
    rules: BC,
    vacationPayPercent: 4,
    breakRules: [],
    holidayRule: { minEmploymentDays: 30, minDaysWorked: 15, lookbackDays: 30 },
    average: { divisor: "days_worked", fixedDivisor: null },
    wages: [{ rateCents: RATE, type: "hourly", positionId: null, effectiveFrom: "2026-01-01" }],
    hireDate: "2025-01-01",
    entries,
    holidays: [],
    ...over,
  };
}

const ot = (r: ReturnType<typeof calculateTimesheet>, tier: string) => r.overtime.find((o) => o.tier === tier)?.seconds ?? 0;

// ─────────────────────────────────────────────────────────────────────────────
describe("§7.6.2 — a 12-hour day inside a 46-hour week (order of operations)", () => {
  // Mon 12 h (07:00–19:00) + Tue–Fri 8.5 h each (09:00–17:30) = 46 h.
  const week = () => [
    e("2026-10-05 07:00", "2026-10-05 19:00"),
    ...["06", "07", "08", "09"].map((d) => e(`2026-10-${d} 09:00`, `2026-10-${d} 17:30`)),
  ];

  it("BC-style rules (daily 8 h ×1.5, 12 h ×2, weekly 40 h ×1.5): 40 h regular + 6 h daily OT, 0 h weekly OT", () => {
    const r = calculateTimesheet(input(week()));
    // Daily: Mon 12−8 = 4 h; Tue–Fri 0.5 h × 4 = 2 h → 6 h consumed.
    // Weekly: only the 46 − 6 = 40 remaining hours count → none over 40.
    expect(r.workedSeconds).toBe(46 * H);
    expect(r.regularSeconds).toBe(40 * H);
    expect(ot(r, "daily1")).toBe(6 * H);
    expect(ot(r, "daily2")).toBe(0);
    expect(ot(r, "weekly")).toBe(0); // NOT 6: consumed daily hours are never counted again
    // $800.00 regular + 6 × $20 × 1.5 = $180.00 → $980.00
    expect(r.grossCents).toBe(98_000);
    expect(r.blocked).toEqual([]);
  });

  it("Ontario-style rules (weekly 44 h ×1.5 only): 44 h regular + 2 h weekly OT", () => {
    const r = calculateTimesheet(input(week(), { rules: ON }));
    expect(r.regularSeconds).toBe(44 * H);
    expect(ot(r, "weekly")).toBe(2 * H);
    // $880.00 + 2 × $30.00 = $940.00
    expect(r.grossCents).toBe(94_000);
  });

  it("overlapping daily tiers pay the higher multiplier once: a 13 h day = 8 h + 4 h ×1.5 + 1 h ×2", () => {
    const r = calculateTimesheet(input([e("2026-10-05 07:00", "2026-10-05 20:00")]));
    expect(r.regularSeconds).toBe(8 * H);
    expect(ot(r, "daily1")).toBe(4 * H);
    expect(ot(r, "daily2")).toBe(1 * H);
    // $160 + $120 + $40 = $320.00 (the 13th hour is ×2, not ×1.5 + ×2)
    expect(r.grossCents).toBe(32_000);
  });

  it("the weekly threshold then applies to the next week separately", () => {
    const two = [...week(), e("2026-10-12 09:00", "2026-10-12 17:00")];
    const r = calculateTimesheet(input(two));
    expect(r.regularSeconds).toBe(48 * H);
    expect(ot(r, "daily1")).toBe(6 * H);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§7.6.1 — an entry crossing the pay-period boundary (21:00 Sunday → 02:10 Monday)", () => {
  const boundary = () => [e("2026-10-18 21:00", "2026-10-19 02:10")];

  it("belongs whole and undivided to the period containing its clock-in", () => {
    const r = calculateTimesheet(input(boundary()));
    expect(r.workedSeconds).toBe(5 * H + 10 * 60); // 5 h 10 min, all in Oct 5–18
    expect(r.days.map((d) => d.workDay)).toEqual(["2026-10-18"]);
    // 5 h 10 m × $20 = $103.33
    expect(r.grossCents).toBe(10_333);
  });

  it("contributes nothing to the next period", () => {
    const next = calculateTimesheet(input(boundary(), { period: { start: "2026-10-19", end: "2026-11-01" } }));
    expect(next.workedSeconds).toBe(0);
    expect(next.grossCents).toBe(0);
  });

  it("the same rule decides the period of a clock-in after midnight but before 04:00", () => {
    // Clock-in Mon 01:00 belongs to Sunday's work-day → the Oct 5–18 period.
    expect(workDayOf(localToUtc("2026-10-19", "01:00", TZ), TZ, 240)).toBe("2026-10-18");
    expect(periodContaining("biweekly", "2026-10-05", "2026-10-18")).toEqual({ start: "2026-10-05", end: "2026-10-18" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("DST — elapsed hours match wall-clock reality, not naive arithmetic", () => {
  it("21:00 Sat 31 Oct → 05:00 Sun 1 Nov (clocks fall back at 02:00) is 9 h, not 8 h", () => {
    const r = calculateTimesheet(input([e("2026-10-31 21:00", "2026-11-01 05:00")], { period: { start: "2026-10-19", end: "2026-11-01" }, rules: ON }));
    expect(r.workedSeconds).toBe(9 * H);
    expect(r.grossCents).toBe(18_000); // 9 × $20
  });

  it("21:00 Sat 7 Mar → 05:00 Sun 8 Mar 2026 (clocks spring forward) is 7 h, not 8 h", () => {
    const r = calculateTimesheet(input([e("2026-03-07 21:00", "2026-03-08 05:00")], { period: { start: "2026-03-02", end: "2026-03-15" }, anchor: "2026-03-02", rules: ON }));
    expect(r.workedSeconds).toBe(7 * H);
    expect(r.grossCents).toBe(14_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("a shift crossing midnight with workDayStart 04:00 (daily overtime)", () => {
  // Tue 16:00–23:00 (7 h), then clocked in again Wed 01:00–03:00 (2 h).
  const entries = () => [e("2026-10-06 16:00", "2026-10-06 23:00"), e("2026-10-07 01:00", "2026-10-07 03:00"), e("2026-10-07 10:00", "2026-10-07 15:00")];

  it("with 04:00, the 01:00 clock-in belongs to Tuesday: Tue = 9 h → 1 h daily OT; Wed = 5 h", () => {
    const r = calculateTimesheet(input(entries()));
    expect(r.days).toEqual([
      expect.objectContaining({ workDay: "2026-10-06", seconds: 9 * H }),
      expect.objectContaining({ workDay: "2026-10-07", seconds: 5 * H }),
    ]);
    expect(ot(r, "daily1")).toBe(1 * H);
    // 13 h regular × $20 = $260 + 1 h × $20 × 1.5 = $30 → $290
    expect(r.regularSeconds).toBe(13 * H);
    expect(r.grossCents).toBe(29_000);
  });

  it("the same shifts with workDayStart 00:00 split Tue 7 h / Wed 7 h → no daily OT", () => {
    const r = calculateTimesheet(input(entries(), { workDayStartMinutes: 0 }));
    expect(ot(r, "daily1")).toBe(0);
    expect(r.grossCents).toBe(28_000);
  });

  it("an overnight close is one entry on the day it started, never split at midnight", () => {
    const r = calculateTimesheet(input([e("2026-10-06 21:00", "2026-10-07 02:10")]));
    expect(r.days).toEqual([expect.objectContaining({ workDay: "2026-10-06", seconds: 5 * H + 600 })]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§7.6.4 — statutory holiday worked / not worked, eligible / ineligible", () => {
  // Thanksgiving Mon 12 Oct 2026, premium ×1.5. Eligibility: 30 days employed and
  // 15 days worked in the 30 days before (Sep 12 – Oct 11). Average day = straight-time
  // wages in that window ÷ days worked.
  const holiday = { id: "thanks", date: "2026-10-12", name: "Thanksgiving", isStatutory: true, premiumMultiplier: 1.5 };
  // 20 prior days of 8 h (Sep 14 – Oct 3) → $160/day, $3,200 in the window.
  const history = () => Array.from({ length: 20 }, (_, i) => addDaysKey("2026-09-14", i)).map((d) => e(`${d} 09:00`, `${d} 17:00`));
  const worksHoliday = () => e("2026-10-12 10:00", "2026-10-12 18:00");

  // premiumMultiplier is the TOTAL rate for holiday hours worked: ×1.5 = time and a half
  // in all, so the premium on top of the normal pay is (1.5 − 1) = ×0.5.
  it("worked, eligible, BC: 8 h at $20 = $240.00 for the hours worked (not $400): $160.00 normal + $80.00 premium", () => {
    const r = calculateTimesheet(input([...history(), worksHoliday()], { holidays: [holiday], holidayPremiumRequiresEligibility: true }));
    const v = r.holidays[0];
    expect(v).toMatchObject({ worked: true, eligible: true, premiumSeconds: 8 * H, premiumCents: 8_000, holidayPayCents: 0 });
    expect(r.grossCents).toBe(24_000);
  });

  it("worked, ineligible (hired 1 Oct), BC (premium requires eligibility): regular pay only, $160.00", () => {
    const r = calculateTimesheet(input([worksHoliday()], { holidays: [holiday], hireDate: "2026-10-01", holidayPremiumRequiresEligibility: true }));
    expect(r.holidays[0]).toMatchObject({ worked: true, eligible: false, premiumSeconds: 0, premiumCents: 0, holidayPayCents: 0 });
    expect(r.holidays[0].inputs).toMatchObject({ premiumRequiresEligibility: true });
    expect(r.grossCents).toBe(16_000);
  });

  it("worked, ineligible, where the premium doesn't require eligibility (the default): $160.00 + $80.00 premium", () => {
    const r = calculateTimesheet(input([worksHoliday()], { holidays: [holiday], hireDate: "2026-10-01" }));
    expect(r.holidays[0]).toMatchObject({ worked: true, eligible: false, premiumCents: 8_000, holidayPayCents: 0 });
    expect(r.grossCents).toBe(24_000);
  });

  it("a ×1 holiday adds no premium", () => {
    const r = calculateTimesheet(input([...history(), worksHoliday()], { holidays: [{ ...holiday, premiumMultiplier: 1 }] }));
    expect(r.holidays[0]).toMatchObject({ worked: true, premiumCents: 0 });
    expect(r.grossCents).toBe(16_000);
  });

  it("not worked, eligible: an average day's pay = $3,200.00 ÷ 20 days = $160.00, with the inputs shown", () => {
    const r = calculateTimesheet(input(history(), { holidays: [holiday] }));
    const v = r.holidays[0];
    expect(v).toMatchObject({ worked: false, eligible: true, holidayPayCents: 16_000 });
    expect(v.inputs).toMatchObject({
      employmentDays: 649, // 2025-01-01 → 2026-10-12
      daysWorkedInLookback: 20,
      lookbackFrom: "2026-09-12",
      lookbackTo: "2026-10-11",
      lookbackStraightTimeCents: 320_000,
      averageDayCents: 16_000,
    });
    // The history is in the previous period, so this period's gross is the holiday pay alone.
    expect(r.grossCents).toBe(16_000);
  });

  it("not worked, ineligible (hired 20 Sep → 22 days employed): nothing, and the inputs say why", () => {
    const recent = Array.from({ length: 15 }, (_, i) => addDaysKey("2026-09-21", i)).map((d) => e(`${d} 09:00`, `${d} 17:00`));
    const r = calculateTimesheet(input(recent, { holidays: [holiday], hireDate: "2026-09-20" }));
    expect(r.holidays[0]).toMatchObject({ worked: false, eligible: false, holidayPayCents: 0 });
    expect(r.holidays[0].inputs).toMatchObject({ employmentDays: 22, minEmploymentDays: 30, daysWorkedInLookback: 15 });
  });

  it("a manual override with a reason makes an ineligible employee eligible", () => {
    const recent = Array.from({ length: 15 }, (_, i) => addDaysKey("2026-09-21", i)).map((d) => e(`${d} 09:00`, `${d} 17:00`));
    const r = calculateTimesheet(input(recent, { holidays: [{ ...holiday, override: { eligible: true, reason: "Transferred from our other site" } }], hireDate: "2026-09-20" }));
    expect(r.holidays[0]).toMatchObject({ eligible: true, holidayPayCents: 16_000 });
    expect(r.holidays[0].inputs).toMatchObject({ overridden: true, overrideReason: "Transferred from our other site" });
  });

  it("if the owner hasn't configured how an average day is calculated, the amount is blocked — never guessed", () => {
    const r = calculateTimesheet(input(history(), { holidays: [holiday], average: { divisor: null, fixedDivisor: null } }));
    expect(r.holidays[0].holidayPayCents).toBe(0);
    expect(r.blocked.map((b) => b.code)).toEqual(["AVERAGE_DAY_NOT_CONFIGURED"]);
    expect(approvalGate(r, { isOwner: true, withExceptions: true }).allowed).toBe(false);
  });

  it("a fixed divisor (e.g. 20) works too: $3,200 ÷ 20 = $160.00", () => {
    const r = calculateTimesheet(input(history(), { holidays: [holiday], average: { divisor: "fixed", fixedDivisor: 20 } }));
    expect(r.holidays[0].holidayPayCents).toBe(16_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§7.6.5 — vacation accrual on an approved timesheet", () => {
  it("accrues 4% of gross wages: 4% × $980.00 = $39.20", () => {
    const week = [e("2026-10-05 07:00", "2026-10-05 19:00"), ...["06", "07", "08", "09"].map((d) => e(`2026-10-${d} 09:00`, `2026-10-${d} 17:30`))];
    const r = calculateTimesheet(input(week));
    expect(r.grossCents).toBe(98_000);
    expect(r.vacationAccruedCents).toBe(3_920);
  });

  it("accrues on all gross earnings, including holiday premium: 4% × $240.00 = $9.60", () => {
    const r = calculateTimesheet(input([e("2026-10-12 10:00", "2026-10-12 18:00")], { holidays: [{ id: "h", date: "2026-10-12", name: "Thanksgiving", isStatutory: true, premiumMultiplier: 1.5 }] }));
    expect(r.grossCents).toBe(24_000);
    expect(r.vacationAccruedCents).toBe(960);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§7.6.7 — approval blocked by each blocking flag in turn", () => {
  const blocking: TimeFlag[] = ["MISSING_CLOCK_OUT", "MISSING_CLOCK_IN", "BREAK_MISSED", "OFFLINE_QUEUED"];
  const nonBlocking: TimeFlag[] = ["GEO_UNCERTAIN", "GEO_OUTSIDE", "OFFSITE", "UNSCHEDULED", "LATE", "EARLY_LEAVE"];

  it.each(blocking)("%s blocks a manager's approval", (flag) => {
    const r = calculateTimesheet(input([e("2026-10-06 09:00", "2026-10-06 17:00", { flags: [flag] })]));
    expect(approvalGate(r, { isOwner: false, withExceptions: false })).toEqual({ allowed: false, reason: "BLOCKING_FLAGS", count: 1 });
    // …and even an explicit "with exceptions" from a non-owner.
    expect(approvalGate(r, { isOwner: false, withExceptions: true }).allowed).toBe(false);
  });

  it.each(blocking)("%s: an Owner may approve with exceptions, and the flag is returned for the audit log", (flag) => {
    const r = calculateTimesheet(input([e("2026-10-06 09:00", "2026-10-06 17:00", { flags: [flag] })]));
    const g = approvalGate(r, { isOwner: true, withExceptions: true });
    expect(g.allowed).toBe(true);
    if (g.allowed) expect(g.exceptions.map((x) => x.type)).toEqual([flag]);
    // Without choosing "with exceptions", the owner is blocked like anyone else.
    expect(approvalGate(r, { isOwner: true, withExceptions: false }).allowed).toBe(false);
  });

  it.each(blocking)("%s no longer blocks once resolved", (flag) => {
    const r = calculateTimesheet(input([e("2026-10-06 09:00", "2026-10-06 17:00", { flags: [flag], resolved: true })]));
    expect(approvalGate(r, { isOwner: false, withExceptions: false }).allowed).toBe(true);
  });

  it.each(nonBlocking)("%s never blocks approval", (flag) => {
    const r = calculateTimesheet(input([e("2026-10-06 09:00", "2026-10-06 17:00", { flags: [flag] })]));
    expect(approvalGate(r, { isOwner: false, withExceptions: false }).allowed).toBe(true);
  });

  it("a missing clock-out is not payable and adds nothing to gross", () => {
    const r = calculateTimesheet(input([e("2026-10-06 09:00", null, { flags: ["MISSING_CLOCK_OUT"] }), e("2026-10-07 09:00", "2026-10-07 17:00")]));
    expect(r.unpayableEntryIds).toHaveLength(1);
    expect(r.grossCents).toBe(16_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("other §7.6 rules", () => {
  it("§7.6.3 — actual break punches are deducted; the planned break never is", () => {
    const r = calculateTimesheet(input([e("2026-10-06 09:00", "2026-10-06 17:30", { breaks: [["2026-10-06 12:00", "2026-10-06 12:20"]] })]));
    expect(r.workedSeconds).toBe(8 * H + 10 * 60); // 8.5 h − 20 min actually taken
    expect(r.breakSeconds).toBe(20 * 60);
  });

  it("§7.6.3 — BreakRule: 5 h without a 30-min break is a violation; a short break doesn't reset the count", () => {
    const rule = [{ afterHours: 5, breakMinutes: 30 }];
    expect(breakViolations(e("2026-10-06 09:00", "2026-10-06 17:00", { breaks: [["2026-10-06 12:00", "2026-10-06 12:30"]] }), rule)).toEqual([]);
    expect(breakViolations(e("2026-10-06 09:00", "2026-10-06 17:00"), rule)).toHaveLength(1);
    expect(breakViolations(e("2026-10-06 09:00", "2026-10-06 17:00", { breaks: [["2026-10-06 12:00", "2026-10-06 12:10"]] }), rule)).toHaveLength(1);
    expect(breakViolations(e("2026-10-06 09:00", "2026-10-06 14:00"), rule)).toEqual([]); // exactly 5 h is fine
  });

  it("§7.6.6 — minimum daily pay: reported for 2 h with a 3 h minimum → 1 h top-up, not counted as overtime", () => {
    const r = calculateTimesheet(input([e("2026-10-06 09:00", "2026-10-06 11:00")], { rules: { ...ON, minimumDailyPayHours: 3 } }));
    expect(r.topUpSeconds).toBe(1 * H);
    expect(r.grossCents).toBe(6_000);
    expect(r.overtime).toEqual([]);
  });

  it("§8 — a raise effective on day 5 of a 14-day period applies from that work-day on", () => {
    // Period Oct 5–18; $20 → $25 effective Fri 9 Oct (day 5).
    const wages = [
      { rateCents: 2000, type: "hourly" as const, positionId: null, effectiveFrom: "2026-01-01" },
      { rateCents: 2500, type: "hourly" as const, positionId: null, effectiveFrom: "2026-10-09" },
    ];
    const days = ["2026-10-08", "2026-10-09", "2026-10-13"].map((d) => e(`${d} 09:00`, `${d} 17:00`));
    const r = calculateTimesheet(input(days, { wages }));
    // Day 4 at $20 = $160; day 5 and day 9 at $25 = $200 each → $560.00
    expect(r.grossCents).toBe(56_000);
    expect(r.lines).toEqual([
      expect.objectContaining({ kind: "regular", seconds: 8 * H, rateCents: 2000, cents: 16_000 }),
      expect.objectContaining({ kind: "regular", seconds: 16 * H, rateCents: 2500, cents: 40_000 }),
    ]);
  });

  it("§8 — the work-day decides the wage: a 01:00 clock-in on the raise date is still paid at the old rate", () => {
    const wages = [
      { rateCents: 2000, type: "hourly" as const, positionId: null, effectiveFrom: "2026-01-01" },
      { rateCents: 2500, type: "hourly" as const, positionId: null, effectiveFrom: "2026-10-09" },
    ];
    // Clock-in 01:00 Fri 9 Oct belongs to Thursday's work-day (workDayStart 04:00).
    const r = calculateTimesheet(input([e("2026-10-09 01:00", "2026-10-09 03:00")], { wages }));
    expect(r.grossCents).toBe(4_000);
  });

  it("§8 — the previous period is untouched by the raise", () => {
    const wages = [
      { rateCents: 2000, type: "hourly" as const, positionId: null, effectiveFrom: "2026-01-01" },
      { rateCents: 2500, type: "hourly" as const, positionId: null, effectiveFrom: "2026-10-09" },
    ];
    const r = calculateTimesheet(input([e("2026-10-02 09:00", "2026-10-02 17:00")], { wages, period: { start: "2026-09-21", end: "2026-10-04" } }));
    expect(r.grossCents).toBe(16_000);
  });

  it("rounded punch times are used for pay when rounding is on (raw kept separately)", () => {
    const entry = e("2026-10-06 09:07", "2026-10-06 16:53");
    entry.clockInRounded = localToUtc("2026-10-06", "09:00", TZ);
    entry.clockOutRounded = localToUtc("2026-10-06", "17:00", TZ);
    expect(calculateTimesheet(input([entry])).workedSeconds).toBe(8 * H);
  });

  it("salaried staff: no hourly calculation and no overtime — annual ÷ 26 per bi-weekly period", () => {
    const r = calculateTimesheet(input([e("2026-10-05 07:00", "2026-10-05 21:00")], { wages: [{ rateCents: 5_200_000, type: "salary", positionId: null, effectiveFrom: "2026-01-01" }] }));
    expect(r.salaried).toBe(true);
    expect(r.overtime).toEqual([]);
    expect(r.grossCents).toBe(200_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("where the spec is silent, the calculator refuses instead of guessing", () => {
  it("weekly overtime with a semi-monthly period: which week applies is undefined → blocked", () => {
    const r = calculateTimesheet(input([e("2026-10-06 09:00", "2026-10-06 17:00")], { frequency: "semimonthly", period: { start: "2026-10-01", end: "2026-10-15" } }));
    expect(r.blocked.map((b) => b.code)).toEqual(["WEEK_UNDEFINED"]);
    expect(approvalGate(r, { isOwner: true, withExceptions: true }).allowed).toBe(false);
  });

  it("semi-monthly with daily overtime only is fine", () => {
    const r = calculateTimesheet(input([e("2026-10-06 09:00", "2026-10-06 19:00")], { frequency: "semimonthly", period: { start: "2026-10-01", end: "2026-10-15" }, rules: { ...BC, weeklyThresholdHours: null, weeklyMultiplier: null } }));
    expect(r.blocked).toEqual([]);
    expect(ot(r, "daily1")).toBe(2 * H);
  });

  it("no wage on file → blocked", () => {
    const r = calculateTimesheet(input([e("2026-10-06 09:00", "2026-10-06 17:00")], { wages: [] }));
    expect(r.blocked.map((b) => b.code)).toEqual(["NO_WAGE"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("overtime with more than one hourly rate — paid at the weighted-average straight-time rate", () => {
  const wages = [
    { rateCents: 1800, type: "hourly" as const, positionId: null, effectiveFrom: "2026-01-01" },
    { rateCents: 2200, type: "hourly" as const, positionId: "bar", effectiveFrom: "2026-01-01" },
  ];

  it("daily OT at that work-day's weighted average: 5 h @ $18 + 6 h @ $22 in one day (BC)", () => {
    const r = calculateTimesheet(input([e("2026-10-06 09:00", "2026-10-06 14:00"), e("2026-10-06 15:00", "2026-10-06 21:00", { positionId: "bar" })], { wages }));
    expect(r.blocked).toEqual([]);
    expect(r.regularSeconds).toBe(8 * H);
    expect(ot(r, "daily1")).toBe(3 * H);
    // Regular (chronological, each hour at its own rate): 5 × $18 + 3 × $22 = $156.00
    // Day average: (5 × $18 + 6 × $22) ÷ 11 h = $222 ÷ 11 = $20.1818…/h
    // Daily OT: 3 h × $20.1818… × 1.5 = $90.818… → $90.82
    expect(r.grossCents).toBe(15_600 + 9_082);
  });

  it("weekly OT at that week's weighted average: 36 h @ $18 + 9 h @ $22 (Ontario, 44 h)", () => {
    const week = [
      ...["05", "06", "07", "08"].map((d) => e(`2026-10-${d} 09:00`, `2026-10-${d} 18:00`)),
      e("2026-10-09 09:00", "2026-10-09 18:00", { positionId: "bar" }),
    ];
    const r = calculateTimesheet(input(week, { wages, rules: ON }));
    expect(r.blocked).toEqual([]);
    expect(r.regularSeconds).toBe(44 * H);
    expect(ot(r, "weekly")).toBe(1 * H);
    // Regular: 36 × $18 + 8 × $22 = $824.00
    // Week average: (36 × $18 + 9 × $22) ÷ 45 h = $846 ÷ 45 = $18.80/h
    // Weekly OT: 1 h × $18.80 × 1.5 = $28.20
    expect(r.grossCents).toBe(82_400 + 2_820);
  });

  it("weekly OT averages only the hours the weekly threshold counted, not hours already paid as daily OT", () => {
    // BC: Mon 12 h @ $22 (4 h daily OT, consumed) + Tue–Fri 9 h @ $18 (1 h daily OT each) = 48 h.
    // Non-consumed: 8 h @ $22 + 32 h @ $18 = 40 h → no weekly OT. Add Sat 2 h @ $18 → 42 h non-consumed, 2 h weekly OT.
    const week = [
      e("2026-10-05 07:00", "2026-10-05 19:00", { positionId: "bar" }),
      ...["06", "07", "08", "09"].map((d) => e(`2026-10-${d} 09:00`, `2026-10-${d} 18:00`)),
      e("2026-10-10 09:00", "2026-10-10 11:00"),
    ];
    const r = calculateTimesheet(input(week, { wages }));
    expect(ot(r, "daily1")).toBe(8 * H);
    expect(ot(r, "weekly")).toBe(2 * H);
    // Weekly average over the 42 non-consumed hours: (8 × $22 + 34 × $18) ÷ 42 = $788 ÷ 42 = $18.7619…/h
    // Weekly OT: 2 h × $18.7619… × 1.5 = $56.2857… → $56.29
    const weeklyLine = r.lines.find((l) => l.label.startsWith("Weekly"));
    expect(weeklyLine?.cents).toBe(5_629);
    // Daily OT: Mon 4 h at Mon's average ($22) × 1.5 = $132.00; Tue–Fri 1 h each at $18 × 1.5 = $27.00 × 4 = $108.00
    // Regular: 8 × $22 + 32 × $18 = $752.00 (the Sat hours are the weekly OT)
    expect(r.grossCents).toBe(75_200 + 13_200 + 10_800 + 5_629);
  });

  it("two rates with no overtime is fine", () => {
    const wages = [
      { rateCents: 1800, type: "hourly" as const, positionId: null, effectiveFrom: "2026-01-01" },
      { rateCents: 2200, type: "hourly" as const, positionId: "bar", effectiveFrom: "2026-01-01" },
    ];
    const r = calculateTimesheet(input([e("2026-10-06 09:00", "2026-10-06 12:00"), e("2026-10-06 13:00", "2026-10-06 16:00", { positionId: "bar" })], { wages }));
    expect(r.blocked).toEqual([]);
    expect(r.grossCents).toBe(3 * 1800 + 3 * 2200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§7.6.1 — a pay period ends at workDayStart on the day after its last date", () => {
  const P = { start: "2026-10-05", end: "2026-10-18" };

  it("the Oct 5–18 period ends at 04:00 Monday 19 Oct, not at midnight", () => {
    expect(periodEndsAt(P, [TZ], 240)).toEqual(localToUtc("2026-10-19", "04:00", TZ));
    expect(periodHasEnded(P, localToUtc("2026-10-19", "00:00", TZ), [TZ], 240)).toBe(false);
    expect(periodHasEnded(P, localToUtc("2026-10-19", "03:59", TZ), [TZ], 240)).toBe(false);
    expect(periodHasEnded(P, localToUtc("2026-10-19", "04:00", TZ), [TZ], 240)).toBe(true);
  });

  it("with locations in several timezones, the period ends at the latest of them", () => {
    // 04:00 in Vancouver is 07:00 in Toronto.
    expect(periodEndsAt(P, [TZ, "America/Vancouver"], 240)).toEqual(localToUtc("2026-10-19", "07:00", TZ));
  });

  it("a 01:00 Monday clock-in can never land in an already-approved period", () => {
    // Approval requires periodHasEnded(now). A clock-in joins the period of its work-day.
    const clockIn = localToUtc("2026-10-19", "01:00", TZ);
    const joins = periodContaining("biweekly", "2026-10-05", workDayOf(clockIn, TZ, 240));
    expect(joins).toEqual(P); // it joins Sunday's work-day → the Oct 5–18 period…
    expect(periodHasEnded(joins, clockIn, [TZ], 240)).toBe(false); // …which cannot have been approved yet.
  });

  it("the same holds for every clock-in instant: the period it joins always ends after it (5-minute sweep, DST included)", () => {
    const windows = [
      ["2026-10-17", "2026-10-21"], // period boundary
      ["2026-10-31", "2026-11-03"], // fall back (and the next boundary)
      ["2026-03-06", "2026-03-11"], // spring forward (and a boundary on Mon 9 Mar)
    ];
    for (const frequency of ["weekly", "biweekly"] as const) {
      for (const wds of [0, 150, 240, 360]) {
        for (const [from, to] of windows) {
          const end = localToUtc(to, "00:00", TZ).getTime();
          for (let t = localToUtc(from, "00:00", TZ).getTime(); t < end; t += 5 * 60_000) {
            const clockIn = new Date(t);
            const p = periodContaining(frequency, "2026-10-05", workDayOf(clockIn, TZ, wds));
            if (periodHasEnded(p, clockIn, [TZ], wds)) throw new Error(`${frequency} wds=${wds}: clock-in ${clockIn.toISOString()} joins ${p.start}–${p.end}, which had already ended`);
          }
        }
      }
    }
  });
});
