import { ageOn, dateKeyInTz } from "./time";

/**
 * §6.0 — ONE predicate, used identically by pickup, swap and direct assignment.
 *
 * It checks: matching position; matching location (or locations.scope_all);
 * requiresMinimumAge satisfied; no overlapping shift for that person; no approved
 * time off covering it. For trades, a failure blocks. For a manager's direct
 * assignment it is informational (scheduling warnings stay warnings).
 */

export type IneligibleReason = "INACTIVE" | "POSITION" | "LOCATION" | "AGE" | "OVERLAP" | "TIME_OFF";

export interface EligibilityCandidate {
  membershipId: string;
  active: boolean;
  positionIds: string[];
  locationIds: string[];
  scopeAll: boolean;
  dob: string | null;
  /** The candidate's other shifts (non-deleted). */
  shifts: { id: string; startsAt: Date; endsAt: Date }[];
  approvedTimeOff: { startsAt: Date; endsAt: Date }[];
}

export interface EligibilityShift {
  id: string;
  positionId: string | null;
  locationId: string;
  startsAt: Date;
  endsAt: Date;
  tz: string;
  requiresMinimumAge: number | null;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: IneligibleReason[];
}

const overlaps = (a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) =>
  a.startsAt < b.endsAt && b.startsAt < a.endsAt;

/**
 * @param ignoreShiftIds shifts to leave out of the overlap check — for a swap, the
 *   shift the candidate is giving away in the same exchange.
 */
export function isEligibleFor(
  candidate: EligibilityCandidate,
  shift: EligibilityShift,
  ignoreShiftIds: string[] = [],
): EligibilityResult {
  const reasons: IneligibleReason[] = [];
  if (!candidate.active) reasons.push("INACTIVE");
  if (shift.positionId && !candidate.positionIds.includes(shift.positionId)) reasons.push("POSITION");
  if (!candidate.scopeAll && !candidate.locationIds.includes(shift.locationId)) reasons.push("LOCATION");
  if (shift.requiresMinimumAge !== null) {
    const age = candidate.dob ? ageOn(candidate.dob, dateKeyInTz(shift.startsAt, shift.tz)) : null;
    // Unknown age can't be shown to satisfy a minimum-age requirement.
    if (age === null || age < shift.requiresMinimumAge) reasons.push("AGE");
  }
  const ignore = new Set([shift.id, ...ignoreShiftIds]);
  if (candidate.shifts.some((s) => !ignore.has(s.id) && overlaps(s, shift))) reasons.push("OVERLAP");
  if (candidate.approvedTimeOff.some((t) => overlaps(t, shift))) reasons.push("TIME_OFF");
  return { eligible: reasons.length === 0, reasons };
}
