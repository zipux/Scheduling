import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLES,
  PERMISSIONS,
  can,
  canEditTimeEntry,
  canManagePerson,
  canReviewRequest,
  canViewWage,
  outranks,
  parsePermissions,
  type Actor,
  type Permission,
} from "@/lib/permissions";

function actor(membershipId: string, rank: number, perms: Permission[] = [], isOwner = false): Actor {
  return { userId: `u-${membershipId}`, membershipId, rank, isOwner, permissions: new Set(perms) };
}

const owner = actor("owner", 1, [], true);
const manager = actor("mgr", 3, ["timeoff.approve", "timeclock.edit", "timeclock.add", "employees.edit"]);
const lead = actor("lead", 5, ["trades.approve"]);
const employee = actor("emp", 6);
const peerManager = { membershipId: "mgr2", rank: 3 };

describe("default roles", () => {
  it("has the six ranked roles with owner first and holding every permission", () => {
    expect(DEFAULT_ROLES.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(DEFAULT_ROLES[0].permissions).toEqual([...PERMISSIONS]);
    expect(DEFAULT_ROLES.at(-1)!.permissions).toEqual([]);
  });
  it("parsePermissions drops unknown keys", () => {
    expect(parsePermissions(["wages.view", "nope", 3])).toEqual(["wages.view"]);
    expect(parsePermissions(null)).toEqual([]);
  });
});

describe("can", () => {
  it("allows a held permission", () => expect(can(manager, "timeoff.approve")).toBe(true));
  it("denies a missing permission", () => expect(can(manager, "payrules.manage")).toBe(false));
  it("owner has everything", () => expect(can(owner, "payrules.manage")).toBe(true));
  it("employee has nothing", () => expect(can(employee, "schedule.edit")).toBe(false));
});

describe("outranks (§3.3)", () => {
  it("allows acting on lower rank", () => expect(outranks(manager, { membershipId: "emp", rank: 6 })).toBe(true));
  it("denies acting on equal rank", () => expect(outranks(manager, peerManager)).toBe(false));
  it("denies acting on higher rank", () => expect(outranks(lead, { membershipId: "mgr", rank: 3 })).toBe(false));
  it("owner may act on another owner", () => expect(outranks(owner, { membershipId: "owner2", rank: 1 })).toBe(true));
  it("nobody outranks themselves", () => expect(outranks(owner, { membershipId: "owner", rank: 1 })).toBe(false));
});

describe("canReviewRequest", () => {
  const emp = { membershipId: "emp", rank: 6 };
  it("allows an approver of higher rank", () =>
    expect(canReviewRequest(manager, emp, "timeoff.approve", true)).toEqual({ allowed: true, self: false }));
  it("denies without the permission", () =>
    expect(canReviewRequest(lead, emp, "timeoff.approve", true)).toEqual({ allowed: false, self: false }));
  it("denies a peer of equal rank", () =>
    expect(canReviewRequest(manager, peerManager, "timeoff.approve", true).allowed).toBe(false));
  it("allows self-approval when the business setting is on, and marks it self", () =>
    expect(canReviewRequest(manager, { membershipId: "mgr", rank: 3 }, "timeoff.approve", true)).toEqual({
      allowed: true,
      self: true,
    }));
  it("denies self-approval when the business setting is off", () =>
    expect(canReviewRequest(manager, { membershipId: "mgr", rank: 3 }, "timeoff.approve", false)).toEqual({
      allowed: false,
      self: true,
    }));
  it("denies self-approval without the permission even when the setting is on", () =>
    expect(canReviewRequest(employee, { membershipId: "emp", rank: 6 }, "timeoff.approve", true).allowed).toBe(false));
});

describe("canEditTimeEntry — nobody edits their own time (§3.3)", () => {
  it("allows a manager to edit a lower-ranked employee's entry", () =>
    expect(canEditTimeEntry(manager, { membershipId: "emp", rank: 6 }, "timeclock.edit")).toBe(true));
  it("denies a manager editing their own entry", () =>
    expect(canEditTimeEntry(manager, { membershipId: "mgr", rank: 3 }, "timeclock.edit")).toBe(false));
  it("denies the owner editing their own entry", () =>
    expect(canEditTimeEntry(owner, { membershipId: "owner", rank: 1 }, "timeclock.edit")).toBe(false));
  it("allows the owner to edit a general manager's entry", () =>
    expect(canEditTimeEntry(owner, { membershipId: "gm", rank: 2 }, "timeclock.add")).toBe(true));
  it("denies without the permission", () =>
    expect(canEditTimeEntry(lead, { membershipId: "emp", rank: 6 }, "timeclock.edit")).toBe(false));
  it("denies editing a peer", () => expect(canEditTimeEntry(manager, peerManager, "timeclock.edit")).toBe(false));
});

describe("canViewWage", () => {
  it("always allows your own wage", () => expect(canViewWage(employee, "emp")).toBe(true));
  it("denies another's wage without wages.view", () => expect(canViewWage(employee, "mgr")).toBe(false));
  it("allows another's wage with wages.view", () =>
    expect(canViewWage(actor("x", 3, ["wages.view"]), "emp")).toBe(true));
});

describe("canManagePerson", () => {
  it("allows with permission and seniority", () =>
    expect(canManagePerson(manager, { membershipId: "emp", rank: 6 }, "employees.edit")).toBe(true));
  it("denies with permission but no seniority", () =>
    expect(canManagePerson(manager, peerManager, "employees.edit")).toBe(false));
  it("denies with seniority but no permission", () =>
    expect(canManagePerson(manager, { membershipId: "emp", rank: 6 }, "wages.edit")).toBe(false));
});
