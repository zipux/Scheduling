import { ageOn, dateKeyInTz, hoursBetween, minutesInTz, weekStartKey, weekdayOfKey } from "./time";

/**
 * Scheduling warnings (Spec §5.1). Warnings never block; they are computed from
 * current data every time a shift is shown, so they persist until the underlying
 * problem is resolved or the shift is in the past.
 */

export type WarningType =
  | "UNAVAILABLE"
  | "TIME_OFF"
  | "OVERLAP"
  | "OVERTIME_RISK"
  | "SHORT_REST"
  | "SPLIT_SHIFT"
  | "UNDER_AGE";

export interface ScheduleWarning {
  type: WarningType;
  /** Values for the message template. */
  params: Record<string, string | number>;
}

export interface WShift {
  id: string;
  membershipId: string | null;
  startsAt: Date;
  endsAt: Date;
  breakMinutes: number;
  positionId: string | null;
  tz: string;
}

export interface AvailabilityRuleLite {
  weekday: number;
  kind: "all_day" | "between" | "unavailable";
  startMinutes: number | null;
  endMinutes: number | null;
  effectiveFrom: string; // YYYY-MM-DD
  requestId: string;
}

export interface WarningContext {
  /** Other shifts of the same person (any status, excluding deleted). */
  personShifts: WShift[];
  dob: string | null;
  positionMinAge: number | null;
  approvedTimeOff: { startsAt: Date; endsAt: Date }[];
  /** Approved availability rules for the person. */
  availability: AvailabilityRuleLite[];
  dailyThresholdHours: number | null;
  weeklyThresholdHours: number | null;
  maxSplitShiftSpanHours: number | null;
  minRestHours: number;
}

export const DEFAULT_MIN_REST_HOURS = 8;

export function paidHours(s: Pick<WShift, "startsAt" | "endsAt" | "breakMinutes">): number {
  return Math.max(0, hoursBetween(s.startsAt, s.endsAt) - s.breakMinutes / 60);
}

const overlaps = (a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) =>
  a.startsAt < b.endsAt && b.startsAt < a.endsAt;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The availability rule set in force on a date: the latest approved set effective on or before it. */
export function availabilityOn(rules: AvailabilityRuleLite[], dateKey: string): AvailabilityRuleLite[] {
  const eligible = rules.filter((r) => r.effectiveFrom <= dateKey);
  if (!eligible.length) return [];
  const latest = eligible.reduce((a, b) => (b.effectiveFrom > a.effectiveFrom ? b : a));
  return eligible.filter((r) => r.requestId === latest.requestId);
}

export function computeWarnings(shift: WShift, ctx: WarningContext): ScheduleWarning[] {
  if (!shift.membershipId) return [];
  const out: ScheduleWarning[] = [];
  const day = dateKeyInTz(shift.startsAt, shift.tz);
  const others = ctx.personShifts.filter((s) => s.id !== shift.id && s.membershipId === shift.membershipId);

  // Availability (start day's rule).
  const set = availabilityOn(ctx.availability, day);
  const rule = set.find((r) => r.weekday === weekdayOfKey(day));
  if (rule?.kind === "unavailable") {
    out.push({ type: "UNAVAILABLE", params: { reason: "day" } });
  } else if (rule?.kind === "between" && rule.startMinutes !== null && rule.endMinutes !== null) {
    const start = minutesInTz(shift.startsAt, shift.tz);
    const len = Math.round(hoursBetween(shift.startsAt, shift.endsAt) * 60);
    if (start < rule.startMinutes || start + len > rule.endMinutes) {
      out.push({ type: "UNAVAILABLE", params: { reason: "hours", from: rule.startMinutes, to: rule.endMinutes } });
    }
  }

  if (ctx.approvedTimeOff.some((t) => overlaps(t, shift))) out.push({ type: "TIME_OFF", params: {} });

  const clash = others.find((s) => overlaps(s, shift));
  if (clash) out.push({ type: "OVERLAP", params: { shiftId: clash.id } });

  // Overtime risk — scheduled paid hours on the day and in the Monday-start week.
  const all = [...others, shift];
  if (ctx.dailyThresholdHours !== null) {
    const dayHours = all.filter((s) => dateKeyInTz(s.startsAt, s.tz) === day).reduce((n, s) => n + paidHours(s), 0);
    if (dayHours > ctx.dailyThresholdHours) {
      out.push({ type: "OVERTIME_RISK", params: { scope: "day", hours: round1(dayHours), threshold: ctx.dailyThresholdHours } });
    }
  }
  if (ctx.weeklyThresholdHours !== null) {
    const wk = weekStartKey(day);
    const weekHours = all.filter((s) => weekStartKey(dateKeyInTz(s.startsAt, s.tz)) === wk).reduce((n, s) => n + paidHours(s), 0);
    if (weekHours > ctx.weeklyThresholdHours) {
      out.push({ type: "OVERTIME_RISK", params: { scope: "week", hours: round1(weekHours), threshold: ctx.weeklyThresholdHours } });
    }
  }

  // Short rest between this shift and the nearest non-overlapping neighbours.
  const before = others.filter((s) => s.endsAt <= shift.startsAt).sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime())[0];
  const after = others.filter((s) => s.startsAt >= shift.endsAt).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
  const restBefore = before ? hoursBetween(before.endsAt, shift.startsAt) : Infinity;
  const restAfter = after ? hoursBetween(shift.endsAt, after.startsAt) : Infinity;
  const rest = Math.min(restBefore, restAfter);
  // Two shifts on the same day are a split shift, not a rest problem.
  const neighbour = restBefore <= restAfter ? before : after;
  if (rest < ctx.minRestHours && neighbour && dateKeyInTz(neighbour.startsAt, neighbour.tz) !== day) {
    out.push({ type: "SHORT_REST", params: { hours: round1(rest), minimum: ctx.minRestHours } });
  }

  if (ctx.maxSplitShiftSpanHours !== null) {
    const sameDay = all.filter((s) => dateKeyInTz(s.startsAt, s.tz) === day);
    if (sameDay.length > 1) {
      const first = Math.min(...sameDay.map((s) => s.startsAt.getTime()));
      const last = Math.max(...sameDay.map((s) => s.endsAt.getTime()));
      const span = (last - first) / 3_600_000;
      if (span > ctx.maxSplitShiftSpanHours) {
        out.push({ type: "SPLIT_SHIFT", params: { hours: round1(span), maximum: ctx.maxSplitShiftSpanHours } });
      }
    }
  }

  if (ctx.positionMinAge !== null && ctx.dob) {
    const age = ageOn(ctx.dob, day);
    if (age < ctx.positionMinAge) out.push({ type: "UNDER_AGE", params: { age, minimum: ctx.positionMinAge } });
  }

  return out;
}
