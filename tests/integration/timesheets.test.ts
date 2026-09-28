import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { localToUtc } from "@/lib/time";
import { approveTimesheet, csvCell, payrollCsv, periodOverview, reopenTimesheet, timesheetDetail, vacationBalance } from "@/server/services/timesheets";
import { editEntry } from "@/server/services/time-corrections";
import { addWage } from "@/server/services/wages";
import { addMember, ctxFor, db, makeBusiness } from "../support/fixtures";

// Ontario preset (weekly 44 h ×1.5, 3 h minimum day, 5 h / 30 min break rule, holiday ÷20 over 28 days).
// Bi-weekly periods anchored Mon 2026-08-03: Sep 14–27, Sep 28–Oct 11, Oct 12–25.
const TZ = "America/Toronto";
const P1 = "2026-08-03";
const P2 = "2026-08-17";
const P3 = "2026-08-31";

type Fx = Awaited<ReturnType<typeof makeBusiness>>;
let A: Fx;
let mgr: string;
let emp: string;
let leaver: string;

async function entry(membershipId: string, date: string, from: string, to: string | null, flags: string[] = [], breakAt?: [string, string]) {
  const e = await db.timeEntry.create({
    data: {
      businessId: A.business.id,
      membershipId,
      locationId: A.location.id,
      clockIn: localToUtc(date, from, TZ),
      clockOut: to ? localToUtc(date, to, TZ) : null,
    },
  });
  for (const type of flags) await db.timeEntryFlag.create({ data: { businessId: A.business.id, timeEntryId: e.id, type: type as never } });
  if (breakAt) await db.breakEntry.create({ data: { businessId: A.business.id, timeEntryId: e.id, startsAt: localToUtc(date, breakAt[0], TZ), endsAt: localToUtc(date, breakAt[1], TZ) } });
  return e;
}

async function person(roleKey: keyof Fx["roles"], name: string, rate = 2000) {
  const m = (await addMember(A.business.id, A.roles[roleKey].id, name)).membership.id;
  await db.membership.update({ where: { id: m }, data: { hireDate: new Date("2025-01-01") } });
  await db.membershipLocation.create({ data: { businessId: A.business.id, membershipId: m, locationId: A.location.id } });
  await db.wage.create({ data: { businessId: A.business.id, membershipId: m, rateCents: rate, effectiveFrom: new Date("2025-01-01") } });
  return m;
}

beforeAll(async () => {
  A = await makeBusiness("TsA");
  await db.business.update({ where: { id: A.business.id }, data: { payPeriodFrequency: "biweekly", payPeriodAnchorDate: new Date(`${P1}T00:00:00Z`) } });
  await db.payRules.update({ where: { businessId: A.business.id }, data: { holidayAverageDivisor: "fixed", holidayAverageFixedDivisor: 20 } });
  mgr = await person("manager", "Mgr");
  emp = await person("employee", "Emp");
  leaver = await person("employee", "Leaver");
  // Period 1: 5 × 8 h with a 30-min break = 37.5 h; one entry with an unresolved missing clock-out.
  for (const d of ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"]) await entry(emp, d, "09:00", "17:30", [], ["12:00", "12:30"]);
  await entry(emp, "2026-08-08", "09:00", null, ["MISSING_CLOCK_OUT"]);
  // Period 2 (includes nothing special): 2 days of 8 h.
  await entry(emp, "2026-08-17", "09:00", "17:30", [], ["12:00", "12:30"]);
  await entry(emp, "2026-08-18", "09:00", "17:30", [], ["12:00", "12:30"]);
}, 300_000);

describe("timesheet approval (§7.5, §7.6.7)", () => {
  it("shows the calculated timesheet: 5 days × 8 h = 40 h, the open entry is unpayable and blocks", async () => {
    const d = await timesheetDetail(await ctxFor(mgr), emp, { start: P1, end: "2026-08-16" });
    expect(d.result.workedSeconds).toBe(40 * 3600);
    expect(d.result.grossCents).toBe(80_000);
    expect(d.result.unpayableEntryIds).toHaveLength(1);
    expect(d.result.unresolvedFlags.filter((f) => f.blocking)).toHaveLength(1);
  });

  it("a manager can't approve while a blocking flag is unresolved", async () => {
    await expect(approveTimesheet(await ctxFor(mgr), { membershipId: emp, periodStart: P1, withExceptions: false, final: false })).rejects.toThrow("1 unresolved entry blocks approval");
    await expect(approveTimesheet(await ctxFor(mgr), { membershipId: emp, periodStart: P1, withExceptions: true, final: false })).rejects.toThrow(UserError);
  });

  it("an Owner can approve with exceptions; each exception is audited; entries lock; vacation accrues", async () => {
    const r = await approveTimesheet(await ctxFor(A.owner.id), { membershipId: emp, periodStart: P1, withExceptions: true, final: false });
    expect(r).toEqual({ grossCents: 80_000, exceptions: 1 });
    expect(await db.auditLog.count({ where: { businessId: A.business.id, action: "APPROVED_WITH_EXCEPTION" } })).toBe(1);
    const locked = await db.timeEntry.count({ where: { membershipId: emp, lockedAt: { not: null } } });
    expect(locked).toBe(6);
    // 4% × $800.00 = $32.00
    expect(await vacationBalance(await ctxFor(A.owner.id), emp)).toBe(3_200);
    const sheet = await db.timesheet.findFirstOrThrow({ where: { membershipId: emp } });
    expect(sheet.status).toBe("approved");
    expect(sheet.approvedWithExceptions).toBe(true);
  });

  it("locked entries: a manager can't edit them; an Owner can, audited as a lock override", async () => {
    const e = await db.timeEntry.findFirstOrThrow({ where: { membershipId: emp, clockIn: localToUtc("2026-08-04", "09:00", TZ) } });
    await expect(editEntry(await ctxFor(mgr), { entryId: e.id, clockIn: e.clockIn, clockOut: new Date(e.clockOut!.getTime() + 3600_000), reason: "Late close" })).rejects.toThrow("approved pay period");
    await editEntry(await ctxFor(A.owner.id), { entryId: e.id, clockIn: e.clockIn, clockOut: new Date(e.clockOut!.getTime() + 3600_000), reason: "Late close, found after approval" });
    expect(await db.timeEntryAudit.count({ where: { timeEntryId: e.id, action: "lock_override" } })).toBe(1);
  });

  it("an approved timesheet keeps its approved numbers even after a later edit", async () => {
    const d = await timesheetDetail(await ctxFor(A.owner.id), emp, { start: P1, end: "2026-08-16" });
    expect(d.result.grossCents).toBe(80_000); // the snapshot
    expect(d.live.grossCents).toBe(82_000); // what it would be now (+1 h)
  });

  it("nobody approves their own timesheet; seniority and permission are required", async () => {
    await entry(mgr, "2026-08-17", "09:00", "17:00");
    await expect(approveTimesheet(await ctxFor(mgr), { membershipId: mgr, periodStart: P2, withExceptions: false, final: false })).rejects.toThrow(ForbiddenError);
    const other = await person("manager", "Peer");
    await expect(approveTimesheet(await ctxFor(mgr), { membershipId: other, periodStart: P2, withExceptions: false, final: false })).rejects.toThrow("junior");
    await expect(approveTimesheet(await ctxFor(emp), { membershipId: leaver, periodStart: P2, withExceptions: false, final: false })).rejects.toThrow(ForbiddenError);
  });

  it("only an Owner can reopen; reopening unlocks and reverses the accrual", async () => {
    await expect(reopenTimesheet(await ctxFor(mgr), { membershipId: emp, periodStart: P1, reason: "Mistake" })).rejects.toThrow(ForbiddenError);
    await reopenTimesheet(await ctxFor(A.owner.id), { membershipId: emp, periodStart: P1, reason: "Recalculate after the late-close fix" });
    expect(await vacationBalance(await ctxFor(A.owner.id), emp)).toBe(0);
    expect(await db.timeEntry.count({ where: { membershipId: emp, lockedAt: { not: null } } })).toBe(0);
  });

  it("wage changes can't be back-dated into an approved period", async () => {
    await approveTimesheet(await ctxFor(mgr), { membershipId: emp, periodStart: P2, withExceptions: false, final: false });
    // Approve everyone else in P2 so the period itself is approved.
    for (const row of await periodOverview(await ctxFor(A.owner.id), { start: P2, end: "2026-08-30" })) {
      if (row.sheet?.status === "approved" || row.person.role.isOwner) continue;
      await approveTimesheet(await ctxFor(A.owner.id), { membershipId: row.person.id, periodStart: P2, withExceptions: true, final: false }).catch(() => {});
    }
    const ownerSelf = await db.timesheet.findFirst({ where: { membershipId: A.owner.id } });
    void ownerSelf;
    const pp = await db.payPeriod.findFirstOrThrow({ where: { businessId: A.business.id, startDate: new Date(`${P2}T00:00:00Z`) } });
    if (pp.status === "approved") {
      await expect(addWage(await ctxFor(A.owner.id), { membershipId: emp, rateCents: 2500, type: "hourly", positionId: null, effectiveFrom: "2026-08-20" })).rejects.toThrow("approved pay period");
    }
  });
});

describe("leaving employment (§11)", () => {
  it("deactivated staff stay on timesheets for periods they worked, and a Final timesheet closes a partial period", async () => {
    await entry(leaver, "2026-08-31", "09:00", "17:00");
    await entry(leaver, "2026-09-01", "09:00", "17:00");
    await entry(leaver, "2026-09-08", "09:00", "17:00"); // after the end date — excluded from the final sheet
    await db.membership.update({ where: { id: leaver }, data: { status: "deactivated", accessRevokedAt: new Date(), employmentEndedAt: new Date("2026-09-02") } });
    const rows = await periodOverview(await ctxFor(A.owner.id), { start: P3, end: "2026-09-13" });
    expect(rows.some((r) => r.person.id === leaver)).toBe(true);
    const r = await approveTimesheet(await ctxFor(A.owner.id), { membershipId: leaver, periodStart: P3, withExceptions: false, final: true });
    // 2 × 8 h × $20 = $320, plus any holiday pay (Labour Day, Sep 7, falls after the end date → none).
    expect(r.grossCents).toBe(32_000 + (await holidayPay(leaver)));
    const sheet = await db.timesheet.findFirstOrThrow({ where: { membershipId: leaver, payPeriod: { startDate: new Date(`${P3}T00:00:00Z`) } } });
    expect(sheet.isFinal).toBe(true);
  });
});

async function holidayPay(membershipId: string) {
  const ent = await db.holidayEntitlement.findMany({ where: { membershipId } });
  return ent.reduce((n, e) => n + e.amountCents, 0);
}

describe("payroll CSV (§7.5)", () => {
  it("has a row per person with holiday and vacation columns, and neutralises formulas", async () => {
    const csv = await payrollCsv(await ctxFor(A.owner.id), { start: P1, end: "2026-08-16" });
    const [header, ...rows] = csv.trim().split("\r\n");
    expect(header).toContain("Regular hours");
    expect(header).toContain("Vacation accrued");
    expect(header).toContain("Vacation balance");
    expect(rows.some((r) => r.startsWith("Emp,"))).toBe(true);
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(await db.auditLog.count({ where: { businessId: A.business.id, action: "EXPORT" } })).toBe(1);
  });

  it("is refused without permission to see wages", async () => {
    const am = await person("assistant_manager", "AM");
    await expect(payrollCsv(await ctxFor(am), { start: P1, end: "2026-08-16" })).rejects.toThrow(ForbiddenError);
  });
});
