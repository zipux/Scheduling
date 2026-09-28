import "server-only";
import type { TenantDb } from "@/server/db/tenant";
import { breakViolations } from "@/lib/pay/breaks";

/**
 * §7.6.3: where a BreakRule isn't satisfied, raise BREAK_MISSED on the entry and
 * notify managers. Returns the violations found. Run after clock-out and after
 * any edit of a completed entry.
 */
export async function checkBreaks(db: TenantDb, entryId: string, opts: { notify?: (membershipId: string) => Promise<void> } = {}) {
  const e = await db.timeEntry.findUnique({ where: { id: entryId }, include: { breaks: true, flags: true } });
  if (!e || !e.clockIn || !e.clockOut) return [];
  const rules = await db.breakRule.findMany();
  const violations = breakViolations(
    { clockIn: e.clockIn, clockOut: e.clockOut, clockInRounded: e.clockInRounded, clockOutRounded: e.clockOutRounded, breaks: e.breaks },
    rules.map((r) => ({ id: r.id, afterHours: Number(r.afterHours), breakMinutes: r.breakMinutes })),
  );
  const open = e.flags.find((f) => f.type === "BREAK_MISSED" && !f.resolvedAt);
  if (violations.length && !open) {
    await db.timeEntryFlag.create({
      data: {
        timeEntryId: e.id,
        type: "BREAK_MISSED",
        detail: violations.map((v) => ({ afterHours: v.rule.afterHours, breakMinutes: v.rule.breakMinutes, longestStretchSeconds: v.longestStretchSeconds })),
      } as never,
    });
    await opts.notify?.(e.membershipId);
  }
  return violations;
}
