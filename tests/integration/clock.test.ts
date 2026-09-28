import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/auth/context";
import { tenantDb } from "@/server/db/tenant";
import { ClockError, clockStatus, punch, raiseMissingClockOuts } from "@/server/services/clock";
import { hashPin } from "@/server/services/profile";
import { resolveBreakMissed } from "@/server/services/time-corrections";
import { editEntry, editEntrySchema, requestCorrection, resolveFlag, reviewCorrection, unresolvedTime, workingNow } from "@/server/services/time-corrections";
import { authenticateKiosk, createKioskDevice, exitKiosk, kioskIdentify, kioskPunch, kioskStaff } from "@/server/platform/kiosk";
import { addMember, ctxFor, db, makeBusiness } from "../support/fixtures";

type Fx = Awaited<ReturnType<typeof makeBusiness>>;
let A: Fx;
let B: Fx;
let mgr: string;
let emp: string;
const PIN = "4826";
const here = { lat: 43.65, lng: -79.38, accuracy: 10 };
const far = { lat: 43.66, lng: -79.38, accuracy: 10 }; // ~1.1 km north

async function staff(biz: Fx, roleKey: keyof Fx["roles"], name: string) {
  const m = (await addMember(biz.business.id, biz.roles[roleKey].id, name)).membership.id;
  await db.membershipLocation.create({ data: { businessId: biz.business.id, membershipId: m, locationId: biz.location.id } });
  await db.employeeProfile.update({ where: { membershipId: m }, data: { pinHmac: await hashPin(m, PIN) } });
  return m;
}

async function shiftNow(biz: Fx, membershipId: string, startOffsetMin: number, lengthMin = 480, override?: object) {
  const start = new Date(Date.now() + startOffsetMin * 60_000);
  return db.shift.create({
    data: {
      businessId: biz.business.id,
      locationId: biz.location.id,
      membershipId,
      status: "published",
      startsAt: start,
      endsAt: new Date(start.getTime() + lengthMin * 60_000),
      geofenceOverride: override as never,
    },
  });
}

const actor = (membershipId: string, biz: Fx = A) => ({ businessId: biz.business.id, membershipId, source: "personal" as const });
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    if (e instanceof ClockError) return e.code;
    throw e;
  }
};
const flagsOf = async (entryId: string) => (await db.timeEntryFlag.findMany({ where: { timeEntryId: entryId } })).map((f) => f.type).sort();
const setLoc = (biz: Fx, data: object) => db.location.update({ where: { id: biz.location.id }, data });

beforeAll(async () => {
  A = await makeBusiness("ClkA");
  B = await makeBusiness("ClkB");
  mgr = await staff(A, "manager", "Mgr");
  emp = await staff(A, "employee", "Emp");
  const ownerPin = await hashPin(A.owner.id, PIN);
  await db.employeeProfile.upsert({ where: { membershipId: A.owner.id }, create: { businessId: A.business.id, membershipId: A.owner.id, pinHmac: ownerPin }, update: { pinHmac: ownerPin } });
  await db.membershipLocation.create({ data: { businessId: A.business.id, membershipId: A.owner.id, locationId: A.location.id } });
}, 300_000);

describe("PIN (§7.1)", () => {
  it("locks after 5 wrong attempts for 5 minutes and logs every attempt", async () => {
    const p = await staff(A, "employee", "Forgetful");
    for (let i = 0; i < 4; i++) expect(await code(punch(actor(p), { action: "in", pin: "0000", position: here }))).toBe("PIN_WRONG");
    expect(await code(punch(actor(p), { action: "in", pin: "0000", position: here }))).toBe("PIN_LOCKED");
    expect(await code(punch(actor(p), { action: "in", pin: PIN, position: here }))).toBe("PIN_LOCKED");
    expect(await db.pinAttempt.count({ where: { membershipId: p } })).toBe(6);
    // After the lock expires the right PIN works.
    expect(await code(punch(actor(p), { action: "in", pin: PIN, position: here }, { now: new Date(Date.now() + 6 * 60_000) }))).toBe("OK");
  });
});

describe("clocking in against schedule and geofence (§7.2, §7.3)", () => {
  it("on time, inside the fence: no flags; break and clock-out work", async () => {
    const p = await staff(A, "employee", "OnTime");
    await shiftNow(A, p, -2);
    const r = await punch(actor(p), { action: "in", pin: PIN, position: here });
    expect(await flagsOf(r.entryId)).toEqual([]);
    expect(await code(punch(actor(p), { action: "in", pin: PIN, position: here }))).toBe("ALREADY_IN");
    await punch(actor(p), { action: "break_start", pin: PIN });
    expect((await clockStatus(A.business.id, p)).onBreak).toBe(true);
    await punch(actor(p), { action: "break_end", pin: PIN });
    await punch(actor(p), { action: "out", pin: PIN, position: here });
    const e = await db.timeEntry.findUniqueOrThrow({ where: { id: r.entryId }, include: { breaks: true } });
    expect(e.clockOut).not.toBeNull();
    expect(e.breaks[0].endsAt).not.toBeNull();
    expect(e.inLat).toBe(here.lat);
    expect(e.inAccuracy).toBe(10);
    // Clocking out 8 h early is an EARLY_LEAVE.
    expect(await flagsOf(r.entryId)).toEqual(["EARLY_LEAVE"]);
  });

  it("late beyond tolerance is flagged LATE", async () => {
    const p = await staff(A, "employee", "Late");
    await shiftNow(A, p, -20);
    const r = await punch(actor(p), { action: "in", pin: PIN, position: here });
    expect(await flagsOf(r.entryId)).toEqual(["LATE"]);
  });

  it("too early is refused; unscheduled is flagged — or refused if the business disallows it", async () => {
    const p = await staff(A, "employee", "Eager");
    await shiftNow(A, p, 60);
    expect(await code(punch(actor(p), { action: "in", pin: PIN, position: here }))).toBe("TOO_EARLY");
    const q = await staff(A, "employee", "NoShift");
    const r = await punch(actor(q), { action: "in", pin: PIN, position: here });
    expect(await flagsOf(r.entryId)).toEqual(["UNSCHEDULED"]);
    await db.business.update({ where: { id: A.business.id }, data: { allowUnscheduledClockIn: false } });
    const s = await staff(A, "employee", "NoShift2");
    expect(await code(punch(actor(s), { action: "in", pin: PIN, position: here }))).toBe("UNSCHEDULED_NOT_ALLOWED");
    await db.business.update({ where: { id: A.business.id }, data: { allowUnscheduledClockIn: true } });
  });

  it("required fence: outside refused, no position refused, poor accuracy ACCEPTED and flagged", async () => {
    await setLoc(A, { geofenceMode: "required", radiusM: 80 });
    const p = await staff(A, "employee", "Geo1");
    await shiftNow(A, p, -1);
    expect(await code(punch(actor(p), { action: "in", pin: PIN, position: far }))).toBe("GEO_OUTSIDE");
    expect(await code(punch(actor(p), { action: "in", pin: PIN, position: null }))).toBe("GEO_NO_POSITION");
    const r = await punch(actor(p), { action: "in", pin: PIN, position: { ...here, accuracy: 120 } });
    expect(await flagsOf(r.entryId)).toEqual(["GEO_UNCERTAIN"]);
    await setLoc(A, { geofenceMode: "warn", radiusM: 100 });
  });

  it("warn-only fence: outside accepted and flagged GEO_OUTSIDE", async () => {
    const p = await staff(A, "employee", "Geo2");
    await shiftNow(A, p, -1);
    const r = await punch(actor(p), { action: "in", pin: PIN, position: far });
    expect(await flagsOf(r.entryId)).toEqual(["GEO_OUTSIDE"]);
  });

  it("shift geofence override (catering): flagged OFFSITE and the position is recorded", async () => {
    await setLoc(A, { geofenceMode: "required" });
    const p = await staff(A, "employee", "Caterer");
    await shiftNow(A, p, -1, 480, { mode: "off" });
    const r = await punch(actor(p), { action: "in", pin: PIN, position: far });
    expect(await flagsOf(r.entryId)).toEqual(["OFFSITE"]);
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: r.entryId } })).inLat).toBe(far.lat);
    await setLoc(A, { geofenceMode: "warn" });
  });
});

describe("missing clock-out (§7.3) — never invent a time", () => {
  it("flags, excludes from 'working now', blocks the next clock-in until the finish time is answered, then a manager confirms", async () => {
    const p = await staff(A, "employee", "Forgot");
    const e = await db.timeEntry.create({ data: { businessId: A.business.id, membershipId: p, locationId: A.location.id, clockIn: new Date(Date.now() - 20 * 3600_000) } });
    expect(await raiseMissingClockOuts(A.business.id)).toBeGreaterThanOrEqual(1);
    expect(await flagsOf(e.id)).toEqual(["MISSING_CLOCK_OUT"]);
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: e.id } })).clockOut).toBeNull();
    expect((await workingNow(await ctxFor(mgr))).some((w) => w.entry.id === e.id)).toBe(false);
    expect(await db.notification.count({ where: { membershipId: p, type: "time.flag" } })).toBe(1);

    expect((await clockStatus(A.business.id, p)).needsPreviousFinish?.entryId).toBe(e.id);
    expect(await code(punch(actor(p), { action: "in", pin: PIN, position: here }))).toBe("NEEDS_PREVIOUS_FINISH");

    const finish = new Date(Date.now() - 12 * 3600_000);
    const c = await requestCorrection(await ctxFor(p), { timeEntryId: e.id, proposedClockIn: null, proposedClockOut: finish, message: "Finished at close" });
    // The answer is a correction request, not a punch.
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: e.id } })).clockOut).toBeNull();
    expect(await code(punch(actor(p), { action: "in", pin: PIN, position: here }))).toBe("OK");

    expect((await unresolvedTime(await ctxFor(mgr))).some((u) => u.entry.id === e.id)).toBe(true);
    await reviewCorrection(await ctxFor(mgr), { id: c.id, approve: true, reason: "Confirmed with the closing manager" });
    const after = await db.timeEntry.findUniqueOrThrow({ where: { id: e.id }, include: { flags: true } });
    expect(after.clockOut?.toISOString()).toBe(finish.toISOString());
    expect(after.flags.find((f) => f.type === "MISSING_CLOCK_OUT")?.resolvedAt).not.toBeNull();
    const audit = await db.timeEntryAudit.findFirstOrThrow({ where: { timeEntryId: e.id } });
    expect(audit.reason).toBe("Confirmed with the closing manager");
    expect((audit.before as { clockOut: string | null }).clockOut).toBeNull();
  });

  it("a clock-out with no clock-in creates an entry flagged MISSING_CLOCK_IN", async () => {
    const p = await staff(A, "employee", "NoIn");
    const r = await punch(actor(p), { action: "out", pin: PIN, position: here });
    const e = await db.timeEntry.findUniqueOrThrow({ where: { id: r.entryId } });
    expect(e.clockIn).toBeNull();
    expect(await flagsOf(r.entryId)).toEqual(["MISSING_CLOCK_IN"]);
  });
});

describe("offline punches (§7.1)", () => {
  it("stores device and server time, flags OFFLINE_QUEUED; future device times beyond the skew are rejected", async () => {
    const p = await staff(A, "employee", "Offline");
    await shiftNow(A, p, -60);
    const device = new Date(Date.now() - 50 * 60_000);
    const r = await punch(actor(p), { action: "in", position: here }, { deviceTime: device, skipPin: true });
    const e = await db.timeEntry.findUniqueOrThrow({ where: { id: r.entryId } });
    expect(e.clockIn?.toISOString()).toBe(device.toISOString());
    expect(e.inDeviceTime?.toISOString()).toBe(device.toISOString());
    expect(e.inServerTime!.getTime()).toBeGreaterThan(device.getTime());
    expect(e.source).toBe("offline");
    expect(await flagsOf(r.entryId)).toContain("OFFLINE_QUEUED");
    expect(await code(punch(actor(p), { action: "out", position: here }, { deviceTime: new Date(Date.now() + 45 * 60_000), skipPin: true }))).toBe("SKEW");
  });

  it("OFFLINE_QUEUED is confirmed by a manager with a reason", async () => {
    const f = await db.timeEntryFlag.findFirstOrThrow({ where: { businessId: A.business.id, type: "OFFLINE_QUEUED", resolvedAt: null } });
    await resolveFlag(await ctxFor(mgr), { flagId: f.id, reason: "Wi-Fi was down; times match the schedule" });
    expect((await db.timeEntryFlag.findUniqueOrThrow({ where: { id: f.id } })).resolvedAt).not.toBeNull();
  });
});

describe("corrections (§7.4) — nobody edits their own time", () => {
  it("a manager edits a junior's entry with a reason; the audit keeps before and after", async () => {
    const e = await db.timeEntry.create({ data: { businessId: A.business.id, membershipId: emp, locationId: A.location.id, clockIn: new Date("2026-09-01T13:00:00Z"), clockOut: new Date("2026-09-01T21:00:00Z") } });
    await editEntry(await ctxFor(mgr), { entryId: e.id, clockIn: new Date("2026-09-01T13:00:00Z"), clockOut: new Date("2026-09-01T22:00:00Z"), reason: "Stayed to close" });
    const a = await db.timeEntryAudit.findFirstOrThrow({ where: { timeEntryId: e.id } });
    expect(a.before).toMatchObject({ clockOut: "2026-09-01T21:00:00.000Z" });
    expect(a.after).toMatchObject({ clockOut: "2026-09-01T22:00:00.000Z" });
    expect(await db.notification.count({ where: { membershipId: emp, type: "time.edited" } })).toBeGreaterThan(0);
  });

  it("the manager cannot edit their own entry, and neither can the owner", async () => {
    const own = await db.timeEntry.create({ data: { businessId: A.business.id, membershipId: mgr, locationId: A.location.id, clockIn: new Date("2026-09-02T13:00:00Z"), clockOut: new Date("2026-09-02T21:00:00Z") } });
    await expect(editEntry(await ctxFor(mgr), { entryId: own.id, clockIn: own.clockIn, clockOut: new Date("2026-09-02T23:00:00Z"), reason: "More" })).rejects.toThrow(ForbiddenError);
    const ownerEntry = await db.timeEntry.create({ data: { businessId: A.business.id, membershipId: A.owner.id, locationId: A.location.id, clockIn: new Date("2026-09-02T13:00:00Z"), clockOut: new Date("2026-09-02T21:00:00Z") } });
    await expect(editEntry(await ctxFor(A.owner.id), { entryId: ownerEntry.id, clockIn: ownerEntry.clockIn, clockOut: new Date("2026-09-02T23:00:00Z"), reason: "Mine" })).rejects.toThrow(ForbiddenError);
    // …but the owner may edit the manager's.
    await expect(editEntry(await ctxFor(A.owner.id), { entryId: own.id, clockIn: own.clockIn, clockOut: new Date("2026-09-02T22:00:00Z"), reason: "Checked" })).resolves.toBeUndefined();
  });

  it("an employee can't edit anyone's time, and a reason is mandatory", async () => {
    const e = await db.timeEntry.create({ data: { businessId: A.business.id, membershipId: mgr, locationId: A.location.id, clockIn: new Date("2026-09-03T13:00:00Z"), clockOut: new Date("2026-09-03T21:00:00Z") } });
    await expect(editEntry(await ctxFor(emp), { entryId: e.id, clockIn: e.clockIn, clockOut: e.clockOut, reason: "Nope" })).rejects.toThrow(ForbiddenError);
    expect(editEntrySchema.safeParse({ entryId: e.id, clockIn: e.clockIn, clockOut: e.clockOut, reason: "" }).success).toBe(false);
  });
});

describe("kiosk devices (§7.1)", () => {
  it("lists only this location's active staff, punches with PIN, and needs a manager PIN to exit", async () => {
    const { token } = await createKioskDevice(A.business.id, A.location.id, "Front tablet", A.ownerUser.id);
    const device = (await authenticateKiosk(token))!;
    expect(device).not.toBeNull();
    const list = await kioskStaff(device);
    expect(list.staff.some((s) => s.id === emp)).toBe(true);
    expect(list.staff.every((s) => Object.keys(s).sort().join() === "id,name")).toBe(true);

    await shiftNow(A, emp, -1);
    await expect(kioskIdentify(device, emp, "9999")).rejects.toThrow("PIN");
    const id = await kioskIdentify(device, emp, PIN);
    expect(id.clockedIn).toBe(false);
    const r = await kioskPunch(device, emp, id.ticket, "in");
    const e = await db.timeEntry.findUniqueOrThrow({ where: { id: r.entryId } });
    expect(e.source).toBe("kiosk");
    expect(e.kioskDeviceId).toBe(device.id);
    await expect(kioskPunch(device, emp, "123.forged", "out")).rejects.toThrow(ClockError);

    // Another business's employee can't be punched through this kiosk.
    await expect(kioskIdentify(device, B.employee.id, PIN)).rejects.toThrow(ClockError);

    // Exit: an employee's PIN isn't enough; a manager's is — and it revokes the device.
    await expect(exitKiosk(device, emp, PIN)).rejects.toThrow("Only a manager");
    await exitKiosk(device, mgr, PIN);
    expect(await authenticateKiosk(token)).toBeNull();
  });
});

describe("multi-business isolation (§7.1)", () => {
  it("one business cannot discover that the other exists, even for a shared employee", async () => {
    const shared = await addMember(A.business.id, A.roles.employee.id, "Two Jobs");
    const inB = await db.membership.create({ data: { businessId: B.business.id, userId: shared.user.id, roleId: B.roles.employee.id } });
    await db.employeeProfile.create({ data: { businessId: B.business.id, membershipId: inB.id, pinHmac: await hashPin(inB.id, PIN) } });
    await db.membershipLocation.create({ data: { businessId: B.business.id, membershipId: inB.id, locationId: B.location.id } });
    const bEntry = (await punch(actor(inB.id, B), { action: "in", pin: PIN, position: null })).entryId;

    const mgrA = await ctxFor(mgr);
    expect((await workingNow(mgrA)).some((w) => w.entry.id === bEntry)).toBe(false);
    expect((await unresolvedTime(mgrA)).some((u) => u.entry.id === bEntry)).toBe(false);
    const dbA = tenantDb(A.business.id);
    expect(await dbA.timeEntry.count({ where: { id: bEntry } })).toBe(0);
    expect(await dbA.membership.count({ where: { userId: shared.user.id } })).toBe(1);
    expect(await dbA.business.count()).toBe(1);
    await expect(dbA.membership.findMany({ where: { userId: shared.user.id }, include: { user: { include: { memberships: true } } } })).rejects.toThrow();
    // The same PIN in both jobs produces unrelated digests.
    const pa = await db.employeeProfile.findUniqueOrThrow({ where: { membershipId: shared.membership.id } });
    const pb = await db.employeeProfile.findUniqueOrThrow({ where: { membershipId: inB.id } });
    expect(pa.pinHmac).not.toBe(pb.pinHmac);
  });
});

describe("BREAK_MISSED (§7.6.3)", () => {
  // The CA-ON preset seeds a rule: after 5 h, a 30-minute break is required.
  async function nineHoursNoBreak(name: string) {
    const p = await staff(A, "employee", name);
    const start = new Date(Date.now() - 9 * 3600_000);
    await punch(actor(p), { action: "in", pin: PIN, position: here }, { now: start });
    const r = await punch(actor(p), { action: "out", pin: PIN, position: here });
    return { p, entryId: r.entryId, start, flags: r.flags };
  }

  it("is raised at clock-out when the rule isn't satisfied, and managers are told", async () => {
    const { entryId, flags } = await nineHoursNoBreak("NoBreak1");
    expect(flags).toContain("BREAK_MISSED");
    expect(await flagsOf(entryId)).toContain("BREAK_MISSED");
    expect(await db.notification.count({ where: { membershipId: mgr, type: "time.flag", title: "Break missed" } })).toBeGreaterThan(0);
  });

  it("'break was missed, pay it': resolved, nothing deducted, audited", async () => {
    const { entryId } = await nineHoursNoBreak("NoBreak2");
    const f = await db.timeEntryFlag.findFirstOrThrow({ where: { timeEntryId: entryId, type: "BREAK_MISSED" } });
    await resolveBreakMissed(await ctxFor(mgr), { flagId: f.id, resolution: "missed_paid", reason: "Slammed at lunch" });
    expect((await db.timeEntryFlag.findUniqueOrThrow({ where: { id: f.id } })).resolution).toBe("missed_paid: Slammed at lunch");
    expect(await db.breakEntry.count({ where: { timeEntryId: entryId } })).toBe(0);
    expect(await db.timeEntryAudit.count({ where: { timeEntryId: entryId, action: "resolve_flag" } })).toBe(1);
  });

  it("'break was taken, add it': the break is added (and deducted), and the flag resolves", async () => {
    const { entryId, start } = await nineHoursNoBreak("NoBreak3");
    const f = await db.timeEntryFlag.findFirstOrThrow({ where: { timeEntryId: entryId, type: "BREAK_MISSED" } });
    const bStart = new Date(start.getTime() + 4 * 3600_000);
    await resolveBreakMissed(await ctxFor(mgr), { flagId: f.id, resolution: "taken", startsAt: bStart, endsAt: new Date(bStart.getTime() + 30 * 60_000), reason: "Forgot to punch the break" });
    expect(await db.breakEntry.count({ where: { timeEntryId: entryId } })).toBe(1);
    expect((await db.timeEntryFlag.findUniqueOrThrow({ where: { id: f.id } })).resolvedAt).not.toBeNull();
  });

  it("a generic resolve can't be used for BREAK_MISSED — the manager must say which", async () => {
    const { entryId } = await nineHoursNoBreak("NoBreak4");
    const f = await db.timeEntryFlag.findFirstOrThrow({ where: { timeEntryId: entryId, type: "BREAK_MISSED" } });
    await expect(resolveFlag(await ctxFor(mgr), { flagId: f.id, reason: "whatever" })).rejects.toThrow("taken or missed");
  });
});
