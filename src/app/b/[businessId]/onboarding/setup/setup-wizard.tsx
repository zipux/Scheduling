"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/app/native-select";
import { FieldError } from "@/components/app/field-error";
import { LocationFields } from "@/components/app/location-fields";
import { emptyLocation, type LocationValues } from "@/lib/location-values";
import { PayRulesFields, type PayRulesValues } from "@/components/app/pay-rules-fields";
import { useAction } from "@/components/app/use-action";
import { completeSetupAction } from "../actions";

const STEPS = ["location", "payPeriod", "payRules", "roles"] as const;
const STEP_OF_FIELD: Record<string, number> = { location: 0, payPeriodFrequency: 1, payPeriodAnchorDate: 1, payRules: 2 };

export function SetupWizard(props: {
  businessId: string;
  timezone: string;
  timezones: string[];
  anchorDefault: string;
  presetLabel?: string;
  payRules: PayRulesValues;
  roles: { id: string; name: string; rank: number; permissionCount: number }[];
}) {
  const t = useTranslations("setup");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [step, setStep] = useState(0);
  const [location, setLocation] = useState<LocationValues>(emptyLocation(props.timezone));
  const [frequency, setFrequency] = useState("biweekly");
  const [anchor, setAnchor] = useState(props.anchorDefault);
  const [payRules, setPayRules] = useState<PayRulesValues>(props.payRules);

  function submit() {
    run(
      () =>
        completeSetupAction(props.businessId, {
          location: location as never,
          payPeriodFrequency: frequency as never,
          payPeriodAnchorDate: anchor,
          payRules: payRules as never,
        }),
      () => {
        router.replace(`/b/${props.businessId}`);
        router.refresh();
      },
    );
  }

  // Jump back to the first step that has an error after a failed submit.
  const firstErrorStep = Object.keys(fieldErrors)
    .map((k) => STEP_OF_FIELD[k.split(".")[0]] ?? 99)
    .sort()[0];

  return (
    <div>
      <ol className="mb-6 grid grid-cols-4 gap-1" aria-label={t("progress")}>
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className="text-center">
            <span className={`block h-1.5 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`} />
            <span className="mt-1 block text-[11px] text-muted-foreground">{t(`steps.${s}`)}</span>
          </li>
        ))}
      </ol>
      <h2 className="mb-4 text-lg font-semibold">{t(`stepTitles.${STEPS[step]}`)}</h2>

      {step === 0 && (
        <LocationFields value={location} onChange={setLocation} errors={fieldErrors} timezones={props.timezones} prefix="location." />
      )}
      {step === 1 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="freq">{t("frequency")}</Label>
            <NativeSelect id="freq" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              {(["weekly", "biweekly"] as const).map((f) => (
                <option key={f} value={f}>
                  {t(`frequencies.${f}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          {(frequency === "weekly" || frequency === "biweekly") && (
            <div className="space-y-2">
              <Label htmlFor="anchor">{t("anchor")}</Label>
              <Input id="anchor" type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t("anchorHint")}</p>
              <FieldError errors={fieldErrors.payPeriodAnchorDate} />
            </div>
          )}
        </div>
      )}
      {step === 2 && (
        <PayRulesFields value={payRules} onChange={setPayRules} errors={fieldErrors} prefix="payRules." presetLabel={props.presetLabel} />
      )}
      {step === 3 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("rolesHint")}</p>
          <ul className="divide-y rounded-lg border">
            {props.roles.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-3">
                <span>
                  <span className="mr-2 text-muted-foreground">{r.rank}.</span>
                  {r.name}
                </span>
                <span className="text-sm text-muted-foreground">
                  {r.permissionCount < 0 ? t("allPermissions") : t("permissions", { count: r.permissionCount })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {firstErrorStep !== undefined && firstErrorStep !== step && firstErrorStep < 99 && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {t("fixStep", { step: t(`steps.${STEPS[firstErrorStep]}`) })}{" "}
          <button type="button" className="underline" onClick={() => setStep(firstErrorStep)}>
            {t("goThere")}
          </button>
        </p>
      )}

      <div className="mt-6 flex gap-3">
        {step > 0 && (
          <Button type="button" variant="outline" size="lg" className="flex-1" onClick={() => setStep(step - 1)}>
            {t("back")}
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button type="button" size="lg" className="flex-1" onClick={() => setStep(step + 1)}>
            {t("next")}
          </Button>
        ) : (
          <Button type="button" size="lg" className="flex-1" disabled={pending} onClick={submit}>
            {t("finish")}
          </Button>
        )}
      </div>
    </div>
  );
}
