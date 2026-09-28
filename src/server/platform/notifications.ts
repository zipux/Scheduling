import "server-only";
import { rawDb } from "@/server/db/client";
import { flushBusinessNotifications } from "@/server/services/schedule-notify";
import { sendEmail } from "@/server/email/send";
import { notificationEmail } from "@/server/email/templates";
import { env } from "@/lib/env";

/**
 * Flushes every business's due notifications and emails them, unless the person
 * opted out of email for that type. Runs from the in-process scheduler
 * (instrumentation.ts) and from /api/cron/notifications.
 */
export async function flushAllDueNotifications(now = new Date()) {
  const due = await rawDb.notification.findMany({
    where: { flushAfter: { lte: now } },
    distinct: ["businessId"],
    select: { businessId: true },
  });
  let sent = 0;
  for (const { businessId } of due) {
    const messages = await flushBusinessNotifications(businessId, now);
    for (const m of messages) {
      const membership = await rawDb.membership.findFirst({
        where: { id: m.membershipId, businessId, status: "active", accessRevokedAt: null },
        include: { user: { select: { email: true } } },
      });
      if (!membership) continue;
      const pref = await rawDb.notificationPreference.findUnique({
        where: { membershipId_type: { membershipId: m.membershipId, type: "schedule.changed" } },
      });
      if (pref && !pref.email) continue;
      const tpl = await notificationEmail({ title: m.title, body: m.body, url: `${env().APP_URL}/b/${businessId}/schedule?view=mine` });
      await sendEmail({ to: membership.user.email, template: "schedule-changed", businessId, ...tpl });
      await rawDb.notification.update({ where: { id: m.notificationId }, data: { emailedAt: new Date() } });
      sent++;
    }
  }
  return { businesses: due.length, sent };
}
