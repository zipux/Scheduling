"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SwitchField, TextField } from "@/components/app/form-fields";
import { useAction } from "@/components/app/use-action";
import { addHolidayAction, addPresetYearAction } from "../pay-rules/actions";

export function PresetButton({ businessId, year, label }: { businessId: string; year: number; label: string }) {
  const t = useTranslations("holidaysPage");
  const router = useRouter();
  const { pending, run } = useAction();
  return (
    <Button variant="outline" disabled={pending} onClick={() => run(() => addPresetYearAction(businessId, { year }), (r) => {
      router.refresh();
      return r;
    }, { success: t("presetAdded") })}>
      {label}
    </Button>
  );
}

export function AddHolidayForm({ businessId }: { businessId: string }) {
  const t = useTranslations("holidaysPage");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [v, setV] = useState({ date: "", name: "", isStatutory: true, premiumMultiplier: "1.5" });
  return (
    <form
      noValidate
      className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[auto_1fr_auto_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addHolidayAction(businessId, { ...v, premiumMultiplier: Number(v.premiumMultiplier) }), () => {
          setV({ date: "", name: "", isStatutory: true, premiumMultiplier: "1.5" });
          router.refresh();
        }, { success: t("added") });
      }}
    >
      <TextField id="hol-date" type="date" label={t("date")} value={v.date} onChange={(x) => setV((s) => ({ ...s, date: x }))} errors={fieldErrors.date} />
      <TextField id="hol-name" label={t("name")} value={v.name} onChange={(x) => setV((s) => ({ ...s, name: x }))} errors={fieldErrors.name} />
      <TextField id="hol-mult" inputMode="decimal" label={t("multiplier")} value={v.premiumMultiplier} onChange={(x) => setV((s) => ({ ...s, premiumMultiplier: x }))} errors={fieldErrors.premiumMultiplier} />
      <Button type="submit" disabled={pending}>
        {t("add")}
      </Button>
      <div className="sm:col-span-4">
        <SwitchField label={t("statutory")} checked={v.isStatutory} onChange={(x) => setV((s) => ({ ...s, isStatutory: x }))} />
      </div>
    </form>
  );
}
