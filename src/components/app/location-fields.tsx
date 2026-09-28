"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/app/native-select";
import { FieldError } from "@/components/app/field-error";
import { MapPicker } from "@/components/app/map-picker";
import { GeofenceTest } from "@/components/app/geofence-test";
import type { LocationValues } from "@/lib/location-values";

export type { LocationValues };


export function LocationFields({
  value,
  onChange,
  errors,
  timezones,
  prefix = "",
  extra,
}: {
  value: LocationValues;
  onChange: (v: LocationValues) => void;
  errors: Record<string, string[]>;
  timezones: string[];
  /** Field-error key prefix, e.g. "location." when nested in a bigger schema. */
  prefix?: string;
  extra?: React.ReactNode;
}) {
  const t = useTranslations("location");
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const set = <K extends keyof LocationValues>(k: K, v: LocationValues[K]) => onChange({ ...value, [k]: v });
  const err = (k: string) => errors[prefix + k];

  function useMyPosition() {
    setGeoError(null);
    if (!("geolocation" in navigator)) return setGeoError(t("geoUnsupported"));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onChange({ ...value, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) });
      },
      (e) => {
        setLocating(false);
        setGeoError(e.code === e.PERMISSION_DENIED ? t("geoDenied") : t("geoFailed"));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="loc-name">{t("name")}</Label>
        <Input id="loc-name" value={value.name} onChange={(e) => set("name", e.target.value)} placeholder={t("namePlaceholder")} />
        <FieldError errors={err("name")} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="loc-address">{t("address")}</Label>
        <Input id="loc-address" value={value.address} onChange={(e) => set("address", e.target.value)} autoComplete="street-address" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="loc-tz">{t("timezone")}</Label>
        <NativeSelect id="loc-tz" value={value.timezone} onChange={(e) => set("timezone", e.target.value)}>
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </NativeSelect>
        <FieldError errors={err("timezone")} />
      </div>
      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">{t("geofence")}</legend>
        <div className="space-y-2">
          <Label htmlFor="loc-mode">{t("geofenceMode")}</Label>
          <NativeSelect id="loc-mode" value={value.geofenceMode} onChange={(e) => set("geofenceMode", e.target.value as LocationValues["geofenceMode"])}>
            <option value="required">{t("mode.required")}</option>
            <option value="warn">{t("mode.warn")}</option>
            <option value="off">{t("mode.off")}</option>
          </NativeSelect>
          <p className="text-xs text-muted-foreground">{t(`modeHint.${value.geofenceMode}`)}</p>
        </div>
        {value.geofenceMode !== "off" && (
          <>
            <Button type="button" variant="outline" onClick={useMyPosition} disabled={locating} className="w-full sm:w-auto">
              <LocateFixed aria-hidden />
              {locating ? t("locating") : t("useMyPosition")}
            </Button>
            {geoError && <p className="text-sm text-destructive" role="alert">{geoError}</p>}
            <MapPicker
              lat={value.lat === "" ? null : Number(value.lat)}
              lng={value.lng === "" ? null : Number(value.lng)}
              radiusM={Number(value.radiusM) || 0}
              onPick={(lat, lng) => onChange({ ...value, lat: String(lat), lng: String(lng) })}
              label={t("mapLabel")}
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="loc-lat">{t("lat")}</Label>
                <Input id="loc-lat" inputMode="decimal" value={value.lat} onChange={(e) => set("lat", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="loc-lng">{t("lng")}</Label>
                <Input id="loc-lng" inputMode="decimal" value={value.lng} onChange={(e) => set("lng", e.target.value)} />
              </div>
            </div>
            <FieldError errors={err("lat") ?? err("lng")} />
            <div className="space-y-2">
              <Label htmlFor="loc-radius">{t("radius")}</Label>
              <Input id="loc-radius" inputMode="numeric" value={value.radiusM} onChange={(e) => set("radiusM", e.target.value)} />
              <FieldError errors={err("radiusM")} />
            </div>
            <GeofenceTest
              center={value.lat !== "" && value.lng !== "" ? { lat: Number(value.lat), lng: Number(value.lng) } : null}
              onApply={(r) => onChange({ ...value, lat: String(r.lat), lng: String(r.lng), radiusM: String(r.radiusM) })}
            />
            {extra}
          </>
        )}
      </fieldset>
      <label className="flex min-h-11 items-center justify-between gap-3">
        <span>
          <span className="block text-sm font-medium">{t("temporary")}</span>
          <span className="block text-xs text-muted-foreground">{t("temporaryHint")}</span>
        </span>
        <Switch checked={value.isTemporary} onCheckedChange={(c) => set("isTemporary", !!c)} aria-label={t("temporary")} />
      </label>
    </div>
  );
}
