/**
 * §7.7 — one vocabulary, one queue ("Unresolved time"), one effect on approval.
 */
export const TIME_FLAGS = [
  "MISSING_CLOCK_OUT",
  "MISSING_CLOCK_IN",
  "BREAK_MISSED",
  "OFFLINE_QUEUED",
  "GEO_UNCERTAIN",
  "GEO_OUTSIDE",
  "OFFSITE",
  "UNSCHEDULED",
  "LATE",
  "EARLY_LEAVE",
] as const;
export type TimeFlag = (typeof TIME_FLAGS)[number];

/** Flags that block timesheet approval until a human resolves them. */
export const BLOCKING_FLAGS: ReadonlySet<TimeFlag> = new Set(["MISSING_CLOCK_OUT", "MISSING_CLOCK_IN", "BREAK_MISSED", "OFFLINE_QUEUED"]);

export function isBlocking(flag: TimeFlag): boolean {
  return BLOCKING_FLAGS.has(flag);
}
