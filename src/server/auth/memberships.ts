import "server-only";
import { rawDb } from "@/server/db/client";

/** Number of businesses a user can currently use. Cross-tenant by design; returns a count only. */
export function activeMembershipCount(userId: string) {
  return rawDb.membership.count({
    where: { userId, status: "active", accessRevokedAt: null, business: { suspendedAt: null } },
  });
}
