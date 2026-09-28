import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { verifySvix } from "@/lib/svix";
import { RESEND_EVENT_STATUS, recordDeliveryEvent } from "@/server/email/delivery";

const eventSchema = z.object({
  type: z.string(),
  data: z.object({ email_id: z.string() }).passthrough(),
});

// Resend webhook: delivered / bounced / complained → EmailLog + Invitation (Spec §4.2).
export async function POST(req: Request) {
  const secret = env().RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  const body = await req.text();
  const ok = await verifySvix(
    secret,
    {
      id: req.headers.get("svix-id"),
      timestamp: req.headers.get("svix-timestamp"),
      signature: req.headers.get("svix-signature"),
    },
    body,
  );
  if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  const parsed = eventSchema.safeParse(JSON.parse(body));
  if (!parsed.success) return NextResponse.json({ ok: true, ignored: true });
  const status = RESEND_EVENT_STATUS[parsed.data.type];
  if (!status) return NextResponse.json({ ok: true, ignored: true });
  await recordDeliveryEvent({ providerId: parsed.data.data.email_id }, status);
  return NextResponse.json({ ok: true });
}
