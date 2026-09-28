"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/app/native-select";
import { TextField } from "@/components/app/form-fields";
import { useAction } from "@/components/app/use-action";
import { addEntryAction, editEntryAction, resolveFlagAction, reviewCorrectionAction } from "../clock/actions";

/** "YYYY-MM-DDTHH:mm" in the LOCATION's timezone for <input type="datetime-local">; the server converts back with the same timezone. */
function toLocalInput(iso: string | null, tz: string) {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
const fromLocalInput = (v: string) => (v ? v : null);

export function ResolveFlagButton({ businessId, flagId, label }: { businessId: string; flagId: string; label: string }) {
  const t = useTranslations("timeclock");
  const router = useRouter();
  const { pending, run } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <span className="flex items-center gap-1">
      <input aria-label={t("reason")} placeholder={t("reason")} className="h-11 w-40 rounded-md border px-2 text-sm md:h-8" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button size="sm" disabled={pending || reason.trim().length < 3} onClick={() => run(() => resolveFlagAction(businessId, { flagId, reason }), () => router.refresh(), { success: t("resolved") })}>
        {t("save")}
      </Button>
    </span>
  );
}

/** Edit an entry's times with a mandatory reason (§7.4). */
export function EntryEditor({ businessId, entry }: { businessId: string; entry: { id: string; clockIn: string | null; clockOut: string | null; tz: string } }) {
  const t = useTranslations("timeclock");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [open, setOpen] = useState(false);
  const [inV, setIn] = useState(toLocalInput(entry.clockIn, entry.tz));
  const [outV, setOut] = useState(toLocalInput(entry.clockOut, entry.tz));
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("editTimes")}
      </Button>
    );
  return (
    <form
      noValidate
      className="grid gap-2 rounded-md bg-muted/50 p-2 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => editEntryAction(businessId, { entryId: entry.id, clockIn: fromLocalInput(inV), clockOut: fromLocalInput(outV), reason }), () => {
          setOpen(false);
          router.refresh();
        }, { success: t("saved") });
      }}
    >
      <TextField id={`in-${entry.id}`} type="datetime-local" label={t("clockIn")} value={inV} onChange={setIn} errors={fieldErrors.clockIn} />
      <TextField id={`out-${entry.id}`} type="datetime-local" label={t("clockOut")} value={outV} onChange={setOut} errors={fieldErrors.clockOut} />
      <TextField id={`r-${entry.id}`} label={t("reason")} value={reason} onChange={setReason} errors={fieldErrors.reason} />
      <Button type="submit" disabled={pending}>
        {t("save")}
      </Button>
    </form>
  );
}

export function AddEntryForm({ businessId, people, locations }: { businessId: string; people: { id: string; name: string }[]; locations: { id: string; name: string }[] }) {
  const t = useTranslations("timeclock");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [v, setV] = useState({ membershipId: people[0]?.id ?? "", locationId: locations[0]?.id ?? "", clockIn: "", clockOut: "", reason: "" });
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <form
      noValidate
      className="space-y-2 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run<unknown>(
          () => addEntryAction(businessId, { membershipId: v.membershipId, locationId: v.locationId, clockIn: v.clockIn, clockOut: v.clockOut, reason: v.reason }),
          () => {
            setV((s) => ({ ...s, clockIn: "", clockOut: "", reason: "" }));
            router.refresh();
          },
          { success: t("added") },
        );
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="ae-person">{t("person")}</Label>
          <NativeSelect id="ae-person" value={v.membershipId} onChange={(e) => set("membershipId")(e.target.value)}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ae-loc">{t("location")}</Label>
          <NativeSelect id="ae-loc" value={v.locationId} onChange={(e) => set("locationId")(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <TextField id="ae-in" type="datetime-local" label={t("clockIn")} value={v.clockIn} onChange={set("clockIn")} errors={fieldErrors.clockIn} />
        <TextField id="ae-out" type="datetime-local" label={t("clockOut")} value={v.clockOut} onChange={set("clockOut")} errors={fieldErrors.clockOut} />
      </div>
      <TextField id="ae-reason" label={t("reason")} value={v.reason} onChange={set("reason")} errors={fieldErrors.reason} />
      <Button type="submit" disabled={pending}>
        {t("addEntry")}
      </Button>
    </form>
  );
}

export function CorrectionReview({ businessId, id, proposedIn, proposedOut, tz }: { businessId: string; id: string; proposedIn: string | null; proposedOut: string | null; tz: string }) {
  const t = useTranslations("timeclock");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [inV, setIn] = useState(toLocalInput(proposedIn, tz));
  const [outV, setOut] = useState(toLocalInput(proposedOut, tz));
  const [reason, setReason] = useState("");
  const go = (approve: boolean) =>
    run(
      () => reviewCorrectionAction(businessId, { id, approve, clockIn: inV ? fromLocalInput(inV) : undefined, clockOut: outV ? fromLocalInput(outV) : undefined, reason }),
      () => router.refresh(),
      { success: approve ? t("confirmedDone") : t("deniedDone") },
    );
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr] sm:items-end">
      <TextField id={`cr-in-${id}`} type="datetime-local" label={t("clockIn")} value={inV} onChange={setIn} />
      <TextField id={`cr-out-${id}`} type="datetime-local" label={t("clockOut")} value={outV} onChange={setOut} />
      <TextField id={`cr-r-${id}`} label={t("reason")} value={reason} onChange={setReason} errors={fieldErrors.reason} />
      <div className="flex gap-2 sm:col-span-3">
        <Button size="sm" disabled={pending} onClick={() => go(true)}>
          {t("confirmCorrection")}
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => go(false)}>
          {t("deny")}
        </Button>
      </div>
    </div>
  );
}
