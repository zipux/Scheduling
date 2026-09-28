import { describe, expect, it } from "vitest";
import { evaluateGeofence, isEarlyLeave, isLate, isMissingClockOut, matchShiftForClockIn, offlineSkewOk, roundPunch, type GeofenceInput } from "@/lib/clock";

const center = { lat: 43.65, lng: -79.38 };
const loc = (mode: "required" | "warn" | "off", radiusM = 80): GeofenceInput["location"] => ({ mode, ...center, radiusM });
const at = (metresNorth: number, accuracy = 10) => ({ lat: center.lat + metresNorth / 111_195, lng: center.lng, accuracy });

describe("geofence (§7.2)", () => {
  it("inside: accepted, no flags", () => expect(evaluateGeofence({ source: "personal", location: loc("required"), override: null, position: at(30) })).toMatchObject({ accept: true, flags: [] }));
  it("outside + required: refused", () => expect(evaluateGeofence({ source: "personal", location: loc("required"), override: null, position: at(200) })).toMatchObject({ accept: false, refuseReason: "OUTSIDE" }));
  it("outside + warn: accepted, GEO_OUTSIDE", () => expect(evaluateGeofence({ source: "personal", location: loc("warn"), override: null, position: at(200) })).toMatchObject({ accept: true, flags: ["GEO_OUTSIDE"] }));
  it("basement kitchen: 120 m accuracy against an 80 m radius is ACCEPTED and flagged, never refused", () => {
    expect(evaluateGeofence({ source: "personal", location: loc("required"), override: null, position: at(20, 120) })).toMatchObject({ accept: true, flags: ["GEO_UNCERTAIN"] });
    // …even if the (inaccurate) point is outside
    expect(evaluateGeofence({ source: "personal", location: loc("required"), override: null, position: at(150, 120) })).toMatchObject({ accept: true, flags: ["GEO_UNCERTAIN"] });
  });
  it("no position: refused when required, flagged otherwise", () => {
    expect(evaluateGeofence({ source: "personal", location: loc("required"), override: null, position: null })).toMatchObject({ accept: false, refuseReason: "NO_POSITION" });
    expect(evaluateGeofence({ source: "personal", location: loc("warn"), override: null, position: null })).toMatchObject({ accept: true, flags: ["GEO_UNCERTAIN"] });
  });
  it("mode off, or a location without a centre: accepted", () => {
    expect(evaluateGeofence({ source: "personal", location: loc("off"), override: null, position: null })).toMatchObject({ accept: true, flags: [] });
    expect(evaluateGeofence({ source: "personal", location: { mode: "required", lat: null, lng: null, radiusM: 80 }, override: null, position: null }).accept).toBe(true);
  });
  it("kiosk skips GPS entirely", () => expect(evaluateGeofence({ source: "kiosk", location: loc("required"), override: null, position: null })).toEqual({ accept: true, flags: [] }));
  it("shift override off: OFFSITE, accepted anywhere", () =>
    expect(evaluateGeofence({ source: "personal", location: loc("required"), override: { mode: "off" }, position: at(5000) })).toEqual({ accept: true, flags: ["OFFSITE"] }));
  it("shift override custom: checked against the temporary fence, flagged OFFSITE", () => {
    const override = { mode: "custom" as const, lat: 44, lng: -79.38, radiusM: 100 };
    const there = { lat: 44.0003, lng: -79.38, accuracy: 10 };
    expect(evaluateGeofence({ source: "personal", location: loc("required"), override, position: there })).toMatchObject({ accept: true, flags: ["OFFSITE"] });
    expect(evaluateGeofence({ source: "personal", location: loc("required"), override, position: at(0) })).toMatchObject({ accept: false, flags: ["OFFSITE"] });
  });
});

describe("rounding (§7.3)", () => {
  const t = new Date("2026-10-05T17:07:30Z");
  it("none keeps the raw time", () => expect(roundPunch(t, "in", "none", 15)).toEqual(t));
  it("employee favour: in rounds down, out rounds up", () => {
    expect(roundPunch(t, "in", "employee_favour", 15).toISOString()).toBe("2026-10-05T17:00:00.000Z");
    expect(roundPunch(t, "out", "employee_favour", 15).toISOString()).toBe("2026-10-05T17:15:00.000Z");
  });
  it("nearest", () => {
    expect(roundPunch(t, "in", "nearest", 15).toISOString()).toBe("2026-10-05T17:15:00.000Z");
    expect(roundPunch(new Date("2026-10-05T17:07:00Z"), "out", "nearest", 15).toISOString()).toBe("2026-10-05T17:00:00.000Z");
  });
});

describe("matching a clock-in to the schedule", () => {
  const shift = { id: "s", startsAt: new Date("2026-10-05T21:00:00Z"), endsAt: new Date("2026-10-06T03:00:00Z"), locationId: "l", positionId: null, geofenceOverride: null };
  it("within the early window → the shift", () => expect(matchShiftForClockIn([shift], new Date("2026-10-05T20:52:00Z"), 10).kind).toBe("shift"));
  it("before the window → too early, with the allowed time", () => {
    const m = matchShiftForClockIn([shift], new Date("2026-10-05T20:30:00Z"), 10);
    expect(m.kind).toBe("too_early");
    if (m.kind === "too_early") expect(m.allowedFrom.toISOString()).toBe("2026-10-05T20:50:00.000Z");
  });
  it("during the shift → the shift", () => expect(matchShiftForClockIn([shift], new Date("2026-10-06T01:00:00Z"), 10).kind).toBe("shift"));
  it("no shift nearby → unscheduled", () => expect(matchShiftForClockIn([shift], new Date("2026-10-04T12:00:00Z"), 10).kind).toBe("unscheduled"));
  it("late and early-leave tolerance", () => {
    expect(isLate(new Date("2026-10-05T21:05:00Z"), shift, 5)).toBe(false);
    expect(isLate(new Date("2026-10-05T21:06:00Z"), shift, 5)).toBe(true);
    expect(isEarlyLeave(new Date("2026-10-06T02:54:00Z"), shift, 5)).toBe(true);
    expect(isEarlyLeave(new Date("2026-10-06T02:56:00Z"), shift, 5)).toBe(false);
  });
});

describe("missing clock-out and offline skew", () => {
  it("flags an entry open longer than maxShiftHours — without inventing an end", () => {
    const e = { clockIn: new Date("2026-10-05T21:00:00Z"), clockOut: null };
    expect(isMissingClockOut(e, new Date("2026-10-06T12:59:00Z"), 16)).toBe(false);
    expect(isMissingClockOut(e, new Date("2026-10-06T13:01:00Z"), 16)).toBe(true);
    expect(e.clockOut).toBeNull();
  });
  it("rejects offline device times too far in the future", () => {
    const server = new Date("2026-10-05T12:00:00Z");
    expect(offlineSkewOk(new Date("2026-10-05T12:30:00Z"), server, 30)).toBe(true);
    expect(offlineSkewOk(new Date("2026-10-05T12:31:00Z"), server, 30)).toBe(false);
    expect(offlineSkewOk(new Date("2026-10-05T08:00:00Z"), server, 30)).toBe(true);
  });
});
