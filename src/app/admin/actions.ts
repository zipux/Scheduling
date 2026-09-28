"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createBusinessAndInviteOwner,
  createBusinessSchema,
  requirePlatformAdmin,
  resendOwnerInvitation,
  statusSchema,
  updateBusinessStatus,
} from "@/server/platform/admin";
import { toResult, type ActionResult } from "@/server/action";

export async function createBusinessAction(raw: z.input<typeof createBusinessSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const admin = await requirePlatformAdmin();
    const input = createBusinessSchema.parse(raw);
    const biz = await createBusinessAndInviteOwner(admin.id, admin.name, input);
    revalidatePath("/admin");
    return { ok: true, data: { id: biz.id } };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateStatusAction(raw: z.input<typeof statusSchema>): Promise<ActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    await updateBusinessStatus(admin.id, statusSchema.parse(raw));
    revalidatePath("/admin");
    return { ok: true, data: undefined };
  } catch (err) {
    return toResult(err);
  }
}

export async function resendOwnerInviteAction(businessId: string, invitationId: string): Promise<ActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    await resendOwnerInvitation(admin.name, z.string().parse(businessId), z.string().parse(invitationId));
    revalidatePath("/admin");
    return { ok: true, data: undefined };
  } catch (err) {
    return toResult(err);
  }
}
