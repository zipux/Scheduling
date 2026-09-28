/**
 * Worked time for one entry (§7.6.3): actual break punches are authoritative.
 * `Shift.breakMinutes` is a planning figure and is never used here.
 * All durations are integer SECONDS to keep arithmetic exact.
 */

export interface BreakInput {
  startsAt: Date;
  endsAt: Date | null;
  /** A missed break resolved as "pay it" is recorded as paid and never deducted. */
  paid?: boolean;
}

export interface EntryTimes {
  clockIn: Date | null;
  clockOut: Date | null;
  /** Rounded times are used for pay when rounding is on; raw times are always kept. */
  clockInRounded?: Date | null;
  clockOutRounded?: Date | null;
  breaks: BreakInput[];
}

const sec = (ms: number) => Math.round(ms / 1000);

/** Start/end used for pay, or null when the entry is incomplete (not payable). */
export function payableSpan(e: EntryTimes): { start: Date; end: Date } | null {
  const start = e.clockInRounded ?? e.clockIn;
  const end = e.clockOutRounded ?? e.clockOut;
  if (!start || !end || end <= start) return null;
  return { start, end };
}

/** Unpaid break seconds inside the span (breaks clipped to the entry; open breaks end at clock-out). */
export function unpaidBreakSeconds(e: EntryTimes): number {
  const span = payableSpan(e);
  if (!span) return 0;
  let total = 0;
  for (const b of e.breaks) {
    if (b.paid) continue;
    const s = Math.max(b.startsAt.getTime(), span.start.getTime());
    const end = Math.min((b.endsAt ?? span.end).getTime(), span.end.getTime());
    if (end > s) total += sec(end - s);
  }
  return total;
}

/** Elapsed real time (DST-correct: instants, not wall-clock arithmetic) minus unpaid breaks. */
export function workedSeconds(e: EntryTimes): number | null {
  const span = payableSpan(e);
  if (!span) return null;
  return Math.max(0, sec(span.end.getTime() - span.start.getTime()) - unpaidBreakSeconds(e));
}
