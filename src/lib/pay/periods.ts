import { formatInTimeZone } from "date-fns-tz";
import { addDaysKey, localToUtc } from "../time";

/**
 * Pay periods and work-days (§7.6.1).
 *
 * 1. A time entry belongs, whole and undivided, to the work-day containing its
 *    clock-in. It is never split at midnight.
 * 2. `workDayStart` (default 04:00 local) is the work-day boundary, so a
 *    21:00–02:10 close counts entirely as the day it started.
 * 3. The same rule decides the pay period: the entry belongs to the period
 *    containing its work-day. Periods are whole work-days, so a period ends at
 *    workDayStart on the day after its last date (`periodEndsAt`).
 */

export type Frequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

export interface Period {
  start: string; // first work-day, YYYY-MM-DD
  end: string; // last work-day (inclusive)
}

/** Fallback anchor (a Monday) when a weekly/biweekly business has none set. */
export const DEFAULT_ANCHOR = "2024-01-01";

const dayNumber = (key: string) => Math.round(new Date(`${key}T00:00:00Z`).getTime() / 86_400_000);
const floorMod = (a: number, n: number) => ((a % n) + n) % n;

export function daysBetween(a: string, b: string) {
  return dayNumber(b) - dayNumber(a);
}

/** The work-day (YYYY-MM-DD) a clock-in belongs to, in the entry location's timezone. */
export function workDayOf(clockIn: Date, tz: string, workDayStartMinutes: number): string {
  const local = formatInTimeZone(clockIn, tz, "yyyy-MM-dd HH:mm");
  const [date, time] = local.split(" ");
  const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  return minutes < workDayStartMinutes ? addDaysKey(date, -1) : date;
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate(); // month is 1-based here
}

export function periodContaining(frequency: Frequency, anchor: string | null, day: string): Period {
  const a = anchor ?? DEFAULT_ANCHOR;
  if (frequency === "weekly" || frequency === "biweekly") {
    const len = frequency === "weekly" ? 7 : 14;
    const start = addDaysKey(day, -floorMod(daysBetween(a, day), len));
    return { start, end: addDaysKey(start, len - 1) };
  }
  const [y, m, d] = day.split("-").map(Number);
  const mm = String(m).padStart(2, "0");
  const last = lastDayOfMonth(y, m);
  if (frequency === "monthly") return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, "0")}` };
  return d <= 15 ? { start: `${y}-${mm}-01`, end: `${y}-${mm}-15` } : { start: `${y}-${mm}-16`, end: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

/**
 * The instant a period ends: `workDayStart` on the day AFTER its last date, not
 * midnight — until then a clock-in (e.g. 01:00 Monday) can still join its last
 * work-day. With several location timezones the period ends at the latest of them.
 */
export function periodEndsAt(p: Period, timezones: string[], workDayStartMinutes: number): Date {
  const hhmm = `${String(Math.floor(workDayStartMinutes / 60)).padStart(2, "0")}:${String(workDayStartMinutes % 60).padStart(2, "0")}`;
  const next = addDaysKey(p.end, 1);
  return new Date(Math.max(...timezones.map((tz) => localToUtc(next, hhmm, tz).getTime())));
}

/** A period can be approved only once it has ended, so no later clock-in can land in it. */
export function periodHasEnded(p: Period, now: Date, timezones: string[], workDayStartMinutes: number): boolean {
  return now.getTime() >= periodEndsAt(p, timezones, workDayStartMinutes).getTime();
}

export function periodDays(p: Period): string[] {
  const n = daysBetween(p.start, p.end) + 1;
  return Array.from({ length: n }, (_, i) => addDaysKey(p.start, i));
}

export function inPeriod(p: Period, day: string) {
  return day >= p.start && day <= p.end;
}

/**
 * Overtime weeks inside a period. For weekly and bi-weekly periods these are the
 * 7-day blocks the period is made of. For semi-monthly and monthly periods the
 * spec does not say which week weekly overtime uses (weeks straddle periods), so
 * this returns null and the calculator refuses to guess (WEEK_UNDEFINED). Those
 * frequencies are no longer offered; this stays as a guard for existing data.
 */
export function overtimeWeeks(frequency: Frequency, p: Period): Period[] | null {
  if (frequency !== "weekly" && frequency !== "biweekly") return null;
  const weeks: Period[] = [];
  for (let s = p.start; s <= p.end; s = addDaysKey(s, 7)) weeks.push({ start: s, end: addDaysKey(s, 6) });
  return weeks;
}

export function periodsPerYear(frequency: Frequency) {
  return { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 }[frequency];
}
