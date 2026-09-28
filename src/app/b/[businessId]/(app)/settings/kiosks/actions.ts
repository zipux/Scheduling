"use server";

import { z } from "zod";
import { assertCan } from "@/server/auth/context";
import { businessAction, UserError } from "@/server/action";
import { audit } from "@/server/audit";

export const revokeKioskAction = businessAction(z.object({ id: z.string().min(1) }), async (ctx, i) => {
  assertCan(ctx, "timeclock.edit");
  const n = await ctx.db.kioskDevice.updateMany({ where: { id: i.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!n.count) throw new UserError("Device not found.");
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "KIOSK_REVOKED", targetType: "KioskDevice", targetId: i.id });
});
