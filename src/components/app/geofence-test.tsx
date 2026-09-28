"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recommendGeofence, type Reading } from "@/lib/geo";

const READINGS = 10;

function readOnce(): Promise<Reading> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    ),
  );
}

/**
 * §7.2 "Test geofence": take ten readings from where staff actually stand, then
 * recommend a radius that would have accepted every one of them.
 */
export function GeofenceTest({
  center,
  onApply,
}: {
  center: { lat: number; lng: number } | null;
  onApply: (r: { lat: number; lng: number; radiusM: number }) => void;
}) {
  const t = useTranslations("location.test");
  const [readings, setReadings] = useState<Reading[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setReadings([]);
    if (!("geolocation" in navigator)) return setError(t("unsupported"));
    setRunning(true);
    const got: Reading[] = [];
    try {
      for (let i = 0; i < READINGS; i++) {
        got.push(await readOnce());
        setReadings([...got]);
        if (i < READINGS - 1) await new Promise((r) => setTimeout(r, 800));
      }
    } catch (e) {
      const denied = (e as GeolocationPositionError)?.code === 1;
      setError(denied ? t("denied") : t("failed"));
    } finally {
      setRunning(false);
    }
  }

  const rec = readings.length === READINGS ? recommendGeofence(readings, center) : null;

  return (
    <div className="space-y-3 rounded-lg bg-muted/50 p-3" data-testid="geofence-test">
      <p className="text-sm">{t("intro")}</p>
      <Button type="button" variant="outline" onClick={run} disabled={running}>
        <Radar aria-hidden />
        {running ? t("progress", { n: readings.length, total: READINGS }) : t("start")}
      </Button>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {readings.length > 0 && (
        <ol className="grid grid-cols-2 gap-x-4 text-xs text-muted-foreground sm:grid-cols-5">
          {readings.map((r, i) => (
            <li key={i}>
              #{i + 1} ±{Math.round(r.accuracy)} m
            </li>
          ))}
        </ol>
      )}
      {rec && (
        <div className="space-y-2" role="status">
          <p className="text-sm font-medium">{t("recommendation", { radius: rec.radiusM })}</p>
          <p className="text-xs text-muted-foreground">{t("explain", { worst: Math.round(rec.worstM) })}</p>
          <Button type="button" onClick={() => onApply({ lat: Number(rec.center.lat.toFixed(6)), lng: Number(rec.center.lng.toFixed(6)), radiusM: rec.radiusM })}>
            {center ? t("applyRadius") : t("applyBoth")}
          </Button>
        </div>
      )}
    </div>
  );
}
