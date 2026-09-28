import "server-only";
import { z } from "zod";
import { tenantDb } from "@/server/db/tenant";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { env } from "@/lib/env";
import { sendEmail } from "@/server/email/send";
import { invitationEmail } from "@/server/email/templates";
import { audit } from "@/server/audit";
import { rateLimit } from "@/server/rate-limit";
import { assertCan, type BusinessContext } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { can } from "@/lib/permissions";

export const INVITATION_TTL_DAYS = 7;
export const UNACCEPTED_WARNING_HOURS = 72;

export const inviteSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  roleId: z.string().min(1, "Choose a role"),
  locationIds: z.array(z.string()).default([]),
  positionIds: z.array(z.string()).default([]),
  wageCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
  hireDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export type InvitationDisplayStatus = "invited" | "delivery_failed" | "accepted" | "revoked" | "expired";

export function invitationDisplayStatus(
  inv: { status: string; deliveryStatus: string; expiresAt: Date },
  now = new Date(),
): InvitationDisplayStatus {
  if (inv.status === "accepted") return "accepted";
  if (inv.status === "revoked") return "revoked";
  // An invitation must never sit on "Invited" when the email never arrived (§4.2).
  if (inv.deliveryStatus === "bounced" || inv.deliveryStatus === "complained") return "delivery_failed";
  if (inv.status === "expired" || inv.expiresAt < now) return "expired";
  return "invited";
}

/** Invitations that need a manager's attention: bounced, or unaccepted past 72 h (§4.2). */
export function needsAttention(
  inv: { status: string; deliveryStatus: string; expiresAt: Date; sentAt: Date },
  now = new Date(),
) {
  const s = invitationDisplayStatus(inv, now);
  if (s === "delivery_failed") return true;
  return s === "invited" && now.getTime() - inv.sentAt.getTime() > UNACCEPTED_WARNING_HOURS * 3600_000;
}

/**
 * Generates a fresh single-use token (stored hashed), emails the link and records
 * the delivery outcome. Used for first send and every resend.
 */
export async function issueInvitationToken(
  businessId: string,
  invitationId: string,
  opts: { inviterName: string | null },
) {
  const db = tenantDb(businessId);
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const inv = await db.invitation.update({
    where: { id: invitationId },
    data: {
      tokenHash,
      expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86400_000),
      status: "pending",
      deliveryStatus: "queued",
      sentAt: new Date(),
    },
    include: { role: true, business: true },
  });
  const url = `${env().APP_URL}/invite/${token}`;
  const tpl = await invitationEmail({
    url,
    businessName: inv.business.name,
    inviterName: opts.inviterName,
    roleName: inv.role.name,
  });
  const sent = await sendEmail({ to: inv.email, template: "invitation", businessId, ...tpl });
  await db.invitation.update({
    where: { id: invitationId },
    data: { lastEmailLogId: sent.id, deliveryStatus: sent.status === "sent" ? "sent" : "bounced" },
  });
  return { token, url };
}

/** The role must be junior to the inviter, unless the inviter is Owner (§3.3). */
async function assertAssignableRole(ctx: BusinessContext, roleId: string) {
  const role = await ctx.db.role.findUnique({ where: { id: roleId } });
  if (!role) throw new UserError("Choose a role", { roleId: ["Choose a role"] });
  if (!ctx.actor.isOwner && (role.isOwner || role.rank <= ctx.actor.rank)) {
    throw new UserError("You can only invite people to roles junior to your own.", {
      roleId: ["Choose a role junior to yours"],
    });
  }
  return role;
}

export async function inviteMember(ctx: BusinessContext, input: InviteInput) {
  assertCan(ctx, "employees.invite");
  if (input.wageCents != null && !can(ctx.actor, "wages.edit")) {
    throw new UserError("You don't have permission to set wages.");
  }
  if (!(await rateLimit(`invite:${ctx.businessId}`, 100, 3600))) {
    throw new UserError("Too many invitations sent in the last hour. Try again later.");
  }
  await assertAssignableRole(ctx, input.roleId);

  const existingMember = await ctx.db.membership.findFirst({
    where: { user: { email: input.email }, status: "active", accessRevokedAt: null },
  });
  if (existingMember) {
    throw new UserError("That person is already a member of this business.", { email: ["Already a member"] });
  }
  const pending = await ctx.db.invitation.findFirst({
    where: { email: input.email, status: "pending", expiresAt: { gt: new Date() } },
  });
  if (pending) {
    throw new UserError("That email already has a pending invitation. Resend it from the list instead.", {
      email: ["Already invited"],
    });
  }

  const inv = await ctx.db.invitation.create({
    data: {
      email: input.email,
      name: input.name,
      roleId: input.roleId,
      locationIds: input.locationIds,
      positionIds: input.positionIds,
      wageCents: input.wageCents ?? null,
      hireDate: input.hireDate ? new Date(`${input.hireDate}T00:00:00Z`) : null,
      // Placeholder until issueInvitationToken sets the real one.
      tokenHash: `pending:${randomToken(16)}`,
      expiresAt: new Date(),
      invitedById: ctx.userId,
    } as never,
  });
  await issueInvitationToken(ctx.businessId, inv.id, { inviterName: ctx.userName });
  await audit({
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action: "INVITATION_SENT",
    targetType: "Invitation",
    targetId: inv.id,
    data: { email: input.email, roleId: input.roleId },
  });
  return { id: inv.id };
}

async function loadManageable(ctx: BusinessContext, invitationId: string) {
  assertCan(ctx, "employees.invite");
  const inv = await ctx.db.invitation.findUnique({ where: { id: invitationId }, include: { role: true } });
  if (!inv) throw new UserError("Invitation not found.");
  if (!ctx.actor.isOwner && (inv.role.isOwner || inv.role.rank <= ctx.actor.rank)) {
    throw new UserError("You can't manage invitations for roles at or above your own.");
  }
  return inv;
}

export async function resendInvitation(ctx: BusinessContext, invitationId: string, newEmail?: string) {
  const inv = await loadManageable(ctx, invitationId);
  if (inv.status === "accepted") throw new UserError("This invitation has already been accepted.");
  if (!(await rateLimit(`invite:${ctx.businessId}`, 100, 3600))) {
    throw new UserError("Too many invitations sent in the last hour. Try again later.");
  }
  if (newEmail && newEmail !== inv.email) {
    await ctx.db.invitation.update({ where: { id: inv.id }, data: { email: newEmail } });
  }
  await issueInvitationToken(ctx.businessId, inv.id, { inviterName: ctx.userName });
  await audit({
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action: newEmail && newEmail !== inv.email ? "INVITATION_READDRESSED" : "INVITATION_RESENT",
    targetType: "Invitation",
    targetId: inv.id,
    data: newEmail ? { from: inv.email, to: newEmail } : undefined,
  });
}

export async function revokeInvitation(ctx: BusinessContext, invitationId: string) {
  const inv = await loadManageable(ctx, invitationId);
  if (inv.status === "accepted") throw new UserError("This invitation has already been accepted.");
  await ctx.db.invitation.update({ where: { id: inv.id }, data: { status: "revoked" } });
  await audit({
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action: "INVITATION_REVOKED",
    targetType: "Invitation",
    targetId: inv.id,
  });
}
