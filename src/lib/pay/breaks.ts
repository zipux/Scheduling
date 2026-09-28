import { payableSpan, type EntryTimes } from "./hours";

/**
 * BreakRule (§7.6.3): after N consecutive hours of work, a break of M minutes is
 * required. Work may not run longer than N hours in a row without a break of at
 * least M minutes; shorter breaks don't reset the count.
 */
export interface BreakRuleInput {
  id?: string;
  afterHours: number;
  breakMinutes: number;
}

export interface BreakViolation {
  rule: BreakRuleInput;
  /** Longest uninterrupted stretch, in seconds. */
  longestStretchSeconds: number;
}

export function breakViolations(e: EntryTimes, rules: BreakRuleInput[]): BreakViolation[] {
  const span = payableSpan(e);
  if (!span) return [];
  const out: BreakViolation[] = [];
  for (const rule of rules) {
    const minBreakMs = rule.breakMinutes * 60_000;
    const qualifying = e.breaks
      .map((b) => ({ s: Math.max(b.startsAt.getTime(), span.start.getTime()), e: Math.min((b.endsAt ?? span.end).getTime(), span.end.getTime()) }))
      .filter((b) => b.e - b.s >= minBreakMs)
      .sort((a, b) => a.s - b.s);
    let cursor = span.start.getTime();
    let longest = 0;
    for (const b of qualifying) {
      longest = Math.max(longest, b.s - cursor);
      cursor = Math.max(cursor, b.e);
    }
    longest = Math.max(longest, span.end.getTime() - cursor);
    if (longest > rule.afterHours * 3_600_000) out.push({ rule, longestStretchSeconds: Math.round(longest / 1000) });
  }
  return out;
}
