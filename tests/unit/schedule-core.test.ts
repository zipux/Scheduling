import { describe, expect, it } from "vitest";
import { ageOn, hoursBetween, localToUtc, shiftInstants, weekDays, weekStartKey, dateKeyInTz } from "@/lib/time";
import { computeWarnings, paidHours, type WShift, type WarningContext } from "@/lib/schedule-warnings";
import { describeChange, diffShift, summarizeWeek, type ShiftView } from "@/lib/shift-diff";

const TZ = "America/Toronto";

describe("time helpers", () => {
  it("converts local wall time to UTC (EDT = UTC-4)", () => {
    expect(localToUtc("2026-10-05", "17:00", TZ).toISOString()).toBe("2026-10-05T21:00:00.000Z");
  });
  it("an end time before the start means the next day", () => {
    const { startsAt, endsAt } = shiftInstants("2026-10-04", "21:00", "02:10", TZ);
    expect(hoursBetween(startsAt, endsAt)).toBeCloseTo(5 + 10 / 60);
    expect(dateKeyInTz(startsAt, TZ)).toBe("2026-10-04");
  });
  it("a shift across the autumn DST change is 9 real hours for 21:00–05:00 (fall back)", () => {
    // 2026-11-01 02:00 EDT → 01:00 EST
    const { startsAt, endsAt } = shiftInstants("2026-10-31", "21:00", "05:00", TZ);
    expect(hoursBetween(startsAt, endsAt)).toBe(9);
  });
  it("a shift across the spring DST change is 7 real hours for 21:00–05:00 (spring forward)", () => {
    // 2026-03-08 02:00 EST → 03:00 EDT
    const { startsAt, endsAt } = shiftInstants("2026-03-07", "21:00", "05:00", TZ);
    expect(hoursBetween(startsAt, endsAt)).toBe(7);
  });
  it("weeks start on Monday", () => {
    expect(weekStartKey("2026-10-04")).toBe("2026-09-28"); // Sunday → previous Monday
    expect(weekStartKey("2026-10-05")).toBe("2026-10-05");
    expect(weekDays("2026-10-05")).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
  });
  it("age on a date", () => {
    expect(ageOn("2008-10-06", "2026-10-05")).toBe(17);
    expect(ageOn("2008-10-06", "2026-10-06")).toBe(18);
  });
});

const mk = (id: string, date: string, start: string, end: string, extra: Partial<WShift> = {}): WShift => ({
  id,
  membershipId: "m1",
  breakMinutes: 0,
  positionId: "p1",
  tz: TZ,
  ...shiftInstants(date, start, end, TZ),
  ...extra,
});

const ctx = (over: Partial<WarningContext> = {}): WarningContext => ({
  personShifts: [],
  dob: "1990-01-01",
  positionMinAge: null,
  approvedTimeOff: [],
  availability: [],
  dailyThresholdHours: null,
  weeklyThresholdHours: null,
  maxSplitShiftSpanHours: null,
  minRestHours: 8,
  ...over,
});

const types = (s: WShift, c: WarningContext) => computeWarnings(s, c).map((w) => w.type);

describe("scheduling warnings (§5.1)", () => {
  const s = mk("s", "2026-10-06", "17:00", "23:00");

  it("none for a clean shift, and never for an open shift", () => {
    expect(types(s, ctx())).toEqual([]);
    expect(types({ ...s, membershipId: null }, ctx({ approvedTimeOff: [{ startsAt: s.startsAt, endsAt: s.endsAt }] }))).toEqual([]);
  });

  it("approved time off", () => {
    expect(types(s, ctx({ approvedTimeOff: [{ startsAt: localToUtc("2026-10-06", "00:00", TZ), endsAt: localToUtc("2026-10-07", "00:00", TZ) }] }))).toEqual(["TIME_OFF"]);
  });

  it("overlapping shifts", () => {
    expect(types(s, ctx({ personShifts: [mk("o", "2026-10-06", "22:00", "23:30")] }))).toContain("OVERLAP");
  });

  it("unavailable all day, and outside available hours", () => {
    const base = { startMinutes: null, endMinutes: null, effectiveFrom: "2026-01-01", requestId: "r1" };
    expect(types(s, ctx({ availability: [{ ...base, weekday: 2, kind: "unavailable" }] }))).toEqual(["UNAVAILABLE"]);
    expect(types(s, ctx({ availability: [{ ...base, weekday: 2, kind: "between", startMinutes: 9 * 60, endMinutes: 18 * 60 }] }))).toEqual(["UNAVAILABLE"]);
    expect(types(s, ctx({ availability: [{ ...base, weekday: 2, kind: "between", startMinutes: 16 * 60, endMinutes: 24 * 60 }] }))).toEqual([]);
  });

  it("uses the newest approved availability set in force on the shift date", () => {
    const rules = [
      { weekday: 2, kind: "unavailable" as const, startMinutes: null, endMinutes: null, effectiveFrom: "2026-01-01", requestId: "old" },
      { weekday: 2, kind: "all_day" as const, startMinutes: null, endMinutes: null, effectiveFrom: "2026-10-01", requestId: "new" },
    ];
    expect(types(s, ctx({ availability: rules }))).toEqual([]);
    expect(types(mk("x", "2026-09-29", "17:00", "23:00"), ctx({ availability: rules }))).toEqual(["UNAVAILABLE"]);
  });

  it("overtime risk by day and by week", () => {
    expect(types(mk("d", "2026-10-06", "08:00", "18:00"), ctx({ dailyThresholdHours: 8 }))).toEqual(["OVERTIME_RISK"]);
    const week = ["2026-10-05", "2026-10-07", "2026-10-08", "2026-10-09"].map((d, i) => mk(`w${i}`, d, "09:00", "19:00"));
    const w = computeWarnings(s, ctx({ personShifts: week, weeklyThresholdHours: 44 }));
    expect(w).toEqual([{ type: "OVERTIME_RISK", params: { scope: "week", hours: 46, threshold: 44 } }]);
  });

  it("planned breaks reduce scheduled hours for overtime risk", () => {
    expect(paidHours(mk("b", "2026-10-06", "09:00", "17:30", { breakMinutes: 30 }))).toBe(8);
    expect(types(mk("b", "2026-10-06", "09:00", "17:30", { breakMinutes: 30 }), ctx({ dailyThresholdHours: 8 }))).toEqual([]);
  });

  it("short rest between a close and an open", () => {
    const close = mk("c", "2026-10-05", "17:00", "01:00");
    expect(types(mk("o", "2026-10-06", "07:00", "15:00"), ctx({ personShifts: [close] }))).toEqual(["SHORT_REST"]);
    expect(types(mk("o", "2026-10-06", "10:00", "15:00"), ctx({ personShifts: [close] }))).toEqual([]);
  });

  it("split shift span exceeded", () => {
    const lunch = mk("l", "2026-10-06", "10:00", "14:00");
    const w = computeWarnings(mk("e", "2026-10-06", "18:00", "23:00"), ctx({ personShifts: [lunch], maxSplitShiftSpanHours: 12 }));
    expect(w).toEqual([{ type: "SPLIT_SHIFT", params: { hours: 13, maximum: 12 } }]);
    expect(types(mk("e", "2026-10-06", "17:00", "21:00"), ctx({ personShifts: [lunch], maxSplitShiftSpanHours: 12 }))).toEqual([]);
  });

  it("below minimum age for the position — recalculated at the shift date", () => {
    expect(types(s, ctx({ dob: "2008-10-07", positionMinAge: 18 }))).toEqual(["UNDER_AGE"]);
    expect(types(s, ctx({ dob: "2008-10-06", positionMinAge: 18 }))).toEqual([]);
  });
});

const v = (over: Partial<ShiftView> = {}): ShiftView => ({
  id: "s",
  startsAt: localToUtc("2026-10-06", "17:00", TZ).toISOString(),
  endsAt: localToUtc("2026-10-06", "23:00", TZ).toISOString(),
  locationName: "King St",
  positionName: "Server",
  tz: TZ,
  ...over,
});

describe("before → after diff (§9.1)", () => {
  it("no change → null", () => expect(diffShift(v(), v())).toBeNull());
  it("start time changed", () => {
    const c = diffShift(v(), v({ startsAt: localToUtc("2026-10-06", "17:15", TZ).toISOString() }))!;
    expect(describeChange(c)).toBe("Tue 6 Oct: start 17:00→17:15");
  });
  it("added and removed carry the times", () => {
    expect(describeChange(diffShift(null, v())!)).toBe("Tue 6 Oct shift added: 17:00–23:00 at King St");
    expect(describeChange(diffShift(v(), null)!)).toBe("Tue 6 Oct shift removed (was 17:00–23:00 at King St)");
  });
  it("summarises a week in one message", () => {
    const changes = [
      diffShift(v(), v({ startsAt: localToUtc("2026-10-06", "17:15", TZ).toISOString() }))!,
      diffShift(null, v({ id: "t", startsAt: localToUtc("2026-10-08", "12:00", TZ).toISOString(), endsAt: localToUtc("2026-10-08", "18:00", TZ).toISOString() }))!,
    ];
    expect(summarizeWeek("5 Oct", changes)).toBe(
      "Your week of 5 Oct changed: Tue 6 Oct: start 17:00→17:15; Thu 8 Oct shift added: 12:00–18:00 at King St.",
    );
  });
});
