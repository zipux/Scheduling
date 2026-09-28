import { formatInTimeZone } from "date-fns-tz";

/** A shift as the employee sees it, for before → after notifications (§9.1). */
export interface ShiftView {
  id: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  locationName: string;
  positionName: string | null;
  tz: string;
}

export type ShiftChange =
  | { kind: "added"; after: ShiftView }
  | { kind: "removed"; before: ShiftView }
  | { kind: "changed"; before: ShiftView; after: ShiftView };

const fmtDay = (v: ShiftView) => formatInTimeZone(new Date(v.startsAt), v.tz, "EEE d MMM");
const fmtTime = (iso: string, tz: string) => formatInTimeZone(new Date(iso), tz, "HH:mm");
const range = (v: ShiftView) => `${fmtTime(v.startsAt, v.tz)}–${fmtTime(v.endsAt, v.tz)}`;

export function diffShift(before: ShiftView | null, after: ShiftView | null): ShiftChange | null {
  if (!before && !after) return null;
  if (!before) return { kind: "added", after: after! };
  if (!after) return { kind: "removed", before };
  const same =
    before.startsAt === after.startsAt &&
    before.endsAt === after.endsAt &&
    before.locationName === after.locationName &&
    before.positionName === after.positionName;
  return same ? null : { kind: "changed", before, after };
}

/** One line per change, always with the before → after values. */
export function describeChange(c: ShiftChange): string {
  if (c.kind === "added") return `${fmtDay(c.after)} shift added: ${range(c.after)} at ${c.after.locationName}`;
  if (c.kind === "removed") return `${fmtDay(c.before)} shift removed (was ${range(c.before)} at ${c.before.locationName})`;
  const parts: string[] = [];
  const b = c.before;
  const a = c.after;
  if (fmtDay(b) !== fmtDay(a)) parts.push(`moved to ${fmtDay(a)}`);
  if (fmtTime(b.startsAt, b.tz) !== fmtTime(a.startsAt, a.tz)) parts.push(`start ${fmtTime(b.startsAt, b.tz)}→${fmtTime(a.startsAt, a.tz)}`);
  if (fmtTime(b.endsAt, b.tz) !== fmtTime(a.endsAt, a.tz)) parts.push(`end ${fmtTime(b.endsAt, b.tz)}→${fmtTime(a.endsAt, a.tz)}`);
  if (b.locationName !== a.locationName) parts.push(`location ${b.locationName}→${a.locationName}`);
  if (b.positionName !== a.positionName) parts.push(`position ${b.positionName ?? "—"}→${a.positionName ?? "—"}`);
  if (!parts.length) parts.push(`${range(b)}→${range(a)}`);
  return `${fmtDay(b)}: ${parts.join(", ")}`;
}

/** "Your week of 5 Oct changed: Tue 17:00→17:15, Thu shift added." */
export function summarizeWeek(weekStartLabel: string, changes: ShiftChange[]): string {
  return `Your week of ${weekStartLabel} changed: ${changes.map(describeChange).join("; ")}.`;
}
