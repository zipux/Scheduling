import { distanceM, type LatLng } from "./geo";

/**
 * Pure time-clock rules (§7.1–§7.3). No I/O.
 */

export type GeofenceMode = "required" | "warn" | "off";
export type GeoFlag = "GEO_UNCERTAIN" | "GEO_OUTSIDE" | "OFFSITE";
export type GeofenceOverride = { mode: "off" } | { mode: "custom"; lat: number; lng: number; radiusM: number } | null;

export interface PunchPosition {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface GeofenceInput {
  source: "personal" | "kiosk" | "offline";
  location: { mode: GeofenceMode; lat: number | null; lng: number | null; radiusM: number };
  override: GeofenceOverride;
  position: PunchPosition | null;
}

export interface GeofenceResult {
  accept: boolean;
  flags: GeoFlag[];
  refuseReason?: "NO_POSITION" | "OUTSIDE";
  distanceM?: number;
}

/**
 * The server's geofence verdict. Never trusts a client "inside" flag — only the
 * raw position. Poor accuracy accepts and flags, it never refuses (§7.2).
 */
export function evaluateGeofence(i: GeofenceInput): GeofenceResult {
  // Kiosk devices are registered to the location; no GPS.
  if (i.source === "kiosk") return { accept: true, flags: [] };

  const flags: GeoFlag[] = [];
  let fence: { center: LatLng | null; radiusM: number; mode: GeofenceMode };
  if (i.override?.mode === "off") return { accept: true, flags: ["OFFSITE"] };
  if (i.override?.mode === "custom") {
    flags.push("OFFSITE");
    // A custom fence is enforced with the location's mode (off → warn, so it still records).
    fence = { center: { lat: i.override.lat, lng: i.override.lng }, radiusM: i.override.radiusM, mode: i.location.mode === "off" ? "warn" : i.location.mode };
  } else {
    fence = { center: i.location.lat !== null && i.location.lng !== null ? { lat: i.location.lat, lng: i.location.lng } : null, radiusM: i.location.radiusM, mode: i.location.mode };
  }
  if (fence.mode === "off" || !fence.center) return { accept: true, flags };

  if (!i.position) {
    if (fence.mode === "required") return { accept: false, flags, refuseReason: "NO_POSITION" };
    return { accept: true, flags: [...flags, "GEO_UNCERTAIN"] };
  }
  const d = distanceM(fence.center, i.position);
  if (i.position.accuracy > fence.radiusM) return { accept: true, flags: [...flags, "GEO_UNCERTAIN"], distanceM: d };
  if (d <= fence.radiusM) return { accept: true, flags, distanceM: d };
  if (fence.mode === "required") return { accept: false, flags, refuseReason: "OUTSIDE", distanceM: d };
  return { accept: true, flags: [...flags, "GEO_OUTSIDE"], distanceM: d };
}

export type RoundingMode = "none" | "employee_favour" | "nearest";

/**
 * §7.3 rounding. `employee_favour`: clock-in rounds DOWN, clock-out rounds UP.
 * `nearest`: true nearest interval (ties round up). The raw time is always kept
 * by the caller alongside the rounded one.
 */
export function roundPunch(t: Date, kind: "in" | "out", mode: RoundingMode, intervalMinutes: number): Date {
  if (mode === "none" || intervalMinutes <= 0) return t;
  const step = intervalMinutes * 60_000;
  const ms = t.getTime();
  if (mode === "nearest") return new Date(Math.round(ms / step) * step);
  return new Date(kind === "in" ? Math.floor(ms / step) * step : Math.ceil(ms / step) * step);
}

export interface ShiftCandidate {
  id: string;
  startsAt: Date;
  endsAt: Date;
  locationId: string;
  positionId: string | null;
  geofenceOverride: GeofenceOverride;
}

export type ShiftMatch =
  | { kind: "shift"; shift: ShiftCandidate }
  | { kind: "too_early"; shift: ShiftCandidate; allowedFrom: Date }
  | { kind: "unscheduled" };

/**
 * Which scheduled shift does a clock-in at `now` belong to? The current shift,
 * or the next one if within the early clock-in window. A shift starting later
 * today but outside the window is "too early" (§7.3).
 */
export function matchShiftForClockIn(shifts: ShiftCandidate[], now: Date, earlyMinutes: number, lookaheadHours = 12): ShiftMatch {
  const sorted = [...shifts].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const current = sorted.find((s) => s.startsAt.getTime() - earlyMinutes * 60_000 <= now.getTime() && now < s.endsAt);
  if (current) return { kind: "shift", shift: current };
  const next = sorted.find((s) => s.startsAt > now && s.startsAt.getTime() - now.getTime() <= lookaheadHours * 3600_000);
  if (next) return { kind: "too_early", shift: next, allowedFrom: new Date(next.startsAt.getTime() - earlyMinutes * 60_000) };
  return { kind: "unscheduled" };
}

export function isLate(clockIn: Date, shift: { startsAt: Date }, toleranceMinutes: number) {
  return clockIn.getTime() > shift.startsAt.getTime() + toleranceMinutes * 60_000;
}

export function isEarlyLeave(clockOut: Date, shift: { endsAt: Date }, toleranceMinutes: number) {
  return clockOut.getTime() < shift.endsAt.getTime() - toleranceMinutes * 60_000;
}

/** §7.3: an entry still open this long after clock-in is a missing clock-out. */
export function isMissingClockOut(entry: { clockIn: Date | null; clockOut: Date | null }, now: Date, maxShiftHours: number) {
  return !!entry.clockIn && !entry.clockOut && now.getTime() - entry.clockIn.getTime() > maxShiftHours * 3600_000;
}

/** §7.1: offline punches may not claim a device time too far ahead of the server. */
export function offlineSkewOk(deviceTime: Date, serverTime: Date, maxSkewMinutes: number) {
  return deviceTime.getTime() - serverTime.getTime() <= maxSkewMinutes * 60_000;
}

export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 5;
