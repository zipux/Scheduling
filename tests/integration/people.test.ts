import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { createRole, deleteRole, updateRole } from "@/server/services/roles";
import { changeMemberRole, deactivateMember, reactivateMember } from "@/server/services/members";
import { changePin, completeProfile, hashPin, resetPin } from "@/server/services/profile";
import { hashPassword } from "better-auth/crypto";
import { addMember, ctxFor, db, makeBusiness } from "../support/fixtures";

type Fx = Awaited<ReturnType<typeof makeBusiness>>;
let A: Fx;
let B: Fx;

beforeAll(async () => {
  A = await makeBusiness("PplA");
  B = await makeBusiness("PplB");
});

describe("roles & permissions (§3.1)", () => {
  it("owner can create, edit and delete a custom role", async () => {
    const owner = await ctxFor(A.owner.id);
    const role = await createRole(owner, { name: "Dishwasher Lead", rank: 5, permissions: ["trades.approve"] });
    await updateRole(owner, role.id, { name: "Dish Lead", rank: 5, permissions: ["trades.approve", "timeclock.add"] });
    const updated = await db.role.findUniqueOrThrow({ where: { id: role.id } });
    expect(updated.name).toBe("Dish Lead");
    expect(updated.permissions).toEqual(["trades.approve", "timeclock.add"]);
    await deleteRole(owner, role.id);
    expect(await db.role.findUnique({ where: { id: role.id } })).toBeNull();
    expect(await db.auditLog.count({ where: { businessId: A.business.id, action: { in: ["ROLE_CREATED", "ROLE_UPDATED", "ROLE_DELETED"] } } })).toBe(3);
  });

  it("denies roles.manage to a general manager by default", async () => {
    const gm = await addMember(A.business.id, A.roles.general_manager.id, "GM");
    await expect(createRole(await ctxFor(gm.membership.id), { name: "x", rank: 5, permissions: [] })).rejects.toThrow(ForbiddenError);
  });

  it("a non-owner with roles.manage cannot create senior roles or grant permissions they lack", async () => {
    const owner = await ctxFor(A.owner.id);
    const hr = await createRole(owner, { name: "HR", rank: 3, permissions: ["roles.manage", "employees.edit"] });
    const hrMember = await addMember(A.business.id, hr.id, "HR person");
    const hrCtx = await ctxFor(hrMember.membership.id);
    await expect(createRole(hrCtx, { name: "Peer", rank: 3, permissions: [] })).rejects.toThrow("junior");
    await expect(createRole(hrCtx, { name: "Sneaky", rank: 4, permissions: ["wages.edit"] })).rejects.toThrow("don't hold");
    await expect(createRole(hrCtx, { name: "Ok", rank: 4, permissions: ["employees.edit"] })).resolves.toHaveProperty("id");
    await expect(updateRole(hrCtx, A.roles.manager.id, { name: "x", rank: 3, permissions: [] })).rejects.toThrow("junior");
  });

  it("the Owner role cannot be edited or deleted", async () => {
    const owner = await ctxFor(A.owner.id);
    await expect(updateRole(owner, A.roles.owner.id, { name: "Boss", rank: 2, permissions: [] })).rejects.toThrow(UserError);
    await expect(deleteRole(owner, A.roles.owner.id)).rejects.toThrow(UserError);
  });

  it("a role with members cannot be deleted", async () => {
    await expect(deleteRole(await ctxFor(A.owner.id), A.roles.employee.id)).rejects.toThrow("Move everyone");
  });

  it("cannot touch another business's role", async () => {
    await expect(updateRole(await ctxFor(A.owner.id), B.roles.employee.id, { name: "x", rank: 6, permissions: [] })).rejects.toThrow(
      "not found",
    );
  });
});

describe("members", () => {
  it("rank rules for changing roles; the last owner is protected", async () => {
    const mgr = await addMember(A.business.id, A.roles.manager.id, "Mgr2");
    const emp = await addMember(A.business.id, A.roles.employee.id, "Emp2");
    const mgrCtx = await ctxFor(mgr.membership.id);
    await changeMemberRole(mgrCtx, { membershipId: emp.membership.id, roleId: A.roles.shift_lead.id });
    expect((await db.membership.findUniqueOrThrow({ where: { id: emp.membership.id } })).roleId).toBe(A.roles.shift_lead.id);
    await expect(changeMemberRole(mgrCtx, { membershipId: emp.membership.id, roleId: A.roles.manager.id })).rejects.toThrow(UserError);
    await expect(changeMemberRole(mgrCtx, { membershipId: mgr.membership.id, roleId: A.roles.employee.id })).rejects.toThrow(UserError);

    const owner = await ctxFor(A.owner.id);
    await expect(changeMemberRole(owner, { membershipId: A.owner.id, roleId: A.roles.manager.id })).rejects.toThrow(UserError);
  });

  it("deactivation revokes access immediately and keeps the payroll end date separately (§11)", async () => {
    const emp = await addMember(A.business.id, A.roles.employee.id, "Leaver");
    await db.session.create({ data: { userId: emp.user.id, token: `t-${emp.user.id}`, expiresAt: new Date(Date.now() + 86400_000) } });
    await deactivateMember(await ctxFor(A.owner.id), { membershipId: emp.membership.id, employmentEndedAt: "2026-10-10" });
    const m = await db.membership.findUniqueOrThrow({ where: { id: emp.membership.id } });
    expect(m.status).toBe("deactivated");
    expect(m.accessRevokedAt).not.toBeNull();
    expect(m.employmentEndedAt?.toISOString().slice(0, 10)).toBe("2026-10-10");
    expect(await db.session.count({ where: { userId: emp.user.id } })).toBe(0);

    await reactivateMember(await ctxFor(A.owner.id), emp.membership.id);
    const back = await db.membership.findUniqueOrThrow({ where: { id: emp.membership.id } });
    expect(back.accessRevokedAt).toBeNull();
  });

  it("deactivating someone who works elsewhere keeps their sessions for the other business", async () => {
    const emp = await addMember(A.business.id, A.roles.employee.id, "Two Places");
    await db.membership.create({ data: { businessId: B.business.id, userId: emp.user.id, roleId: B.roles.employee.id } });
    await db.session.create({ data: { userId: emp.user.id, token: `t2-${emp.user.id}`, expiresAt: new Date(Date.now() + 86400_000) } });
    await deactivateMember(await ctxFor(A.owner.id), { membershipId: emp.membership.id });
    expect(await db.session.count({ where: { userId: emp.user.id } })).toBe(1);
  });

  it("nobody can deactivate themselves, and managers cannot deactivate seniors", async () => {
    await expect(deactivateMember(await ctxFor(A.owner.id), { membershipId: A.owner.id })).rejects.toThrow("yourself");
    const mgr = await addMember(A.business.id, A.roles.manager.id, "Mgr3");
    const gm = await addMember(A.business.id, A.roles.general_manager.id, "GM3");
    await expect(deactivateMember(await ctxFor(mgr.membership.id), { membershipId: gm.membership.id })).rejects.toThrow(UserError);
  });
});

describe("profile & PIN (§4.2, §7.1)", () => {
  it("stores the PIN only as a per-membership HMAC", async () => {
    const emp = await addMember(A.business.id, A.roles.employee.id, "Pinner");
    const ctx = await ctxFor(emp.membership.id);
    await completeProfile(ctx, {
      phone: "+14165550123",
      dateOfBirth: "2000-01-01",
      address: "1 Main St, Toronto",
      emergencyContactName: "Mum",
      emergencyContactRelation: "Mother",
      emergencyContactPhone: "+14165550124",
      pin: "4821",
      pinConfirm: "4821",
    });
    const p = await db.employeeProfile.findUniqueOrThrow({ where: { membershipId: emp.membership.id } });
    expect(p.completedAt).not.toBeNull();
    expect(p.pinHmac).toBe(await hashPin(emp.membership.id, "4821"));
    expect(p.pinHmac).not.toContain("4821");
    expect(p.dateOfBirth?.toISOString().slice(0, 10)).toBe("2000-01-01");
  });

  it("changing a PIN requires the current password", async () => {
    const emp = await addMember(A.business.id, A.roles.employee.id, "Changer");
    await db.account.create({
      data: { userId: emp.user.id, accountId: emp.user.id, providerId: "credential", password: await hashPassword("right-password") },
    });
    const ctx = await ctxFor(emp.membership.id);
    await expect(changePin(ctx, { currentPassword: "wrong-password", pin: "1111", pinConfirm: "1111" })).rejects.toThrow("isn't right");
    await changePin(ctx, { currentPassword: "right-password", pin: "2222", pinConfirm: "2222" });
    const p = await db.employeeProfile.findUniqueOrThrow({ where: { membershipId: emp.membership.id } });
    expect(p.pinHmac).toBe(await hashPin(emp.membership.id, "2222"));
  });

  it("managers can reset a junior's PIN, not a senior's", async () => {
    const emp = await addMember(A.business.id, A.roles.employee.id, "Forgetful");
    await db.employeeProfile.update({ where: { membershipId: emp.membership.id }, data: { pinHmac: "x" } });
    const mgr = await addMember(A.business.id, A.roles.manager.id, "Mgr4");
    await resetPin(await ctxFor(mgr.membership.id), emp.membership.id);
    expect((await db.employeeProfile.findUniqueOrThrow({ where: { membershipId: emp.membership.id } })).pinHmac).toBeNull();
    await expect(resetPin(await ctxFor(mgr.membership.id), A.owner.id)).rejects.toThrow(UserError);
    await expect(resetPin(await ctxFor(emp.membership.id), mgr.membership.id)).rejects.toThrow(UserError);
  });
});
