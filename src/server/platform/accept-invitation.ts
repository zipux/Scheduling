import "server-only";
import { hashPassword } from "better-auth/crypto";
import { rawDb } from "@/server/db/client";
import { sha256Hex } from "@/lib/crypto";
import { audit } from "@/server/audit";
import { UserError } from "@/server/action";

// Accepting an invitation is inherently cross-tenant (the visitor has no
// membership yet), so it lives in the platform layer and uses the raw client,
// always constrained by the invitation's own businessId.

export type InvitationState = "valid" | "invalid" | "expired" | "revoked" | "accepted";

export async function lookupInvitation(token: string) {
  if (!token || token.length < 20 || token.length > 200) return { state: "invalid" as const };
  const inv = await rawDb.invitation.findUnique({
    where: { tokenHash: await sha256Hex(token) },
    include: { business: { select: { id: true, name: true, suspendedAt: true } }, role: { select: { name: true } } },
  });
  if (!inv || inv.business.suspendedAt) return { state: "invalid" as const };
  let state: InvitationState = "valid";
  if (inv.status === "accepted") state = "accepted";
  else if (inv.status === "revoked") state = "revoked";
  else if (inv.status === "expired" || inv.expiresAt < new Date()) state = "expired";
  const existingUser = await rawDb.user.findUnique({ where: { email: inv.email }, select: { id: true } });
  return {
    state,
    invitation: {
      id: inv.id,
      email: inv.email,
      name: inv.name,
      businessId: inv.businessId,
      businessName: inv.business.name,
      roleName: inv.role.name,
    },
    existingUser: !!existingUser,
  };
}

/**
 * Consumes the invitation (single use, via a conditional update) and creates or
 * reactivates the membership. If the user already belongs to other businesses,
 * this simply adds one more (§4.2.4).
 */
export async function acceptInvitation(token: string, userId: string) {
  const tokenHash = await sha256Hex(token);
  const user = await rawDb.user.findUnique({ where: { id: userId } });
  if (!user) throw new UserError("Account not found.");

  const businessId = await rawDb.$transaction(async (tx) => {
    const inv = await tx.invitation.findUnique({ where: { tokenHash } });
    if (!inv) throw new UserError("This invitation link is not valid.");
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new UserError("This invitation was sent to a different email address.");
    }
    const claimed = await tx.invitation.updateMany({
      where: { id: inv.id, tokenHash, status: "pending", expiresAt: { gt: new Date() } },
      data: { status: "accepted", acceptedAt: new Date() },
    });
    if (claimed.count !== 1) throw new UserError("This invitation has already been used or has expired.");

    const existing = await tx.membership.findUnique({
      where: { businessId_userId: { businessId: inv.businessId, userId } },
    });
    const membership = existing
      ? await tx.membership.update({
          where: { id: existing.id },
          data: {
            roleId: inv.roleId,
            status: "active",
            accessRevokedAt: null,
            employmentEndedAt: null,
            hireDate: inv.hireDate ?? existing.hireDate,
          },
        })
      : await tx.membership.create({
          data: {
            businessId: inv.businessId,
            userId,
            roleId: inv.roleId,
            status: "active",
            hireDate: inv.hireDate ?? new Date(new Date().toISOString().slice(0, 10)),
          },
        });

    // Only ids that really belong to this business are attached.
    const [locations, positions] = await Promise.all([
      tx.location.findMany({ where: { businessId: inv.businessId, id: { in: inv.locationIds } }, select: { id: true } }),
      tx.position.findMany({ where: { businessId: inv.businessId, id: { in: inv.positionIds } }, select: { id: true } }),
    ]);
    if (locations.length) {
      await tx.membershipLocation.createMany({
        data: locations.map((l) => ({ businessId: inv.businessId, membershipId: membership.id, locationId: l.id })),
        skipDuplicates: true,
      });
    }
    if (positions.length) {
      await tx.membershipPosition.createMany({
        data: positions.map((p) => ({ businessId: inv.businessId, membershipId: membership.id, positionId: p.id })),
        skipDuplicates: true,
      });
    }
    if (inv.wageCents != null) {
      await tx.wage.create({
        data: {
          businessId: inv.businessId,
          membershipId: membership.id,
          rateCents: inv.wageCents,
          type: "hourly",
          effectiveFrom: inv.hireDate ?? new Date(new Date().toISOString().slice(0, 10)),
          createdById: inv.invitedById,
        },
      });
    }
    if (!existing) {
      await tx.employeeProfile.create({ data: { businessId: inv.businessId, membershipId: membership.id } });
    }
    await audit(
      {
        businessId: inv.businessId,
        actorUserId: userId,
        action: "INVITATION_ACCEPTED",
        targetType: "Invitation",
        targetId: inv.id,
        data: { membershipId: membership.id },
      },
      tx,
    );
    return inv.businessId;
  });
  // Clicking the emailed link proves the address.
  if (!user.emailVerified) await rawDb.user.update({ where: { id: userId }, data: { emailVerified: true } });
  return businessId;
}

/** New account from an invitation: own password, or none (magic link only). */
export async function createAccountFromInvitation(token: string, input: { name: string; password: string | null }) {
  const found = await lookupInvitation(token);
  if (found.state !== "valid" || !found.invitation) throw new UserError("This invitation link is no longer valid.");
  if (found.existingUser) throw new UserError("An account already exists for this email. Sign in to accept.");
  const user = await rawDb.user.create({
    data: { name: input.name, email: found.invitation.email, emailVerified: true },
  });
  if (input.password) {
    await rawDb.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: await hashPassword(input.password),
      },
    });
  }
  try {
    const businessId = await acceptInvitation(token, user.id);
    return { userId: user.id, email: user.email, businessId };
  } catch (err) {
    // Don't leave an orphan account behind if the invitation was consumed concurrently.
    await rawDb.user.delete({ where: { id: user.id } }).catch(() => {});
    throw err;
  }
}
