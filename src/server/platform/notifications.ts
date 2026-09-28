import "server-only";
import { rawDb } from "@/server/db/client";
import { flushBusinessNotifications } from "@/server/services/schedule-notify";
import { sendEmail } from "@/server/email/send";
import { notificationEmail } from "@/server/email/templates";
import { env } from "@/lib/env";
import { raiseMissingClockOuts } from "@/server/services/clock";

/** §7.3: flag entries open past maxShiftHours in every business, and notify immediately. */
export async function raiseAllMissingClockOuts() {
  const open = await rawDb.timeEntry.findMany({ where: { clockOut: null, NOT: { clockIn: null } }, distinct: ["businessId"], select: { businessId: true } });
  for (const { businessId } of open) await raiseMissingClockOuts(businessId);
}

/**
 * Flushes every business's due notifications and emails them, unless the person
 * opted out of email for that type. Runs from the in-process scheduler
 * (instrumentation.ts) and from /api/cron/notifications.
 */
export async function flushAllDueNotifications(now = new Date()) {
  const due = await rawDb.notification.findMany({
    where: { flushAfter: { lte: now }, type: "schedule.changed" },
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
  // Non-batched notifications (requests, announcements…): one email each, unless opted out.
  const single = await rawDb.notification.findMany({
    where: { flushAfter: { lte: now }, type: { not: "schedule.changed" }, emailedAt: null },
    take: 500,
    orderBy: { createdAt: "asc" },
  });
  for (const n of single) {
    await rawDb.notification.update({ where: { id: n.id }, data: { flushAfter: null } });
    const membership = await rawDb.membership.findFirst({
      where: { id: n.membershipId, businessId: n.businessId, status: "active", accessRevokedAt: null },
      include: { user: { select: { email: true } } },
    });
    if (!membership) continue;
    const pref = await rawDb.notificationPreference.findUnique({ where: { membershipId_type: { membershipId: n.membershipId, type: n.type } } });
    if (pref && !pref.email) continue;
    const tpl = await notificationEmail({ title: n.title, body: n.body, url: `${env().APP_URL}/b/${n.businessId}` });
    await sendEmail({ to: membership.user.email, template: n.type, businessId: n.businessId, ...tpl });
    await rawDb.notification.update({ where: { id: n.id }, data: { emailedAt: new Date() } });
    sent++;
  }
  return { businesses: due.length, sent };
}
