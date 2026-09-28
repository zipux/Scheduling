"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/app/native-select";
import { SwitchField, TextField } from "@/components/app/form-fields";
import { FieldError } from "@/components/app/field-error";
import { useAction } from "@/components/app/use-action";
import { requestTimeOffAction, reviewAvailabilityAction, reviewTimeOffAction, reviewTradeAction, submitAvailabilityAction } from "./actions";

export function TimeOffForm({ businessId, types, today, blackouts }: { businessId: string; types: string[]; today: string; blackouts: { start: string; end: string; reason: string }[] }) {
  const t = useTranslations("requests");
  const router = useRouter();
  const { pending, fieldErrors, error, run } = useAction();
  const [v, setV] = useState({ type: types[0] ?? "vacation", allDay: true, startDate: today, endDate: today, startTime: "09:00", endTime: "13:00", reason: "" });
  const set = <K extends keyof typeof v>(k: K) => (x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }));
  return (
    <form
      noValidate
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run<unknown>(
          () => requestTimeOffAction(businessId, { ...v, endDate: v.allDay ? v.endDate : v.startDate, startTime: v.allDay ? undefined : v.startTime, endTime: v.allDay ? undefined : v.endTime }),
          () => router.refresh(),
          { success: t("timeOffSent") },
        );
      }}
    >
      <h3 className="font-medium">{t("requestTimeOff")}</h3>
      {blackouts.length > 0 && (
        <div className="rounded-md bg-muted p-2 text-sm" data-testid="blackout-notice">
          <p className="font-medium">{t("blackoutsTitle")}</p>
          <ul className="list-disc pl-5">
            {blackouts.map((b, i) => (
              <li key={i}>
                {b.start === b.end ? b.start : `${b.start} – ${b.end}`}: {b.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="to-type">{t("type")}</Label>
        <NativeSelect id="to-type" value={v.type} onChange={(e) => set("type")(e.target.value)}>
          {types.map((x) => (
            <option key={x} value={x}>
              {t.has(`types.${x}`) ? t(`types.${x}`) : x}
            </option>
          ))}
        </NativeSelect>
      </div>
      <SwitchField label={t("allDay")} checked={v.allDay} onChange={set("allDay")} />
      {v.allDay ? (
        <div className="grid grid-cols-2 gap-2">
          <TextField id="to-start" type="date" label={t("from")} value={v.startDate} onChange={set("startDate")} errors={fieldErrors.startDate} />
          <TextField id="to-end" type="date" label={t("to")} value={v.endDate} onChange={set("endDate")} errors={fieldErrors.endDate} />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <TextField id="to-date" type="date" label={t("date")} value={v.startDate} onChange={set("startDate")} errors={fieldErrors.startDate} />
          <TextField id="to-stime" type="time" label={t("fromTime")} value={v.startTime} onChange={set("startTime")} errors={fieldErrors.startTime} />
          <TextField id="to-etime" type="time" label={t("toTime")} value={v.endTime} onChange={set("endTime")} errors={fieldErrors.endTime} />
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="to-reason">{t("reason")}</Label>
        <Textarea id="to-reason" rows={2} value={v.reason} onChange={(e) => set("reason")(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="timeoff-error">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {t("send")}
      </Button>
    </form>
  );
}

const ORDER = [1, 2, 3, 4, 5, 6, 0];
type DayV = { kind: "all_day" | "between" | "unavailable"; start: string; end: string };

export function AvailabilityForm({ businessId, today, current }: { businessId: string; today: string; current: DayV[] }) {
  const t = useTranslations("requests");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [effectiveFrom, setFrom] = useState(today);
  const [days, setDays] = useState<DayV[]>(current);
  const setDay = (i: number, patch: Partial<DayV>) => setDays((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <form
      noValidate
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run<unknown>(
          () => submitAvailabilityAction(businessId, { effectiveFrom, days: days.map((d) => (d.kind === "between" ? d : { kind: d.kind })) }),
          () => router.refresh(),
          { success: t("availabilitySent") },
        );
      }}
    >
      <h3 className="font-medium">{t("myAvailability")}</h3>
      <ul className="space-y-2">
        {ORDER.map((i) => (
          <li key={i} className="grid grid-cols-[3rem_1fr] items-center gap-2">
            <span className="text-sm font-medium">{t(`weekdays.${i}`)}</span>
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect aria-label={t("availabilityFor", { day: t(`weekdays.${i}`) })} className="w-auto" value={days[i].kind} onChange={(e) => setDay(i, { kind: e.target.value as DayV["kind"] })}>
                <option value="all_day">{t("kinds.all_day")}</option>
                <option value="between">{t("kinds.between")}</option>
                <option value="unavailable">{t("kinds.unavailable")}</option>
              </NativeSelect>
              {days[i].kind === "between" && (
                <>
                  <input aria-label={t("fromTime")} type="time" className="h-11 rounded-md border px-2 md:h-9" value={days[i].start} onChange={(e) => setDay(i, { start: e.target.value })} />
                  <input aria-label={t("toTime")} type="time" className="h-11 rounded-md border px-2 md:h-9" value={days[i].end} onChange={(e) => setDay(i, { end: e.target.value })} />
                </>
              )}
            </div>
            <FieldError errors={fieldErrors[`days.${i}.end`]} />
          </li>
        ))}
      </ul>
      <TextField id="av-from" type="date" label={t("effectiveFrom")} value={effectiveFrom} onChange={setFrom} errors={fieldErrors.effectiveFrom} />
      <Button type="submit" disabled={pending}>
        {t("saveAvailability")}
      </Button>
    </form>
  );
}

/** Approve / deny with an optional note — used for time off, availability and trades. */
export function ReviewButtons({ businessId, kind, id }: { businessId: string; kind: "timeoff" | "availability" | "trade"; id: string }) {
  const t = useTranslations("requests");
  const router = useRouter();
  const { pending, run } = useAction();
  const [note, setNote] = useState("");
  const go = (approve: boolean) =>
    run<unknown>(
      () =>
        kind === "timeoff"
          ? reviewTimeOffAction(businessId, { id, approve, note })
          : kind === "availability"
            ? reviewAvailabilityAction(businessId, { requestId: id, approve, note })
            : reviewTradeAction(businessId, { id, approve, note }),
      () => router.refresh(),
      { success: approve ? t("approved") : t("denied") },
    );
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input aria-label={t("note")} placeholder={t("notePlaceholder")} className="h-11 min-w-0 flex-1 rounded-md border px-2 text-sm md:h-8" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="sm" disabled={pending} onClick={() => go(true)}>
        {t("approve")}
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => go(false)}>
        {t("deny")}
      </Button>
    </div>
  );
}
