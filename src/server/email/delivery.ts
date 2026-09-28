import { rawDb } from "@/server/db/client";
import type { DeliveryStatus } from "@/generated/prisma/client";

/**
 * Applies a delivery event to EmailLog and to any invitation whose latest email
 * it was (Spec §4.2 delivery tracking). A later "delivered" never overrides a
 * bounce/complaint for the same email.
 */
export async function recordDeliveryEvent(where: { providerId: string } | { id: string }, status: DeliveryStatus) {
  const log = await rawDb.emailLog.findUnique({ where: "id" in where ? { id: where.id } : { providerId: where.providerId } });
  if (!log) return false;
  const failed = log.status === "bounced" || log.status === "complained";
  if (failed && status === "delivered") return true;
  await rawDb.emailLog.update({ where: { id: log.id }, data: { status } });
  await rawDb.invitation.updateMany({ where: { lastEmailLogId: log.id }, data: { deliveryStatus: status } });
  return true;
}

export const RESEND_EVENT_STATUS: Record<string, DeliveryStatus | undefined> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
};
