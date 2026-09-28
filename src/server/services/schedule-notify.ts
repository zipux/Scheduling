import "server-only";
import type { TenantDb } from "@/server/db/tenant";
import { tenantDb } from "@/server/db/tenant";
import { diffShift, summarizeWeek, type ShiftChange, type ShiftView } from "@/lib/shift-diff";
import { dateKeyInTz, weekStartKey } from "@/lib/time";
import { formatInTimeZone } from "date-fns-tz";

/**
 * Schedule-change notifications (§9.1).
 *
 * Every change to what an employee can see (a publish, or an edit to a published
 * shift) is queued per employee per week. The queue entry remembers what the
 * employee last saw for each shift ("before") the first time that shift changes.
 * After a quiet period (default 10 min) it is flushed into ONE message with a
 * before → after diff. Changes that cancel out produce no message at all.
 */

export const NOTIFY_DEBOUNCE_MINUTES = 10;
export const SCHEDULE_CHANGED = "schedule.changed";

type ShiftRow = {
  id: string;
  membershipId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: string;
  deletedAt: Date | null;
  location: { name: string; timezone: string };
  position: { name: string } | null;
};

const SHIFT_INCLUDE = { location: { select: { name: true, timezone: true } }, position: { select: { name: true } } } as const;

export function viewOf(s: ShiftRow): ShiftView {
  return {
    id: s.id,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    locationName: s.location.name,
    positionName: s.position?.name ?? null,
    tz: s.location.timezone,
  };
}

/** What `membershipId` currently sees of this shift (published, not deleted, theirs), or null. */
export function visibleTo(s: ShiftRow | null, membershipId: string): ShiftView | null {
  if (!s || s.deletedAt || s.status !== "published" || s.membershipId !== membershipId) return null;
  return viewOf(s);
}

interface Payload {
  weekStart: string;
  before: Record<string, ShiftView | null>;
  changes?: ShiftChange[];
}

/**
 * Call BEFORE applying a change, with the shift as it currently is (or null for a
 * brand-new shift) and every membership the change can affect.
 */
export async function enqueueScheduleChange(db: TenantDb, shift: ShiftRow | null, shiftId: string, affected: (string | null)[], weekStartDate: string) {
  const people = [...new Set(affected.filter((m): m is string => !!m))];
  const flushAfter = new Date(Date.now() + NOTIFY_DEBOUNCE_MINUTES * 60_000);
  for (const membershipId of people) {
    const batchKey = `sched:${membershipId}:${weekStartDate}`;
    const pending = await db.notification.findFirst({ where: { batchKey, flushAfter: { not: null } } });
    if (pending) {
      const payload = pending.payload as unknown as Payload;
      if (!(shiftId in payload.before)) payload.before[shiftId] = visibleTo(shift, membershipId);
      await db.notification.update({ where: { id: pending.id }, data: { payload: payload as never, flushAfter } });
    } else {
      const payload: Payload = { weekStart: weekStartDate, before: { [shiftId]: visibleTo(shift, membershipId) } };
      await db.notification.create({
        data: { membershipId, type: SCHEDULE_CHANGED, title: "", body: "", batchKey, flushAfter, payload: payload as never } as never,
      });
    }
  }
}

export function weekOfShift(s: { startsAt: Date }, tz: string) {
  return weekStartKey(dateKeyInTz(s.startsAt, tz));
}

/** Loads a shift in the shape the notifier needs. */
export function loadShiftForNotify(db: TenantDb, id: string) {
  return db.shift.findUnique({ where: { id }, include: SHIFT_INCLUDE });
}

/**
 * Flushes one business's due notifications. Returns the messages produced so the
 * caller can email them (email delivery honours preferences in Phase 8).
 */
export async function flushBusinessNotifications(businessId: string, now = new Date()) {
  const db = tenantDb(businessId);
  const due = await db.notification.findMany({ where: { type: SCHEDULE_CHANGED, flushAfter: { lte: now } } });
  const out: { notificationId: string; membershipId: string; title: string; body: string }[] = [];
  for (const n of due) {
    const payload = n.payload as unknown as Payload;
    const ids = Object.keys(payload.before);
    const current = await db.shift.findMany({ where: { id: { in: ids } }, include: SHIFT_INCLUDE });
    const changes: ShiftChange[] = [];
    for (const id of ids) {
      const c = diffShift(payload.before[id], visibleTo(current.find((s) => s.id === id) ?? null, n.membershipId));
      if (c) changes.push(c);
    }
    if (!changes.length) {
      await db.notification.delete({ where: { id: n.id } });
      continue;
    }
    changes.sort((a, b) => {
      const at = (c: ShiftChange) => (c.kind === "removed" ? c.before.startsAt : c.after.startsAt);
      return at(a).localeCompare(at(b));
    });
    const tz = (changes[0].kind === "removed" ? changes[0].before : changes[0].after).tz;
    const label = formatInTimeZone(new Date(`${payload.weekStart}T12:00:00Z`), tz, "d MMM");
    const body = summarizeWeek(label, changes);
    const title = `Your schedule for the week of ${label} changed`;
    await db.notification.update({
      where: { id: n.id },
      data: { title, body, flushAfter: null, payload: { ...payload, changes } as never },
    });
    out.push({ notificationId: n.id, membershipId: n.membershipId, title, body });
  }
  return out;
}
