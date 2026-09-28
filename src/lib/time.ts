import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * Timezone helpers. Everything is stored in UTC and shown in the LOCATION's
 * timezone (§2). Calendar dates are "YYYY-MM-DD" strings ("date keys").
 */

export function dateKeyInTz(d: Date, tz: string): string {
  return formatInTimeZone(d, tz, "yyyy-MM-dd");
}

export function timeInTz(d: Date, tz: string): string {
  return formatInTimeZone(d, tz, "HH:mm");
}

/** Minutes after local midnight. */
export function minutesInTz(d: Date, tz: string): number {
  const [h, m] = timeInTz(d, tz).split(":").map(Number);
  return h * 60 + m;
}

/** Local wall-clock date + time in `tz` → UTC instant (DST-aware). */
export function localToUtc(dateKey: string, time: string, tz: string): Date {
  return fromZonedTime(`${dateKey}T${time}:00`, tz);
}

export function addDaysKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a calendar date. */
export function weekdayOfKey(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

/** Monday of the week containing dateKey. */
export function weekStartKey(dateKey: string): string {
  return addDaysKey(dateKey, -((weekdayOfKey(dateKey) + 6) % 7));
}

export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysKey(weekStart, i));
}

export function isDateKey(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
}

/**
 * Local shift times → UTC. An end time at or before the start means the shift
 * ends the next day (overnight close).
 */
export function shiftInstants(dateKey: string, start: string, end: string, tz: string) {
  const startsAt = localToUtc(dateKey, start, tz);
  const endDate = end <= start ? addDaysKey(dateKey, 1) : dateKey;
  const endsAt = localToUtc(endDate, end, tz);
  return { startsAt, endsAt };
}

export function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000;
}

/** Whole years between a date of birth and a calendar date. */
export function ageOn(dob: string, dateKey: string): number {
  const [by, bm, bd] = dob.split("-").map(Number);
  const [y, m, d] = dateKey.split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}
