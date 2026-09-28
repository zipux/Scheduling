import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/auth/context";
import { localToUtc } from "@/lib/time";
import { buildReport, reportCsv } from "@/server/services/reports";
import { addBreakRule, saveHolidayRules, saveWorkDayStart } from "@/server/services/pay-rules";
import { addHoliday, addPresetYear, deleteHoliday } from "@/server/services/holidays";
import { overrideEntitlement, timesheetDetail } from "@/server/services/timesheets";
import { addMember, ctxFor, db, makeBusiness } from "../support/fixtures";

const TZ = "America/Toronto";
const PERIOD = { start: "2026-09-14", end: "2026-09-27" };
type Fx = Awaited<ReturnType<typeof makeBusiness>>;
let A: Fx;
let mgr: string;
let emp: string;

beforeAll(async () => {
  A = await makeBusiness("RpA");
  await db.business.update({ where: { id: A.business.id }, data: { payPeriodFrequency: "biweekly", payPeriodAnchorDate: new Date("2026-09-14") } });
  mgr = (await addMember(A.business.id, A.roles.manager.id, "Mgr")).membership.id;
  emp = (await addMember(A.business.id, A.roles.employee.id, "Emp")).membership.id;
  for (const m of [mgr, emp]) await db.membershipLocation.create({ data: { businessId: A.business.id, membershipId: m, locationId: A.location.id } });
  await db.wage.create({ data: { businessId: A.business.id, membershipId: emp, rateCents: 2000, effectiveFrom: new Date("2025-01-01") } });
  await db.membership.update({ where: { id: emp }, data: { hireDate: new Date("2025-01-01") } });
  // Worked Tue (late), no-show Wed, missing clock-in Thu.
  const t = (d: string, h: string) => localToUtc(d, h, TZ);
  const e1 = await db.timeEntry.create({ data: { businessId: A.business.id, membershipId: emp, locationId: A.location.id, clockIn: t("2026-09-15", "09:10"), clockOut: t("2026-09-15", "17:00") } });
  await db.timeEntryFlag.create({ data: { businessId: A.business.id, timeEntryId: e1.id, type: "LATE" } });
  await db.shift.create({ data: { businessId: A.business.id, locationId: A.location.id, membershipId: emp, status: "published", startsAt: t("2026-09-16", "09:00"), endsAt: t("2026-09-16", "17:00") } });
  const e2 = await db.timeEntry.create({ data: { businessId: A.business.id, membershipId: emp, locationId: A.location.id, clockIn: null, clockOut: t("2026-09-17", "17:00") } });
  await db.timeEntryFlag.create({ data: { businessId: A.business.id, timeEntryId: e2.id, type: "MISSING_CLOCK_IN" } });
}, 300_000);

describe("reports (§10)", () => {
  it("hours by employee", async () => {
    const r = await buildReport(await ctxFor(A.owner.id), "hours", PERIOD);
    const row = r.rows.find((x) => x[0] === "Emp")!;
    expect(row[1]).toBeCloseTo(7.83, 2); // 09:10–17:00
    expect(r.columns).toContain("Gross");
  });

  it("attendance lists late, no-show and missing punches", async () => {
    const r = await buildReport(await ctxFor(A.owner.id), "attendance", PERIOD);
    const events = r.rows.filter((x) => x[1] === "Emp").map((x) => x[3]);
    expect(events).toEqual(expect.arrayContaining(["LATE", "NO_SHOW", "MISSING_CLOCK_IN"]));
  });

  it("wages by day/location/position (needs wages.view)", async () => {
    const r = await buildReport(await ctxFor(A.owner.id), "wages", PERIOD);
    expect(r.rows[0]).toEqual(["2026-09-15", "Main", "—", 7.83, 156.67]);
  });

  it("is audited when exported, and denied without reports.view", async () => {
    const csv = await reportCsv(await ctxFor(A.owner.id), "attendance", PERIOD);
    expect(csv.split("\r\n")[0]).toBe("Work-day,Employee,Location,Event,Time,Status");
    expect(await db.auditLog.count({ where: { businessId: A.business.id, action: "EXPORT", targetType: "Report:attendance" } })).toBe(1);
    await expect(buildReport(await ctxFor(emp), "hours", PERIOD)).rejects.toThrow(ForbiddenError);
  });
});

describe("pay rules & holidays (§7.6.8, §7.6.4)", () => {
  it("only payrules.manage can change pay rules", async () => {
    await expect(saveWorkDayStart(await ctxFor(mgr), { workDayStartMinutes: 300 })).rejects.toThrow(ForbiddenError);
    await saveWorkDayStart(await ctxFor(A.owner.id), { workDayStartMinutes: 300 });
    expect((await db.business.findUniqueOrThrow({ where: { id: A.business.id } })).workDayStartMinutes).toBe(300);
    await addBreakRule(await ctxFor(A.owner.id), { afterHours: 10, breakMinutes: 15 });
    expect(await db.breakRule.count({ where: { businessId: A.business.id } })).toBeGreaterThanOrEqual(2);
  });

  it("the holiday formula is configurable and a fixed divisor is saved", async () => {
    await saveHolidayRules(await ctxFor(A.owner.id), { holidayMinEmploymentDays: 0, holidayMinDaysWorkedLookback: 0, holidayLookbackDays: 28, holidayAverageDivisor: "fixed", holidayAverageFixedDivisor: 20, holidayPremiumRequiresEligibility: true });
    const r = await db.payRules.findUniqueOrThrow({ where: { businessId: A.business.id } });
    expect(r.holidayAverageFixedDivisor).toBe(20);
    expect(r.holidayPremiumRequiresEligibility).toBe(true);
  });

  it("new businesses get their province's holidays; presets for another year can be added; holidays.manage required", async () => {
    expect(await db.holiday.count({ where: { businessId: A.business.id, name: "Thanksgiving" } })).toBeGreaterThanOrEqual(1);
    const r = await addPresetYear(await ctxFor(A.owner.id), 2030);
    expect(r.added).toBe(9);
    await expect(addHoliday(await ctxFor(mgr), { date: "2026-09-16", name: "Founders' Day", isStatutory: true, premiumMultiplier: 1.5 })).rejects.toThrow(ForbiddenError);
    await addHoliday(await ctxFor(A.owner.id), { date: "2026-09-16", name: "Founders' Day", isStatutory: true, premiumMultiplier: 1.5 });
  });

  it("a holiday in the period appears on the timesheet with its inputs, and can be overridden with a reason", async () => {
    const hol = await db.holiday.findFirstOrThrow({ where: { businessId: A.business.id, name: "Founders' Day" } });
    let d = await timesheetDetail(await ctxFor(A.owner.id), emp, PERIOD);
    const v = d.result.holidays.find((x) => x.holidayId === hol.id)!;
    expect(v.worked).toBe(false);
    expect(v.inputs.lookbackFrom).toBe("2026-08-19");
    await overrideEntitlement(await ctxFor(A.owner.id), { holidayId: hol.id, membershipId: emp, eligible: false, reason: "Unpaid leave that week" });
    d = await timesheetDetail(await ctxFor(A.owner.id), emp, PERIOD);
    expect(d.result.holidays.find((x) => x.holidayId === hol.id)).toMatchObject({ eligible: false, inputs: { overridden: true, overrideReason: "Unpaid leave that week" } });
    await deleteHoliday(await ctxFor(A.owner.id), hol.id);
  });
});
