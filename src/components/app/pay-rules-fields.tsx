"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError } from "@/components/app/field-error";

export interface PayRulesValues {
  dailyThresholdHours: string;
  dailyMultiplier: string;
  dailySecondThresholdHours: string;
  dailySecondMultiplier: string;
  weeklyThresholdHours: string;
  weeklyMultiplier: string;
  minimumDailyPayHours: string;
  maxSplitShiftSpanHours: string;
  vacationPayPercent: string;
  confirmed: boolean;
}

const PAIRS = [
  ["dailyThresholdHours", "dailyMultiplier", "daily"],
  ["dailySecondThresholdHours", "dailySecondMultiplier", "dailySecond"],
  ["weeklyThresholdHours", "weeklyMultiplier", "weekly"],
] as const;

export function PayRulesFields({
  value,
  onChange,
  errors,
  prefix = "",
  presetLabel,
}: {
  value: PayRulesValues;
  onChange: (v: PayRulesValues) => void;
  errors: Record<string, string[]>;
  prefix?: string;
  presetLabel?: string;
}) {
  const t = useTranslations("payRules");
  const set = (k: keyof PayRulesValues, v: string | boolean) => onChange({ ...value, [k]: v });
  const err = (k: string) => errors[prefix + k];
  const num = (k: Exclude<keyof PayRulesValues, "confirmed">, label: string, hint?: string) => (
    <div className="space-y-1">
      <Label htmlFor={`pr-${k}`}>{label}</Label>
      <Input id={`pr-${k}`} inputMode="decimal" value={value[k]} onChange={(e) => set(k, e.target.value)} placeholder={t("off")} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError errors={err(k)} />
    </div>
  );

  return (
    <div className="space-y-5">
      <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50">
        <p className="font-medium">{t("responsibilityTitle")}</p>
        <p className="mt-1">{t("responsibilityBody")}</p>
        {presetLabel && <p className="mt-1">{t("presetFrom", { preset: presetLabel })}</p>}
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{t("overtime")}</legend>
        <p className="text-xs text-muted-foreground">{t("overtimeOrder")}</p>
        {PAIRS.map(([th, mu, key]) => (
          <div key={key} className="grid grid-cols-2 gap-3">
            {num(th, t(`${key}Threshold`))}
            {num(mu, t("multiplier"))}
          </div>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        {num("minimumDailyPayHours", t("minimumDailyPay"), t("minimumDailyPayHint"))}
        {num("maxSplitShiftSpanHours", t("splitShiftSpan"), t("splitShiftSpanHint"))}
      </div>
      {num("vacationPayPercent", t("vacationPercent"), t("vacationPercentHint"))}
      <label className="flex min-h-11 items-start gap-3">
        <Checkbox
          checked={value.confirmed}
          onCheckedChange={(c) => set("confirmed", !!c)}
          className="mt-1 size-5"
          aria-label={t("confirm")}
        />
        <span className="text-sm">{t("confirm")}</span>
      </label>
      <FieldError errors={err("confirmed")} />
    </div>
  );
}
