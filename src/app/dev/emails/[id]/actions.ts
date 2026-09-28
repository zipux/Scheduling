"use server";

import { revalidatePath } from "next/cache";
import { recordDeliveryEvent } from "@/server/email/delivery";

/** Dev only: simulate what the Resend webhook would report for this email. */
export async function simulateDelivery(id: string, status: "delivered" | "bounced" | "complained") {
  if (process.env.NODE_ENV === "production") throw new Error("Not available");
  await recordDeliveryEvent({ id }, status);
  revalidatePath(`/dev/emails/${id}`);
}
