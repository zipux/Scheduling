import { describe, expect, it } from "vitest";
import { locationSchema } from "@/server/services/locations";
import { clockRulesSchema } from "@/server/services/business-settings";
import { positionSchema } from "@/server/services/positions";

const loc = { name: "Main", address: "", timezone: "America/Toronto", lat: "43.6", lng: "-79.4", radiusM: "100", geofenceMode: "required", isTemporary: false };

describe("location schema", () => {
  it("coerces strings from the form", () => {
    const r = locationSchema.parse(loc);
    expect(r.lat).toBe(43.6);
    expect(r.radiusM).toBe(100);
  });
  it("requires a position unless the geofence is off", () => {
    expect(locationSchema.safeParse({ ...loc, lat: "", lng: "" }).success).toBe(false);
    expect(locationSchema.safeParse({ ...loc, lat: "", lng: "", geofenceMode: "off" }).success).toBe(true);
  });
  it("rejects an unknown timezone and silly radii", () => {
    expect(locationSchema.safeParse({ ...loc, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(locationSchema.safeParse({ ...loc, radiusM: "5" }).success).toBe(false);
    expect(locationSchema.safeParse({ ...loc, lat: "91" }).success).toBe(false);
  });
});

describe("clock rules schema", () => {
  const ok = {
    clockModePersonal: true,
    clockModeKiosk: true,
    earlyClockInMinutes: "10",
    allowUnscheduledClockIn: true,
    roundingMode: "none",
    roundingIntervalMinutes: "0",
    lateToleranceMinutes: "5",
    maxShiftHours: "16",
    maxClockSkewMinutes: "30",
  };
  it("accepts the defaults", () => expect(clockRulesSchema.safeParse(ok).success).toBe(true));
  it("needs at least one clock mode", () =>
    expect(clockRulesSchema.safeParse({ ...ok, clockModePersonal: false, clockModeKiosk: false }).success).toBe(false));
  it("rounding needs an interval", () => expect(clockRulesSchema.safeParse({ ...ok, roundingMode: "nearest" }).success).toBe(false));
});

describe("position schema", () => {
  it("blank minimum age means none", () =>
    expect(positionSchema.parse({ name: "Bar", color: "#aabbcc", requiresMinimumAge: "" }).requiresMinimumAge).toBeNull());
  it("rejects a bad colour", () => expect(positionSchema.safeParse({ name: "Bar", color: "red", requiresMinimumAge: "" }).success).toBe(false));
});
