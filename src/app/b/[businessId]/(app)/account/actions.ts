"use server";

import { revalidatePath } from "next/cache";
import { businessAction, toResult, type ActionResult } from "@/server/action";
import { ForbiddenError, getSession } from "@/server/auth/context";
import { cancelAccountDeletion, requestAccountDeletion } from "@/server/platform/account-deletion";
import { changePin, changePinSchema } from "@/server/services/profile";

export const changePinAction = businessAction(changePinSchema, changePin);

async function signedInUserId() {
  const session = await getSession();
  if (!session) throw new ForbiddenError();
  return session.user.id;
}

/** Account-level, not business-level: the request covers the whole account. */
export async function requestAccountDeletionAction(): Promise<ActionResult> {
  try {
    await requestAccountDeletion(await signedInUserId());
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (err) {
    return toResult(err);
  }
}

export async function cancelAccountDeletionAction(): Promise<ActionResult> {
  try {
    await cancelAccountDeletion(await signedInUserId());
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (err) {
    return toResult(err);
  }
}
