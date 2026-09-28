// In-process background jobs: flush batched notifications every minute (§9.1).
// No extra infrastructure; an external cron can also POST /api/cron/notifications.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.DISABLE_BACKGROUND_JOBS === "1") return;
  const { flushAllDueNotifications, raiseAllMissingClockOuts } = await import("@/server/platform/notifications");
  const g = globalThis as unknown as { __notifyTimer?: ReturnType<typeof setInterval> };
  if (g.__notifyTimer) return;
  g.__notifyTimer = setInterval(() => {
    flushAllDueNotifications().catch((err) => console.error("[notifications] flush failed", err));
    raiseAllMissingClockOuts().catch((err) => console.error("[clock] missing clock-out sweep failed", err));
  }, 60_000);
}
