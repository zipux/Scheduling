import { Resend } from "resend";
import { rawDb } from "@/server/db/client";
import { env } from "@/lib/env";

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  template: string;
  businessId?: string | null;
}

/**
 * Sends an email and records it in EmailLog. Without RESEND_API_KEY (Spec rule 4)
 * the email is only logged to the database and console and can be read at
 * /dev/emails in development.
 */
export async function sendEmail(msg: OutgoingEmail): Promise<{ id: string; status: "sent" | "failed" }> {
  const e = env();
  const log = await rawDb.emailLog.create({
    data: {
      businessId: msg.businessId ?? null,
      to: msg.to,
      subject: msg.subject,
      template: msg.template,
      html: msg.html,
      text: msg.text,
      status: "queued",
    },
  });

  if (!e.RESEND_API_KEY) {
    console.info(`[email:dev] to=${msg.to} subject="${msg.subject}" → /dev/emails/${log.id}`);
    await rawDb.emailLog.update({ where: { id: log.id }, data: { status: "sent" } });
    return { id: log.id, status: "sent" };
  }

  try {
    const resend = new Resend(e.RESEND_API_KEY);
    const res = await resend.emails.send({
      from: e.EMAIL_FROM,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      tags: [{ name: "template", value: msg.template.replace(/[^a-zA-Z0-9_-]/g, "_") }],
    });
    if (res.error) throw new Error(res.error.message);
    await rawDb.emailLog.update({
      where: { id: log.id },
      data: { status: "sent", providerId: res.data?.id ?? null },
    });
    return { id: log.id, status: "sent" };
  } catch (err) {
    await rawDb.emailLog.update({
      where: { id: log.id },
      data: { status: "bounced", error: err instanceof Error ? err.message : String(err) },
    });
    return { id: log.id, status: "failed" };
  }
}
