"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/app/native-select";
import { SwitchField, TextField } from "@/components/app/form-fields";
import { useAction } from "@/components/app/use-action";
import { saveBusinessInfoAction, saveClockRulesAction, saveRequestRulesAction } from "../actions";

function Section({ title, children, onSubmit, pending }: { title: string; children: React.ReactNode; onSubmit: () => void; pending: boolean }) {
  const t = useTranslations("settings.business");
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
      <Button type="submit" disabled={pending}>
        {t("save")}
      </Button>
    </form>
  );
}

type Info = {
  name: string;
  timezone: string;
  currency: string;
  minorAgeThreshold: string;
  burdenPercent: string;
  burdenNote: string;
  directoryShowsPhone: boolean;
  directoryShowsEmail: boolean;
  autoChatGroups: boolean;
};

export function BusinessInfoForm({ businessId, initial, timezones, currencies }: { businessId: string; initial: Info; timezones: string[]; currencies: string[] }) {
  const t = useTranslations("settings.business");
  const router = useRouter();
  const { pending, fieldErrors: e, run } = useAction();
  const [v, setV] = useState(initial);
  const set = <K extends keyof Info>(k: K) => (val: Info[K]) => setV((s) => ({ ...s, [k]: val }));
  return (
    <Section title={t("info")} pending={pending} onSubmit={() => run(() => saveBusinessInfoAction(businessId, v as never), () => router.refresh(), { success: t("saved") })}>
      <TextField id="biz-name" label={t("name")} value={v.name} onChange={set("name")} errors={e.name} />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="biz-tz">{t("timezone")}</Label>
          <NativeSelect id="biz-tz" value={v.timezone} onChange={(ev) => set("timezone")(ev.target.value)}>
            {timezones.map((tz) => (
              <option key={tz}>{tz}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="biz-cur">{t("currency")}</Label>
          <NativeSelect id="biz-cur" value={v.currency} onChange={(ev) => set("currency")(ev.target.value)}>
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <TextField id="biz-minor" label={t("minorAge")} hint={t("minorAgeHint")} inputMode="numeric" value={v.minorAgeThreshold} onChange={set("minorAgeThreshold")} errors={e.minorAgeThreshold} />
      <TextField id="biz-burden" label={t("burden")} hint={t("burdenHint")} inputMode="decimal" value={v.burdenPercent} onChange={set("burdenPercent")} errors={e.burdenPercent} placeholder="—" />
      <TextField id="biz-burden-note" label={t("burdenNote")} hint={t("burdenNoteHint")} value={v.burdenNote} onChange={set("burdenNote")} errors={e.burdenNote} />
      <SwitchField label={t("dirPhone")} checked={v.directoryShowsPhone} onChange={set("directoryShowsPhone")} />
      <SwitchField label={t("dirEmail")} checked={v.directoryShowsEmail} onChange={set("directoryShowsEmail")} />
      <SwitchField label={t("autoGroups")} hint={t("autoGroupsHint")} checked={v.autoChatGroups} onChange={set("autoChatGroups")} />
    </Section>
  );
}

type Req = {
  allowSelfTimeOffApproval: boolean;
  escalateAfterHours: string;
  timeOffMinNoticeDays: string;
  availabilityNeedsApproval: boolean;
  dropNeedsApproval: boolean;
  pickupNeedsApproval: boolean;
  swapNeedsApproval: boolean;
};

export function RequestRulesForm({ businessId, initial }: { businessId: string; initial: Req }) {
  const t = useTranslations("settings.business");
  const router = useRouter();
  const { pending, fieldErrors: e, run } = useAction();
  const [v, setV] = useState(initial);
  const set = <K extends keyof Req>(k: K) => (val: Req[K]) => setV((s) => ({ ...s, [k]: val }));
  return (
    <Section title={t("requests")} pending={pending} onSubmit={() => run(() => saveRequestRulesAction(businessId, v as never), () => router.refresh(), { success: t("saved") })}>
      <SwitchField label={t("selfApproval")} hint={t("selfApprovalHint")} checked={v.allowSelfTimeOffApproval} onChange={set("allowSelfTimeOffApproval")} />
      <TextField id="req-esc" label={t("escalate")} hint={t("escalateHint")} inputMode="numeric" value={v.escalateAfterHours} onChange={set("escalateAfterHours")} errors={e.escalateAfterHours} />
      <TextField id="req-notice" label={t("minNotice")} inputMode="numeric" value={v.timeOffMinNoticeDays} onChange={set("timeOffMinNoticeDays")} errors={e.timeOffMinNoticeDays} />
      <SwitchField label={t("availabilityApproval")} checked={v.availabilityNeedsApproval} onChange={set("availabilityNeedsApproval")} />
      <SwitchField label={t("dropApproval")} checked={v.dropNeedsApproval} onChange={set("dropNeedsApproval")} />
      <SwitchField label={t("pickupApproval")} checked={v.pickupNeedsApproval} onChange={set("pickupNeedsApproval")} />
      <SwitchField label={t("swapApproval")} checked={v.swapNeedsApproval} onChange={set("swapNeedsApproval")} />
    </Section>
  );
}

type Clock = {
  clockModePersonal: boolean;
  clockModeKiosk: boolean;
  earlyClockInMinutes: string;
  allowUnscheduledClockIn: boolean;
  roundingMode: string;
  roundingIntervalMinutes: string;
  lateToleranceMinutes: string;
  maxShiftHours: string;
  maxClockSkewMinutes: string;
};

export function ClockRulesForm({ businessId, initial }: { businessId: string; initial: Clock }) {
  const t = useTranslations("settings.business");
  const router = useRouter();
  const { pending, fieldErrors: e, run } = useAction();
  const [v, setV] = useState(initial);
  const set = <K extends keyof Clock>(k: K) => (val: Clock[K]) => setV((s) => ({ ...s, [k]: val }));
  const submit = () => run(() => saveClockRulesAction(businessId, v as never), () => router.refresh(), { success: t("saved") });
  return (
    <Section title={t("clock")} pending={pending} onSubmit={submit}>
      <SwitchField label={t("modePersonal")} checked={v.clockModePersonal} onChange={set("clockModePersonal")} errors={e.clockModePersonal} />
      <SwitchField label={t("modeKiosk")} checked={v.clockModeKiosk} onChange={set("clockModeKiosk")} />
      <TextField id="clk-early" label={t("early")} inputMode="numeric" value={v.earlyClockInMinutes} onChange={set("earlyClockInMinutes")} errors={e.earlyClockInMinutes} />
      <SwitchField label={t("unscheduled")} hint={t("unscheduledHint")} checked={v.allowUnscheduledClockIn} onChange={set("allowUnscheduledClockIn")} />
      <TextField id="clk-late" label={t("lateTolerance")} inputMode="numeric" value={v.lateToleranceMinutes} onChange={set("lateToleranceMinutes")} errors={e.lateToleranceMinutes} />
      <TextField id="clk-max" label={t("maxShift")} hint={t("maxShiftHint")} inputMode="numeric" value={v.maxShiftHours} onChange={set("maxShiftHours")} errors={e.maxShiftHours} />
      <TextField id="clk-skew" label={t("skew")} hint={t("skewHint")} inputMode="numeric" value={v.maxClockSkewMinutes} onChange={set("maxClockSkewMinutes")} errors={e.maxClockSkewMinutes} />
      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">{t("rounding")}</legend>
        <div role="note" className="rounded-md bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50">
          {t("roundingWarning")}
        </div>
        <div className="space-y-1">
          <Label htmlFor="clk-rmode">{t("roundingMode")}</Label>
          <NativeSelect id="clk-rmode" value={v.roundingMode} onChange={(ev) => set("roundingMode")(ev.target.value)}>
            <option value="none">{t("roundNone")}</option>
            <option value="employee_favour">{t("roundFavour")}</option>
            <option value="nearest">{t("roundNearest")}</option>
          </NativeSelect>
        </div>
        {v.roundingMode !== "none" && (
          <div className="space-y-1">
            <Label htmlFor="clk-rint">{t("roundingInterval")}</Label>
            <NativeSelect id="clk-rint" value={v.roundingIntervalMinutes} onChange={(ev) => set("roundingIntervalMinutes")(ev.target.value)}>
              {[1, 5, 6, 10, 15].map((n) => (
                <option key={n} value={n}>
                  {t("minutes", { n })}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </fieldset>
    </Section>
  );
}
