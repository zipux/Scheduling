"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/app/native-select";
import { TextField } from "@/components/app/form-fields";
import { FieldError } from "@/components/app/field-error";
import { useAction } from "@/components/app/use-action";
import { warningText } from "@/components/app/warning-text";
import type { ScheduleWarning } from "@/lib/schedule-warnings";
import { createShiftAction, deleteShiftAction, previewWarningsAction, updateShiftAction } from "./actions";
import type { BoardData, BoardShift } from "./types";

export interface EditorSeed {
  shift?: BoardShift;
  date?: string;
  membershipId?: string | null;
}

type Override = "location" | "off" | "custom";

export function ShiftEditor({ data, seed, onClose }: { data: BoardData; seed: EditorSeed | null; onClose: () => void }) {
  const t = useTranslations("schedule");
  const tw = useTranslations("warnings");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const s = seed?.shift;
  // §5.2: with a single location selected, new shifts default to it; with "All", location is required.
  const defaultLocation = s?.locationId ?? (data.scope.selected && data.scope.selected !== "all" ? data.scope.selected : data.locations.length === 1 ? data.locations[0].id : "");
  const [v, setV] = useState({
    date: s?.date ?? seed?.date ?? data.days[0],
    start: s?.start ?? "09:00",
    end: s?.end ?? "17:00",
    breakMinutes: String(s?.breakMinutes ?? 0),
    locationId: defaultLocation,
    positionId: s?.positionId ?? "",
    membershipId: s ? (s.membershipId ?? "") : (seed?.membershipId ?? ""),
    notes: s?.notes ?? "",
  });
  const [override, setOverride] = useState<Override>(s?.geofenceOverride?.mode ?? "location");
  const [custom, setCustom] = useState({
    lat: s?.geofenceOverride?.mode === "custom" ? String(s.geofenceOverride.lat) : "",
    lng: s?.geofenceOverride?.mode === "custom" ? String(s.geofenceOverride.lng) : "",
    radiusM: s?.geofenceOverride?.mode === "custom" ? String(s.geofenceOverride.radiusM) : "100",
  });
  const [warnings, setWarnings] = useState<ScheduleWarning[]>(s?.warnings ?? []);
  const [ineligible, setIneligible] = useState<string[]>([]);
  const set = (k: keyof typeof v) => (val: string) => setV((x) => ({ ...x, [k]: val }));

  const payload = useMemo(
    () => ({
      date: v.date,
      start: v.start,
      end: v.end,
      breakMinutes: Number(v.breakMinutes) || 0,
      locationId: v.locationId,
      positionId: v.positionId || null,
      membershipId: v.membershipId || null,
      notes: v.notes,
      geofenceOverride:
        override === "location"
          ? null
          : override === "off"
            ? ({ mode: "off" } as const)
            : ({ mode: "custom", lat: Number(custom.lat), lng: Number(custom.lng), radiusM: Number(custom.radiusM) } as const),
    }),
    [v, override, custom],
  );

  // Warnings at the moment of assignment (§5.1): recomputed whenever the person or time changes.
  const seq = useRef(0);
  useEffect(() => {
    if (!payload.membershipId || !payload.locationId) return;
    const n = ++seq.current;
    const timer = setTimeout(async () => {
      const res = await previewWarningsAction(data.businessId, { ...payload, id: s?.id ?? null });
      if (n === seq.current && res.ok) {
        setWarnings(res.data.warnings);
        setIneligible(res.data.ineligible);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [payload, data.businessId, s?.id]);

  const shownWarnings = payload.membershipId && payload.locationId ? warnings : [];
  // Overlap/time-off/age already appear as warnings; show only what's new here.
  const shownIneligible = payload.membershipId && payload.locationId ? ineligible.filter((r) => ["POSITION", "LOCATION", "INACTIVE"].includes(r)) : [];

  // Suggest eligible people first: those with the position and location.
  const members = [...data.members].sort((a, b) => {
    const score = (m: (typeof data.members)[number]) =>
      (v.positionId && m.positionIds.includes(v.positionId) ? 2 : 0) + (v.locationId && m.locationIds.includes(v.locationId) ? 1 : 0);
    return score(b) - score(a) || a.name.localeCompare(b.name);
  });

  const done = () => {
    onClose();
    router.refresh();
  };

  function applyTemplate(id: string) {
    const tp = data.templates.find((x) => x.id === id);
    if (!tp) return;
    setV((x) => ({
      ...x,
      start: tp.start,
      end: tp.end,
      breakMinutes: String(tp.breakMinutes),
      locationId: tp.locationId && data.locations.some((l) => l.id === tp.locationId) ? tp.locationId : x.locationId,
      positionId: tp.positionId ?? x.positionId,
    }));
  }

  return (
    <Dialog open={!!seed} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{s ? t("editShift") : t("newShift")}</DialogTitle>
        </DialogHeader>
        <form
          id="shift-form"
          noValidate
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (s) run<unknown>(() => updateShiftAction(data.businessId, { ...payload, id: s.id }), done, { success: t("saved") });
            else run<unknown>(() => createShiftAction(data.businessId, payload), done, { success: t("created") });
          }}
        >
          {!s && data.templates.length > 0 && (
            <div className="space-y-1">
              <Label htmlFor="sh-template">{t("fromTemplate")}</Label>
              <NativeSelect id="sh-template" defaultValue="" onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">—</option>
                {data.templates.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name} ({tp.start}–{tp.end})
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <TextField id="sh-date" type="date" label={t("date")} value={v.date} onChange={set("date")} errors={fieldErrors.date} />
          <div className="grid grid-cols-3 gap-2">
            <TextField id="sh-start" type="time" label={t("start")} value={v.start} onChange={set("start")} errors={fieldErrors.start} />
            <TextField id="sh-end" type="time" label={t("end")} value={v.end} onChange={set("end")} errors={fieldErrors.end} />
            <TextField id="sh-break" inputMode="numeric" label={t("breakMinutes")} value={v.breakMinutes} onChange={set("breakMinutes")} errors={fieldErrors.breakMinutes} />
          </div>
          <p className="text-xs text-muted-foreground">{t("breakHint")}</p>
          <div className="space-y-1">
            <Label htmlFor="sh-location">{t("location")}</Label>
            <NativeSelect id="sh-location" value={v.locationId} onChange={(e) => set("locationId")(e.target.value)} aria-invalid={fieldErrors.locationId ? true : undefined}>
              {!v.locationId && <option value="">{t("chooseLocation")}</option>}
              {data.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
            <FieldError errors={fieldErrors.locationId} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sh-position">{t("position")}</Label>
            <NativeSelect id="sh-position" value={v.positionId} onChange={(e) => set("positionId")(e.target.value)}>
              <option value="">{t("noPosition")}</option>
              {data.positions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sh-member">{t("employee")}</Label>
            <NativeSelect id="sh-member" value={v.membershipId} onChange={(e) => set("membershipId")(e.target.value)}>
              <option value="">{t("openShift")}</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
            <FieldError errors={fieldErrors.membershipId} />
          </div>
          {shownIneligible.length > 0 && (
            <p role="status" className="rounded-md bg-muted p-2 text-sm" data-testid="editor-ineligible">
              {t("notEligible", { reasons: shownIneligible.map((r) => t(`ineligible.${r}`)).join(", ") })}
            </p>
          )}
          {shownWarnings.length > 0 && (
            <div role="alert" className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50" data-testid="editor-warnings">
              <p className="flex items-center gap-2 font-medium">
                <TriangleAlert className="size-4" aria-hidden />
                {t("warningsTitle")}
              </p>
              <ul className="list-disc pl-5">
                {shownWarnings.map((w, i) => (
                  <li key={i}>{warningText(tw, w)}</li>
                ))}
              </ul>
              <p className="text-xs">{t("warningsHint")}</p>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="sh-notes">{t("notes")}</Label>
            <Textarea id="sh-notes" value={v.notes} onChange={(e) => set("notes")(e.target.value)} rows={2} />
          </div>
          <details className="rounded-md border p-3" open={override !== "location"}>
            <summary className="cursor-pointer text-sm font-medium">{t("offsite")}</summary>
            <div className="mt-3 space-y-2">
              <p className="text-xs text-muted-foreground">{t("offsiteHint")}</p>
              <NativeSelect aria-label={t("offsite")} value={override} onChange={(e) => setOverride(e.target.value as Override)}>
                <option value="location">{t("geoLocation")}</option>
                <option value="off">{t("geoOff")}</option>
                <option value="custom">{t("geoCustom")}</option>
              </NativeSelect>
              {override === "custom" && (
                <div className="grid grid-cols-3 gap-2">
                  <TextField id="sh-glat" inputMode="decimal" label={t("lat")} value={custom.lat} onChange={(x) => setCustom((c) => ({ ...c, lat: x }))} />
                  <TextField id="sh-glng" inputMode="decimal" label={t("lng")} value={custom.lng} onChange={(x) => setCustom((c) => ({ ...c, lng: x }))} />
                  <TextField id="sh-grad" inputMode="numeric" label={t("radius")} value={custom.radiusM} onChange={(x) => setCustom((c) => ({ ...c, radiusM: x }))} />
                </div>
              )}
              <FieldError errors={Object.entries(fieldErrors).filter(([k]) => k.startsWith("geofenceOverride")).flatMap(([, e]) => e)} />
            </div>
          </details>
        </form>
        <DialogFooter>
          {s && (
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              className="sm:mr-auto"
              onClick={() => run(() => deleteShiftAction(data.businessId, { id: s.id }), done, { success: t("deleted") })}
            >
              {t("delete")}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" form="shift-form" disabled={pending}>
            {s ? t("save") : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
