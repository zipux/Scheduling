import { rawDb } from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";

export interface AuditEntry {
  businessId: string | null;
  actorUserId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  data?: Prisma.InputJsonValue;
}

type AuditWriter = { auditLog: { create: (args: { data: Prisma.AuditLogUncheckedCreateInput }) => Promise<unknown> } };

/** Append-only audit log (Spec §11). Pass a transaction client to write atomically with the change. */
export async function audit(entry: AuditEntry, client: AuditWriter = rawDb) {
  await client.auditLog.create({
    data: {
      businessId: entry.businessId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      data: entry.data ?? undefined,
    },
  });
}
