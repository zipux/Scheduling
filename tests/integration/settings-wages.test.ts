import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { TenantViolationError } from "@/server/db/tenant";
import { createPosition, setPositionArchived, updatePosition } from "@/server/services/positions";
import { createLocation, setLocationArchived, updateLocation } from "@/server/services/locations";
import { saveClockRules, saveRequestRules } from "@/server/services/business-settings";
import { setMemberAssignments } from "@/server/services/members";
import { addWage, listWages } from "@/server/services/wages";
import { addMember, ctxFor, db, makeBusiness } from "../support/fixtures";

type Fx = Awaited<ReturnType<typeof makeBusiness>>;
let A: Fx;
let B: Fx;
let mgr: string;
let gm: string;

beforeAll(async () => {
  A = await makeBusiness("SetA");
  B = await makeBusiness("SetB");
  mgr = (await addMember(A.business.id, A.roles.manager.id, "Mgr")).membership.id;
  gm = (await addMember(A.business.id, A.roles.general_manager.id, "GM")).membership.id;
});

const loc = {
  name: "Patio",
  address: "",
  timezone: "America/Toronto",
  lat: 43.6,
  lng: -79.4,
  radiusM: 80,
  geofenceMode: "required" as const,
  isTemporary: true,
};

describe("positions", () => {
  it("owner creates, edits and archives; duplicate names are refused", async () => {
    const owner = await ctxFor(A.owner.id);
    const p = await createPosition(owner, { name: "Bar", color: "#7c3aed", requiresMinimumAge: 18 });
    await expect(createPosition(owner, { name: "bar", color: "#000000", requiresMinimumAge: null })).rejects.toThrow("already exists");
    await updatePosition(owner, p.id, { name: "Bar", color: "#111111", requiresMinimumAge: 19 });
    expect((await db.position.findUniqueOrThrow({ where: { id: p.id } })).requiresMinimumAge).toBe(19);
    await setPositionArchived(owner, p.id, true);
    expect((await db.position.findUniqueOrThrow({ where: { id: p.id } })).archivedAt).not.toBeNull();
  });
  it("denies without business.settings", async () => {
    await expect(createPosition(await ctxFor(mgr), { name: "X", color: "#000000", requiresMinimumAge: null })).rejects.toThrow(ForbiddenError);
  });
  it("cannot edit another business's position", async () => {
    await expect(updatePosition(await ctxFor(A.owner.id), B.position.id, { name: "x", color: "#000000", requiresMinimumAge: null })).rejects.toThrow("not found");
  });
});

describe("locations", () => {
  it("owner creates and updates a temporary location with a geofence", async () => {
    const owner = await ctxFor(A.owner.id);
    const l = await createLocation(owner, loc);
    expect(l.isTemporary).toBe(true);
    await updateLocation(owner, l.id, { ...loc, radiusM: 150, geofenceMode: "warn" });
    const after = await db.location.findUniqueOrThrow({ where: { id: l.id } });
    expect(after.radiusM).toBe(150);
    expect(after.geofenceMode).toBe("warn");
    await setLocationArchived(owner, l.id, true);
  });
  it("won't archive the last active location", async () => {
    await expect(setLocationArchived(await ctxFor(A.owner.id), A.location.id, true)).rejects.toThrow("at least one");
  });
  it("denies a manager without business.settings", async () => {
    await expect(createLocation(await ctxFor(mgr), loc)).rejects.toThrow(ForbiddenError);
  });
});

describe("business settings", () => {
  it("owner saves request and clock rules (audited)", async () => {
    const owner = await ctxFor(A.owner.id);
    await saveRequestRules(owner, {
      allowSelfTimeOffApproval: false,
      escalateAfterHours: 48,
      timeOffMinNoticeDays: 14,
      availabilityNeedsApproval: true,
      dropNeedsApproval: true,
      pickupNeedsApproval: false,
      swapNeedsApproval: true,
    });
    await saveClockRules(owner, {
      clockModePersonal: true,
      clockModeKiosk: false,
      earlyClockInMinutes: 15,
      allowUnscheduledClockIn: false,
      roundingMode: "none",
      roundingIntervalMinutes: 15,
      lateToleranceMinutes: 7,
      maxShiftHours: 14,
      maxClockSkewMinutes: 20,
      workDayStartMinutes: 300,
    });
    const b = await db.business.findUniqueOrThrow({ where: { id: A.business.id } });
    expect(b.allowSelfTimeOffApproval).toBe(false);
    expect(b.timeOffMinNoticeDays).toBe(14);
    expect(b.roundingIntervalMinutes).toBe(0);
    expect(b.workDayStartMinutes).toBe(300);
    expect(await db.auditLog.count({ where: { businessId: A.business.id, action: "CLOCK_RULES_UPDATED" } })).toBe(1);
  });
  it("denies a manager", async () => {
    await expect(
      saveRequestRules(await ctxFor(mgr), {
        allowSelfTimeOffApproval: true,
        escalateAfterHours: 72,
        timeOffMinNoticeDays: 0,
        availabilityNeedsApproval: false,
        dropNeedsApproval: true,
        pickupNeedsApproval: true,
        swapNeedsApproval: true,
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("assignments", () => {
  it("a manager sets a junior's locations and positions", async () => {
    const emp = await addMember(A.business.id, A.roles.employee.id, "Assign me");
    const p2 = await db.position.create({ data: { businessId: A.business.id, name: "Host" } });
    await setMemberAssignments(await ctxFor(mgr), { membershipId: emp.membership.id, locationIds: [A.location.id], positionIds: [A.position.id, p2.id] });
    await setMemberAssignments(await ctxFor(mgr), { membershipId: emp.membership.id, locationIds: [A.location.id], positionIds: [p2.id] });
    const ps = await db.membershipPosition.findMany({ where: { membershipId: emp.membership.id } });
    expect(ps.map((p) => p.positionId)).toEqual([p2.id]);
  });
  it("refuses another business's location ids", async () => {
    const emp = await addMember(A.business.id, A.roles.employee.id, "Cross");
    await expect(
      setMemberAssignments(await ctxFor(A.owner.id), { membershipId: emp.membership.id, locationIds: [B.location.id], positionIds: [] }),
    ).rejects.toThrow(TenantViolationError);
  });
  it("a manager cannot edit a senior", async () => {
    await expect(setMemberAssignments(await ctxFor(mgr), { membershipId: gm, locationIds: [], positionIds: [] })).rejects.toThrow(UserError);
  });
});

describe("wages (§8)", () => {
  const w = (membershipId: string, over: Partial<Parameters<typeof addWage>[1]> = {}) => ({
    membershipId,
    rateCents: 2100,
    type: "hourly" as const,
    positionId: null,
    effectiveFrom: "2026-11-01",
    ...over,
  });

  it("GM with wages.edit adds a junior's wage; history is append-only and audited", async () => {
    const before = await db.wage.count({ where: { membershipId: A.employee.id } });
    await addWage(await ctxFor(gm), w(A.employee.id));
    expect(await db.wage.count({ where: { membershipId: A.employee.id } })).toBe(before + 1);
    expect(await db.auditLog.count({ where: { businessId: A.business.id, action: "WAGE_CHANGED" } })).toBeGreaterThan(0);
  });
  it("a manager (wages.view, no wages.edit) can see but not change wages", async () => {
    const ctx = await ctxFor(mgr);
    expect((await listWages(ctx, A.employee.id)).length).toBeGreaterThan(0);
    await expect(addWage(ctx, w(A.employee.id))).rejects.toThrow(ForbiddenError);
  });
  it("an employee sees their own wage but not anyone else's", async () => {
    const ctx = await ctxFor(A.employee.id);
    expect((await listWages(ctx, A.employee.id)).length).toBeGreaterThan(0);
    await expect(listWages(ctx, mgr)).rejects.toThrow(ForbiddenError);
  });
  it("GM cannot change the owner's or their own wage", async () => {
    const ctx = await ctxFor(gm);
    await expect(addWage(ctx, w(A.owner.id))).rejects.toThrow("junior");
    await expect(addWage(ctx, w(gm))).rejects.toThrow("your own wage");
  });
  it("a salary can't be tied to a position", async () => {
    await expect(addWage(await ctxFor(A.owner.id), w(A.employee.id, { type: "salary", rateCents: 5_000_000, positionId: A.position.id }))).rejects.toThrow(UserError);
  });
  it("can't take effect inside an approved pay period", async () => {
    await db.payPeriod.create({
      data: { businessId: A.business.id, startDate: new Date("2026-09-14"), endDate: new Date("2026-09-27"), status: "approved" },
    });
    await expect(addWage(await ctxFor(A.owner.id), w(A.employee.id, { effectiveFrom: "2026-09-20" }))).rejects.toThrow("approved pay period");
    await expect(addWage(await ctxFor(A.owner.id), w(A.employee.id, { effectiveFrom: "2026-09-28" }))).resolves.toBeTruthy();
  });
  it("refuses a position from another business", async () => {
    await expect(addWage(await ctxFor(A.owner.id), w(A.employee.id, { positionId: B.position.id }))).rejects.toThrow(TenantViolationError);
  });
});
