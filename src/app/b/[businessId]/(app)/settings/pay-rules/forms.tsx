"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/app/native-select";
import { TextField } from "@/components/app/form-fields";
import { FieldError } from "@/components/app/field-error";
import { PayRulesFields, type PayRulesValues } from "@/components/app/pay-rules-fields";
import { useAction } from "@/components/app/use-action";
import { addBreakRuleAction, saveHolidayRulesAction, savePayRulesAction, saveWorkDayAction } from "./actions";

export function OvertimeForm({ businessId, initial, presetLabel }: { businessId: string; initial: PayRulesValues; presetLabel?: string }) {
  const t = useTranslations("payRulesPage");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [v, setV] = useState(initial);
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => savePayRulesAction(businessId, v as never), () => {
          setV((x) => ({ ...x, confirmed: false }));
          router.refresh();
        }, { success: t("saved") });
      }}
    >
      <h2 className="text-lg font-semibold">{t("overtimeAndPay")}</h2>
      <PayRulesFields value={v} onChange={setV} errors={fieldErrors} presetLabel={presetLabel} />
      <Button type="submit" disabled={pending}>
        {t("save")}
      </Button>
    </form>
  );
}

export function WorkDayForm({ businessId, initial }: { businessId: string; initial: string }) {
  const t = useTranslations("payRulesPage");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [v, setV] = useState(initial);
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const [h, m] = v.split(":").map(Number);
        run(() => saveWorkDayAction(businessId, { workDayStartMinutes: h * 60 + m }), () => router.refresh(), { success: t("saved") });
      }}
    >
      <h2 className="text-lg font-semibold">{t("workDay")}</h2>
      <TextField id="pr-wds" type="time" label={t("workDayStart")} hint={t("workDayHint")} value={v} onChange={setV} errors={fieldErrors.workDayStartMinutes} />
      <Button type="submit" disabled={pending}>
        {t("save")}
      </Button>
    </form>
  );
}

export function BreakRuleForm({ businessId }: { businessId: string }) {
  const t = useTranslations("payRulesPage");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [after, setAfter] = useState("5");
  const [minutes, setMinutes] = useState("30");
  return (
    <form
      noValidate
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addBreakRuleAction(businessId, { afterHours: Number(after), breakMinutes: Number(minutes), paidWhenNotTaken: false }), () => router.refresh(), { success: t("saved") });
      }}
    >
      <TextField id="br-after" inputMode="decimal" label={t("afterHours")} value={after} onChange={setAfter} errors={fieldErrors.afterHours} />
      <TextField id="br-min" inputMode="numeric" label={t("breakMinutes")} value={minutes} onChange={setMinutes} errors={fieldErrors.breakMinutes} />
      <Button type="submit" variant="outline" disabled={pending}>
        {t("addBreakRule")}
      </Button>
    </form>
  );
}

type HolidayValues = {
  holidayMinEmploymentDays: string;
  holidayMinDaysWorkedLookback: string;
  holidayLookbackDays: string;
  holidayAverageDivisor: "days_worked" | "fixed" | "";
  holidayAverageFixedDivisor: string;
};

export function HolidayRulesForm({ businessId, initial, holidaysLink }: { businessId: string; initial: HolidayValues; holidaysLink: React.ReactNode }) {
  const t = useTranslations("payRulesPage");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [v, setV] = useState(initial);
  const set = <K extends keyof HolidayValues>(k: K) => (x: HolidayValues[K]) => setV((s) => ({ ...s, [k]: x }));
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveHolidayRulesAction(businessId, { ...v, holidayAverageDivisor: v.holidayAverageDivisor || null } as never), () => router.refresh(), { success: t("saved") });
      }}
    >
      <h2 className="text-lg font-semibold">{t("holidays")}</h2>
      <p className="text-sm text-muted-foreground">
        {t("holidaysHint")} {holidaysLink}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField id="hr-emp" inputMode="numeric" label={t("minEmployment")} value={v.holidayMinEmploymentDays} onChange={set("holidayMinEmploymentDays")} errors={fieldErrors.holidayMinEmploymentDays} />
        <TextField id="hr-worked" inputMode="numeric" label={t("minWorked")} value={v.holidayMinDaysWorkedLookback} onChange={set("holidayMinDaysWorkedLookback")} errors={fieldErrors.holidayMinDaysWorkedLookback} />
        <TextField id="hr-look" inputMode="numeric" label={t("lookback")} value={v.holidayLookbackDays} onChange={set("holidayLookbackDays")} errors={fieldErrors.holidayLookbackDays} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="hr-div">{t("averageDay")}</Label>
        <NativeSelect id="hr-div" value={v.holidayAverageDivisor} onChange={(e) => set("holidayAverageDivisor")(e.target.value as HolidayValues["holidayAverageDivisor"])}>
          <option value="">{t("averageNotSet")}</option>
          <option value="days_worked">{t("averageDaysWorked")}</option>
          <option value="fixed">{t("averageFixed")}</option>
        </NativeSelect>
        <p className="text-xs text-muted-foreground">{t("averageHint")}</p>
      </div>
      {v.holidayAverageDivisor === "fixed" && (
        <TextField id="hr-fixed" inputMode="numeric" label={t("fixedDivisor")} value={v.holidayAverageFixedDivisor} onChange={set("holidayAverageFixedDivisor")} errors={fieldErrors.holidayAverageFixedDivisor} />
      )}
      <FieldError errors={fieldErrors._} />
      <Button type="submit" disabled={pending}>
        {t("save")}
      </Button>
    </form>
  );
}
