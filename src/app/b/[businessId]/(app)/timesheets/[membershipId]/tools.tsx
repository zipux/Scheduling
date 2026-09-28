"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TextField } from "@/components/app/form-fields";
import { useAction } from "@/components/app/use-action";
import { parseMoneyToCents } from "@/lib/money";
import { adjustVacationAction, approveTimesheetAction, overrideEntitlementAction, reopenTimesheetAction } from "../actions";

export function ApprovePanel(props: { businessId: string; membershipId: string; periodStart: string; isOwner: boolean; blockingCount: number; blocked: boolean; canFinal: boolean }) {
  const t = useTranslations("timesheets");
  const router = useRouter();
  const { pending, error, run } = useAction();
  const [withExceptions, setWithExceptions] = useState(false);
  const approve = (final: boolean) =>
    run<unknown>(() => approveTimesheetAction(props.businessId, { membershipId: props.membershipId, periodStart: props.periodStart, withExceptions, final }), () => router.refresh(), {
      success: t("approvedDone"),
    });
  const gated = props.blocked || (props.blockingCount > 0 && !(props.isOwner && withExceptions));
  return (
    <div className="space-y-3 rounded-lg border p-3" data-testid="approve-panel">
      {props.blockingCount > 0 && !props.blocked && (
        <p className="text-sm">{props.isOwner ? t("ownerExceptionsHint", { count: props.blockingCount }) : t("managerBlockedHint", { count: props.blockingCount })}</p>
      )}
      {props.isOwner && props.blockingCount > 0 && !props.blocked && (
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <Checkbox className="size-5" checked={withExceptions} onCheckedChange={(c) => setWithExceptions(!!c)} />
          {t("withExceptions")}
        </label>
      )}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending || gated} onClick={() => approve(false)}>
          {t("approve")}
        </Button>
        {props.canFinal && (
          <Button variant="outline" disabled={pending || gated} onClick={() => approve(true)}>
            {t("finalTimesheet")}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("approveHint")}</p>
    </div>
  );
}

export function ReopenForm({ businessId, membershipId, periodStart }: { businessId: string; membershipId: string; periodStart: string }) {
  const t = useTranslations("timesheets");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [reason, setReason] = useState("");
  return (
    <form
      noValidate
      className="flex flex-wrap items-end gap-2 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => reopenTimesheetAction(businessId, { membershipId, periodStart, reason }), () => router.refresh(), { success: t("reopened") });
      }}
    >
      <div className="min-w-0 flex-1">
        <TextField id="reopen-reason" label={t("reopenReason")} value={reason} onChange={setReason} errors={fieldErrors.reason} />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {t("reopen")}
      </Button>
    </form>
  );
}

export function VacationAdjust({ businessId, membershipId, currency }: { businessId: string; membershipId: string; currency: string }) {
  const t = useTranslations("timesheets");
  const router = useRouter();
  const { pending, fieldErrors, run, setFieldErrors } = useAction();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  return (
    <form
      noValidate
      className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const neg = amount.trim().startsWith("-");
        const c = parseMoneyToCents(amount.replace("-", ""));
        if (c === null || Number.isNaN(c)) return setFieldErrors({ amountCents: [t("amountInvalid")] });
        run(() => adjustVacationAction(businessId, { membershipId, amountCents: neg ? -c : c, reason }), () => {
          setAmount("");
          setReason("");
          router.refresh();
        }, { success: t("adjusted") });
      }}
    >
      <TextField id="vac-amt" label={t("adjustAmount", { currency })} inputMode="decimal" value={amount} onChange={setAmount} errors={fieldErrors.amountCents} placeholder="-120.00" />
      <TextField id="vac-reason" label={t("adjustReason")} value={reason} onChange={setReason} errors={fieldErrors.reason} />
      <Button type="submit" variant="outline" disabled={pending}>
        {t("adjust")}
      </Button>
    </form>
  );
}

export function EntitlementOverride({ businessId, holidayId, membershipId, overridden }: { businessId: string; holidayId: string; membershipId: string; overridden: boolean }) {
  const t = useTranslations("timesheets");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [reason, setReason] = useState("");
  const go = (eligible: boolean | null) => run(() => overrideEntitlementAction(businessId, { holidayId, membershipId, eligible, reason }), () => router.refresh(), { success: t("saved") });
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      {overridden ? (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => go(null)}>
          {t("clearOverride")}
        </Button>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <TextField id={`ovr-${holidayId}`} label={t("overrideReason")} value={reason} onChange={setReason} errors={fieldErrors.reason} />
          </div>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => go(true)}>
            {t("markEligible")}
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => go(false)}>
            {t("markIneligible")}
          </Button>
        </>
      )}
    </div>
  );
}
