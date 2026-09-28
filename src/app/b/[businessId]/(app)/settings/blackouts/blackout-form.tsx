"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/app/native-select";
import { TextField } from "@/components/app/form-fields";
import { useAction } from "@/components/app/use-action";
import { createBlackoutAction } from "../../requests/actions";

export function BlackoutForm({ businessId, locations, canAll }: { businessId: string; locations: { id: string; name: string }[]; canAll: boolean }) {
  const t = useTranslations("settings.blackouts");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const today = new Date().toISOString().slice(0, 10);
  const [v, setV] = useState({ startDate: today, endDate: today, locationId: canAll ? "" : (locations[0]?.id ?? ""), reason: "" });
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <form
      noValidate
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run<unknown>(() => createBlackoutAction(businessId, { ...v, locationId: v.locationId || null }), () => {
          setV((s) => ({ ...s, reason: "" }));
          router.refresh();
        }, { success: t("saved") });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <TextField id="bo-start" type="date" label={t("from")} value={v.startDate} onChange={set("startDate")} errors={fieldErrors.startDate} />
        <TextField id="bo-end" type="date" label={t("to")} value={v.endDate} onChange={set("endDate")} errors={fieldErrors.endDate} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="bo-loc">{t("location")}</Label>
        <NativeSelect id="bo-loc" value={v.locationId} onChange={(e) => set("locationId")(e.target.value)}>
          {canAll && <option value="">{t("allLocations")}</option>}
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <TextField id="bo-reason" label={t("reason")} hint={t("reasonHint")} value={v.reason} onChange={set("reason")} errors={fieldErrors.reason} />
      <Button type="submit" disabled={pending}>
        {t("add")}
      </Button>
    </form>
  );
}
