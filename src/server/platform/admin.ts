import "server-only";
import { redirect } from "next/navigation";
import { z } from "zod";
import { rawDb } from "@/server/db/client";
import { tenantDb } from "@/server/db/tenant";
import { getSession, ForbiddenError } from "@/server/auth/context";
import { createBusinessWithDefaults } from "./business";
import { issueInvitationToken } from "@/server/services/invitations";
import { audit } from "@/server/audit";
import { randomToken } from "@/lib/crypto";
import { COUNTRIES, CURRENCIES, REGIONS, isValidTimezone } from "@/lib/regions";
import { UserError } from "@/server/action";

export async function requirePlatformAdminPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/admin");
  const user = await rawDb.user.findUnique({ where: { id: session.user.id } });
  if (!user?.isPlatformAdmin) redirect("/");
  return user;
}

export async function requirePlatformAdmin() {
  const session = await getSession();
  const user = session && (await rawDb.user.findUnique({ where: { id: session.user.id } }));
  if (!user?.isPlatformAdmin) throw new ForbiddenError();
  return user;
}

export const createBusinessSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a business name").max(120),
    country: z.enum(COUNTRIES.map((c) => c.code) as [string, ...string[]]),
    region: z.string().min(2).max(3),
    timezone: z.string().refine(isValidTimezone, "Choose a valid timezone"),
    currency: z.enum(CURRENCIES),
    ownerName: z.string().trim().min(1, "Enter the owner's name").max(120),
    ownerEmail: z.string().trim().toLowerCase().email("Enter a valid email"),
  })
  .refine((v) => REGIONS[v.country]?.some((r) => r.code === v.region), {
    path: ["region"],
    message: "Choose a province/state",
  });

export async function createBusinessAndInviteOwner(adminId: string, adminName: string, input: z.infer<typeof createBusinessSchema>) {
  const { business, roles } = await rawDb.$transaction((tx) =>
    createBusinessWithDefaults(tx, {
      name: input.name,
      country: input.country,
      region: input.region,
      timezone: input.timezone,
      currency: input.currency,
    }),
  );
  const inv = await tenantDb(business.id).invitation.create({
    data: {
      email: input.ownerEmail,
      name: input.ownerName,
      roleId: roles.owner.id,
      tokenHash: `pending:${randomToken(16)}`,
      expiresAt: new Date(),
      invitedById: adminId,
    } as never,
  });
  await issueInvitationToken(business.id, inv.id, { inviterName: adminName });
  await audit({
    businessId: business.id,
    actorUserId: adminId,
    action: "PLATFORM_BUSINESS_CREATED",
    targetType: "Business",
    targetId: business.id,
    data: { ownerEmail: input.ownerEmail },
  });
  return business;
}

export async function listBusinesses() {
  const rows = await rawDb.business.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { memberships: true, locations: true } },
      invitations: {
        where: { role: { isOwner: true } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, email: true, status: true, deliveryStatus: true, expiresAt: true, sentAt: true },
      },
    },
  });
  return rows;
}

export const statusSchema = z.object({
  businessId: z.string().min(1),
  subscriptionStatus: z.enum(["trial", "active", "past_due", "cancelled"]).optional(),
  suspended: z.boolean().optional(),
});

export async function updateBusinessStatus(adminId: string, input: z.infer<typeof statusSchema>) {
  const biz = await rawDb.business.findUnique({ where: { id: input.businessId } });
  if (!biz) throw new UserError("Business not found.");
  const data: { subscriptionStatus?: typeof input.subscriptionStatus; suspendedAt?: Date | null } = {};
  if (input.subscriptionStatus) data.subscriptionStatus = input.subscriptionStatus;
  if (input.suspended !== undefined) data.suspendedAt = input.suspended ? (biz.suspendedAt ?? new Date()) : null;
  await rawDb.business.update({ where: { id: biz.id }, data });
  await audit({
    businessId: biz.id,
    actorUserId: adminId,
    action: input.suspended === undefined ? "PLATFORM_SUBSCRIPTION_CHANGED" : input.suspended ? "PLATFORM_SUSPENDED" : "PLATFORM_REACTIVATED",
    targetType: "Business",
    targetId: biz.id,
    data,
  });
}

export async function resendOwnerInvitation(adminName: string, businessId: string, invitationId: string) {
  const inv = await tenantDb(businessId).invitation.findUnique({ where: { id: invitationId }, include: { role: true } });
  if (!inv || !inv.role.isOwner) throw new UserError("Invitation not found.");
  if (inv.status === "accepted") throw new UserError("Already accepted.");
  await issueInvitationToken(businessId, inv.id, { inviterName: adminName });
}

export function getBusinessForAdmin(id: string) {
  return rawDb.business.findUnique({
    where: { id },
    include: {
      invitations: { where: { role: { isOwner: true } }, orderBy: { createdAt: "desc" } },
      memberships: { where: { role: { isOwner: true } }, include: { user: { select: { name: true, email: true } } } },
    },
  });
}
