import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/auth/context";
import { UserError } from "@/server/action";
import {
  invitationDisplayStatus,
  inviteMember,
  issueInvitationToken,
  resendInvitation,
  revokeInvitation,
} from "@/server/services/invitations";
import { acceptInvitation, createAccountFromInvitation, lookupInvitation } from "@/server/platform/accept-invitation";
import { recordDeliveryEvent } from "@/server/email/delivery";
import { sha256Hex } from "@/lib/crypto";
import { addMember, ctxFor, db, makeBusiness, makeUser, uniq } from "../support/fixtures";

type Fx = Awaited<ReturnType<typeof makeBusiness>>;
let A: Fx;
let B: Fx;
let managerId: string;

beforeAll(async () => {
  A = await makeBusiness("InvA");
  B = await makeBusiness("InvB");
  managerId = (await addMember(A.business.id, A.roles.manager.id, "Mgr")).membership.id;
});

/** Invites via the service, then re-issues to learn the raw token (the service never returns it to callers). */
async function inviteAndGetToken(email: string, roleKey: keyof Fx["roles"] = "employee") {
  const ctx = await ctxFor(A.owner.id);
  const { id } = await inviteMember(ctx, {
    name: "New Person",
    email,
    roleId: A.roles[roleKey].id,
    locationIds: [A.location.id],
    positionIds: [A.position.id],
    wageCents: 1850,
    hireDate: "2026-09-01",
  });
  const { token } = await issueInvitationToken(A.business.id, id, { inviterName: "Owner" });
  return { id, token };
}

describe("inviting", () => {
  it("stores the token hashed, emails the link, and records delivery", async () => {
    const email = `${uniq("new")}@example.com`;
    const { id, token } = await inviteAndGetToken(email);
    const inv = await db.invitation.findUniqueOrThrow({ where: { id } });
    expect(inv.tokenHash).toBe(await sha256Hex(token));
    expect(inv.tokenHash).not.toContain(token);
    expect(inv.deliveryStatus).toBe("sent");
    const log = await db.emailLog.findUniqueOrThrow({ where: { id: inv.lastEmailLogId! } });
    expect(log.to).toBe(email);
    expect(log.text).toContain(`/invite/${token}`);
    expect(inv.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86400_000);
  });

  it("denies someone without employees.invite", async () => {
    const emp = await ctxFor(A.employee.id);
    await expect(
      inviteMember(emp, { name: "x", email: "x@example.com", roleId: A.roles.employee.id, locationIds: [], positionIds: [] }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("denies a manager inviting to a role at or above their own", async () => {
    const mgr = await ctxFor(managerId);
    for (const role of ["manager", "general_manager", "owner"] as const) {
      await expect(
        inviteMember(mgr, { name: "x", email: `${uniq("x")}@example.com`, roleId: A.roles[role].id, locationIds: [], positionIds: [] }),
      ).rejects.toThrow(UserError);
    }
  });

  it("allows a manager inviting an employee, but not setting a wage without wages.edit", async () => {
    const mgr = await ctxFor(managerId);
    await expect(
      inviteMember(mgr, { name: "x", email: `${uniq("x")}@example.com`, roleId: A.roles.employee.id, locationIds: [], positionIds: [] }),
    ).resolves.toHaveProperty("id");
    await expect(
      inviteMember(mgr, { name: "x", email: `${uniq("x")}@example.com`, roleId: A.roles.employee.id, locationIds: [], positionIds: [], wageCents: 2000 }),
    ).rejects.toThrow("permission to set wages");
  });

  it("refuses to reference another business's locations", async () => {
    const ctx = await ctxFor(A.owner.id);
    await expect(
      inviteMember(ctx, { name: "x", email: `${uniq("x")}@example.com`, roleId: A.roles.employee.id, locationIds: [B.location.id], positionIds: [] }),
    ).rejects.toThrow();
  });

  it("refuses a duplicate pending invitation", async () => {
    const email = `${uniq("dup")}@example.com`;
    await inviteAndGetToken(email);
    const ctx = await ctxFor(A.owner.id);
    await expect(
      inviteMember(ctx, { name: "x", email, roleId: A.roles.employee.id, locationIds: [], positionIds: [] }),
    ).rejects.toThrow("pending invitation");
  });
});

describe("accepting", () => {
  it("creates an account and membership with locations, positions, wage and hire date; the link is single-use", async () => {
    const email = `${uniq("acc")}@example.com`;
    const { id, token } = await inviteAndGetToken(email);
    expect((await lookupInvitation(token)).state).toBe("valid");

    const res = await createAccountFromInvitation(token, { name: "Pat New", password: "correct horse battery" });
    expect(res.businessId).toBe(A.business.id);
    const m = await db.membership.findFirstOrThrow({
      where: { userId: res.userId, businessId: A.business.id },
      include: { locations: true, positions: true, wages: true, profile: true },
    });
    expect(m.roleId).toBe(A.roles.employee.id);
    expect(m.locations.map((l) => l.locationId)).toEqual([A.location.id]);
    expect(m.positions.map((p) => p.positionId)).toEqual([A.position.id]);
    expect(m.wages).toHaveLength(1);
    expect(m.wages[0].rateCents).toBe(1850);
    expect(m.hireDate?.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(m.profile?.completedAt).toBeNull();
    expect((await db.invitation.findUniqueOrThrow({ where: { id } })).status).toBe("accepted");

    expect((await lookupInvitation(token)).state).toBe("accepted");
    await expect(acceptInvitation(token, res.userId)).rejects.toThrow(UserError);
  });

  it("adds the business to an existing account (§4.2.4)", async () => {
    const other = await addMember(B.business.id, B.roles.employee.id, "Two Jobs");
    const { token } = await inviteAndGetToken(other.user.email);
    expect((await lookupInvitation(token)).existingUser).toBe(true);
    await expect(createAccountFromInvitation(token, { name: "x", password: "whatever-long" })).rejects.toThrow("already exists");
    const businessId = await acceptInvitation(token, other.user.id);
    expect(businessId).toBe(A.business.id);
    const memberships = await db.membership.findMany({ where: { userId: other.user.id } });
    expect(memberships.map((m) => m.businessId).sort()).toEqual([A.business.id, B.business.id].sort());
  });

  it("refuses a user with a different email", async () => {
    const { token } = await inviteAndGetToken(`${uniq("target")}@example.com`);
    const stranger = await makeUser("Stranger");
    await expect(acceptInvitation(token, stranger.id)).rejects.toThrow("different email");
  });

  it("refuses an expired invitation", async () => {
    const { id, token } = await inviteAndGetToken(`${uniq("exp")}@example.com`);
    await db.invitation.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await lookupInvitation(token)).state).toBe("expired");
    await expect(createAccountFromInvitation(token, { name: "x", password: null })).rejects.toThrow(UserError);
  });

  it("refuses a revoked invitation", async () => {
    const { id, token } = await inviteAndGetToken(`${uniq("rev")}@example.com`);
    await revokeInvitation(await ctxFor(A.owner.id), id);
    expect((await lookupInvitation(token)).state).toBe("revoked");
    await expect(createAccountFromInvitation(token, { name: "x", password: null })).rejects.toThrow(UserError);
  });

  it("treats an unknown token as invalid", async () => {
    expect((await lookupInvitation("x".repeat(43))).state).toBe("invalid");
  });

  it("magic-link-only accounts are created without a password", async () => {
    const { token } = await inviteAndGetToken(`${uniq("ml")}@example.com`);
    const res = await createAccountFromInvitation(token, { name: "No Password", password: null });
    expect(await db.account.count({ where: { userId: res.userId } })).toBe(0);
  });
});

describe("delivery tracking (§4.2)", () => {
  it("a bounce marks the invitation Delivery failed; edit address & resend issues a new token", async () => {
    const { id, token } = await inviteAndGetToken(`${uniq("bounce")}@example.com`);
    const inv = await db.invitation.findUniqueOrThrow({ where: { id } });
    await recordDeliveryEvent({ id: inv.lastEmailLogId! }, "bounced");
    const bounced = await db.invitation.findUniqueOrThrow({ where: { id } });
    expect(bounced.deliveryStatus).toBe("bounced");
    expect(invitationDisplayStatus(bounced)).toBe("delivery_failed");

    // A late "delivered" for the same email never hides the bounce.
    await recordDeliveryEvent({ id: inv.lastEmailLogId! }, "delivered");
    expect((await db.invitation.findUniqueOrThrow({ where: { id } })).deliveryStatus).toBe("bounced");

    const fixed = `${uniq("fixed")}@example.com`;
    await resendInvitation(await ctxFor(A.owner.id), id, fixed);
    const after = await db.invitation.findUniqueOrThrow({ where: { id } });
    expect(after.email).toBe(fixed);
    expect(after.deliveryStatus).toBe("sent");
    expect(after.lastEmailLogId).not.toBe(inv.lastEmailLogId);
    expect(invitationDisplayStatus(after)).toBe("invited");
    // The old link no longer works.
    expect((await lookupInvitation(token)).state).toBe("invalid");
  });

  it("delivered and complained events are recorded", async () => {
    const { id } = await inviteAndGetToken(`${uniq("dlv")}@example.com`);
    const inv = await db.invitation.findUniqueOrThrow({ where: { id } });
    await recordDeliveryEvent({ id: inv.lastEmailLogId! }, "delivered");
    expect((await db.invitation.findUniqueOrThrow({ where: { id } })).deliveryStatus).toBe("delivered");
    await recordDeliveryEvent({ id: inv.lastEmailLogId! }, "complained");
    expect(invitationDisplayStatus(await db.invitation.findUniqueOrThrow({ where: { id } }))).toBe("delivery_failed");
  });

  it("a manager cannot resend or revoke an invitation for a senior role", async () => {
    const { id } = await inviteAndGetToken(`${uniq("gm")}@example.com`, "general_manager");
    const mgr = await ctxFor(managerId);
    await expect(resendInvitation(mgr, id)).rejects.toThrow(UserError);
    await expect(revokeInvitation(mgr, id)).rejects.toThrow(UserError);
  });
});
