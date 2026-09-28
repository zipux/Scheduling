import { describe, expect, it } from "vitest";
import { distanceM, recommendGeofence } from "@/lib/geo";
import { wageOn, type WageRow } from "@/lib/wages";

describe("haversine distance", () => {
  it("is zero for the same point", () => expect(distanceM({ lat: 43.65, lng: -79.38 }, { lat: 43.65, lng: -79.38 })).toBe(0));
  it("matches a known distance (Toronto → Vancouver ≈ 3,358 km)", () => {
    const d = distanceM({ lat: 43.6532, lng: -79.3832 }, { lat: 49.2827, lng: -123.1207 });
    expect(d / 1000).toBeGreaterThan(3350);
    expect(d / 1000).toBeLessThan(3365);
  });
  it("one thousandth of a degree of latitude ≈ 111 m", () => {
    expect(distanceM({ lat: 43.65, lng: -79.38 }, { lat: 43.651, lng: -79.38 })).toBeCloseTo(111.2, 0);
  });
});

describe("geofence recommendation", () => {
  const center = { lat: 43.65, lng: -79.38 };
  it("covers the farthest reading plus its accuracy, with 10% margin, rounded up to 10 m", () => {
    // ~55.6 m north with 20 m accuracy → worst 75.6 → ×1.1 = 83.2 → 90
    const r = recommendGeofence([{ lat: 43.6505, lng: -79.38, accuracy: 20 }, { ...center, accuracy: 10 }], center);
    expect(r.radiusM).toBe(90);
  });
  it("uses the mean reading as the centre when none is set", () => {
    const r = recommendGeofence([
      { lat: 43.65, lng: -79.38, accuracy: 5 },
      { lat: 43.6502, lng: -79.38, accuracy: 5 },
    ]);
    expect(r.center.lat).toBeCloseTo(43.6501, 6);
  });
  it("never recommends below 25 m or above 1 km", () => {
    expect(recommendGeofence([{ ...center, accuracy: 1 }], center).radiusM).toBe(25);
    expect(recommendGeofence([{ lat: 44, lng: -79.38, accuracy: 5 }], center).radiusM).toBe(1000);
  });
  it("a basement kitchen with 120 m accuracy gets a radius that includes it", () => {
    expect(recommendGeofence([{ ...center, accuracy: 120 }], center).radiusM).toBe(140);
  });
});

describe("wage resolution (§8)", () => {
  const rows: WageRow[] = [
    { rateCents: 1700, type: "hourly", positionId: null, effectiveFrom: "2026-01-01" },
    { rateCents: 1800, type: "hourly", positionId: null, effectiveFrom: "2026-06-01" },
    { rateCents: 2000, type: "hourly", positionId: "bar", effectiveFrom: "2026-03-01" },
  ];
  it("picks the latest general wage in force on the date", () => {
    expect(wageOn(rows, "2026-05-31")?.rateCents).toBe(1700);
    expect(wageOn(rows, "2026-06-01")?.rateCents).toBe(1800);
  });
  it("prefers a position-specific wage for that position", () => {
    expect(wageOn(rows, "2026-07-01", "bar")?.rateCents).toBe(2000);
    expect(wageOn(rows, "2026-02-01", "bar")?.rateCents).toBe(1700);
    expect(wageOn(rows, "2026-07-01", "kitchen")?.rateCents).toBe(1800);
  });
  it("returns null before the first wage", () => expect(wageOn(rows, "2025-12-31")).toBeNull());
  it("a raise applies from its effective date, even mid-period", () => {
    // Raise effective 2026-06-01.
    expect(wageOn(rows, "2026-05-31")?.rateCents).toBe(1700);
    expect(wageOn(rows, "2026-06-01")?.rateCents).toBe(1800);
  });
});
