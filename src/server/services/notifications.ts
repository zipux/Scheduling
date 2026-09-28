import "server-only";
import { z } from "zod";
import type { BusinessContext } from "@/server/auth/context";
import { SCHEDULE_CHANGED } from "./schedule-notify";

/** Notification types a person can opt out of by email (§9.1). In-app is always on. */
export const NOTIFICATION_TYPES = ["schedule.changed", "request.pending", "request.reviewed", "announcement", "time.edited", "timesheet.approved"] as const;

/** The bell: everything except schedule batches still waiting to be flushed. */
function visible(ctx: BusinessContext) {
  return { membershipId: ctx.membership.id, NOT: { type: SCHEDULE_CHANGED, flushAfter: { not: null } } };
}

export async function myNotifications(ctx: BusinessContext, take = 30) {
  return ctx.db.notification.findMany({ where: visible(ctx), orderBy: { createdAt: "desc" }, take });
}

export async function unreadNotificationCount(ctx: BusinessContext) {
  return ctx.db.notification.count({ where: { ...visible(ctx), readAt: null } });
}

export async function markNotificationsRead(ctx: BusinessContext, ids: string[] | "all") {
  await ctx.db.notification.updateMany({
    where: { ...visible(ctx), readAt: null, ...(ids === "all" ? {} : { id: { in: ids } }) },
    data: { readAt: new Date() },
  });
}

export async function myPreferences(ctx: BusinessContext) {
  const rows = await ctx.db.notificationPreference.findMany({ where: { membershipId: ctx.membership.id } });
  return NOTIFICATION_TYPES.map((type) => ({ type, email: rows.find((r) => r.type === type)?.email ?? true }));
}

export const preferenceSchema = z.object({ type: z.enum(NOTIFICATION_TYPES), email: z.boolean() });

export async function setPreference(ctx: BusinessContext, input: z.infer<typeof preferenceSchema>) {
  await ctx.db.notificationPreference.upsert({
    where: { membershipId_type: { membershipId: ctx.membership.id, type: input.type } },
    create: { membershipId: ctx.membership.id, type: input.type, email: input.email } as never,
    update: { email: input.email },
  });
}
