export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Reading extends LatLng {
  accuracy: number;
}

export const MIN_RECOMMENDED_RADIUS_M = 25;
export const MAX_RECOMMENDED_RADIUS_M = 1000;

/**
 * "Test geofence" (§7.2): given readings taken where staff actually stand, recommend
 * a radius that contains every reading including its reported accuracy, plus 10 %
 * margin, rounded up to 10 m. Without a centre, the centre is the mean reading.
 */
export function recommendGeofence(readings: Reading[], center?: LatLng | null) {
  if (readings.length === 0) throw new Error("No readings");
  const c = center ?? {
    lat: readings.reduce((s, r) => s + r.lat, 0) / readings.length,
    lng: readings.reduce((s, r) => s + r.lng, 0) / readings.length,
  };
  const worst = Math.max(...readings.map((r) => distanceM(c, r) + r.accuracy));
  const radiusM = Math.min(
    MAX_RECOMMENDED_RADIUS_M,
    Math.max(MIN_RECOMMENDED_RADIUS_M, Math.ceil((worst * 1.1) / 10) * 10),
  );
  return { center: c, radiusM, worstM: worst };
}
