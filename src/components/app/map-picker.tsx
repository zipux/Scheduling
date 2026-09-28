"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, Circle, CircleMarker } from "leaflet";

const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL ?? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION ?? "© OpenStreetMap contributors";

/**
 * Tap/click the map to place the geofence centre. Progressive enhancement: if map
 * tiles can't load (offline, blocked), the lat/lng inputs beside it still work.
 */
export function MapPicker({
  lat,
  lng,
  radiusM,
  onPick,
  label,
}: {
  lat: number | null;
  lng: number | null;
  radiusM: number;
  onPick: (lat: number, lng: number) => void;
  label: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const circle = useRef<Circle | null>(null);
  const dot = useRef<CircleMarker | null>(null);
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current || map.current) return;
      const has = lat !== null && lng !== null;
      const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(
        has ? [lat!, lng!] : [45, -95],
        has ? 17 : 3,
      );
      L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(m);
      m.on("click", (e) => pickRef.current(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))));
      map.current = m;
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      circle.current = null;
      dot.current = null;
    };
    // Map is created once; position updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      const L = (await import("leaflet")).default;
      const m = map.current;
      if (!m) return;
      if (lat === null || lng === null || Number.isNaN(lat) || Number.isNaN(lng)) return;
      if (!circle.current) {
        circle.current = L.circle([lat, lng], { radius: radiusM, color: "#2563eb", weight: 2, fillOpacity: 0.15 }).addTo(m);
        dot.current = L.circleMarker([lat, lng], { radius: 6, color: "#1d4ed8", fillOpacity: 1 }).addTo(m);
        m.setView([lat, lng], Math.max(m.getZoom(), 16));
      } else {
        circle.current.setLatLng([lat, lng]).setRadius(radiusM);
        dot.current?.setLatLng([lat, lng]);
      }
    })();
  }, [lat, lng, radiusM]);

  return <div ref={el} role="application" aria-label={label} className="h-60 w-full overflow-hidden rounded-lg border" />;
}
