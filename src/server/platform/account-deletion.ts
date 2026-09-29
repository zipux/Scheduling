import "server-only";
import { rawDb } from "@/server/db/client";
import { audit } from "@/server/audit";
import { sendEmail } from "@/server/email/send";
import { notificationEmail } from "@/server/email/templates";
import { env } from "@/lib/env";

/**
 * "Request account deletion" (Spec §10 Account). This records the request and
 * tells the platform admins; it deletes nothing. Erasure is a supervised step
 * because businesses must keep payroll records for deactivated staff (§11) —
 * see DECISIONS.md.
 */
export async function requestAccountDeletion(userId: string) {
  const user = await rawDb.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true, deletionRequestedAt: true } });
  if (user.deletionRequestedAt) return user.deletionRequestedAt;
  const at = new Date();
  // Conditional update: a double click records one request and one email.
  const { count } = await rawDb.user.updateMany({ where: { id: userId, deletionRequestedAt: null }, data: { deletionRequestedAt: at } });
  if (count === 0) return (await rawDb.user.findUniqueOrThrow({ where: { id: userId } })).deletionRequestedAt!;
  await audit({ businessId: null, actorUserId: userId, action: "ACCOUNT_DELETION_REQUESTED", targetType: "User", targetId: userId });

  const admins = await rawDb.user.findMany({ where: { isPlatformAdmin: true }, select: { email: true } });
  const tpl = await notificationEmail({
    title: "Account deletion requested",
    body: `${user.name} (${user.email}) asked for their account to be deleted.`,
    url: `${env().APP_URL}/admin`,
    cta: "Open platform admin",
  });
  for (const a of admins) await sendEmail({ to: a.email, template: "account-deletion-requested", ...tpl });
  return at;
}

export async function cancelAccountDeletion(userId: string) {
  const { count } = await rawDb.user.updateMany({ where: { id: userId, deletionRequestedAt: { not: null } }, data: { deletionRequestedAt: null } });
  if (count) await audit({ businessId: null, actorUserId: userId, action: "ACCOUNT_DELETION_CANCELLED", targetType: "User", targetId: userId });
}

export async function deletionRequestedAt(userId: string) {
  return (await rawDb.user.findUnique({ where: { id: userId }, select: { deletionRequestedAt: true } }))?.deletionRequestedAt ?? null;
}

/** Platform admin queue: oldest request first, with the businesses each person belongs to. */
export function listDeletionRequests() {
  return rawDb.user.findMany({
    where: { deletionRequestedAt: { not: null } },
    select: {
      id: true,
      name: true,
      email: true,
      deletionRequestedAt: true,
      memberships: { select: { id: true, status: true, business: { select: { id: true, name: true } } } },
    },
    orderBy: { deletionRequestedAt: "asc" },
  });
}
