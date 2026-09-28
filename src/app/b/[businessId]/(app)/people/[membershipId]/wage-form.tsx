"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/app/native-select";
import { TextField } from "@/components/app/form-fields";
import { FieldError } from "@/components/app/field-error";
import { useAction } from "@/components/app/use-action";
import { parseMoneyToCents } from "@/lib/money";
import { addWageAction } from "../actions";

export function WageForm(props: { businessId: string; membershipId: string; currency: string; positions: { id: string; name: string }[] }) {
  const t = useTranslations("wages");
  const router = useRouter();
  const { pending, fieldErrors, run, setFieldErrors } = useAction();
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"hourly" | "salary">("hourly");
  const [positionId, setPositionId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  return (
    <form
      noValidate
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const cents = parseMoneyToCents(amount);
        if (cents === null || Number.isNaN(cents)) return setFieldErrors({ rateCents: [t("amountInvalid")] });
        run(
          () =>
            addWageAction(props.businessId, {
              membershipId: props.membershipId,
              rateCents: cents,
              type,
              positionId: type === "salary" ? null : positionId || null,
              effectiveFrom,
            }),
          () => {
            setAmount("");
            router.refresh();
          },
          { success: t("added") },
        );
      }}
    >
      <p className="text-sm text-muted-foreground">{t("appendOnly")}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="wage-type">{t("type")}</Label>
          <NativeSelect id="wage-type" value={type} onChange={(e) => setType(e.target.value as "hourly" | "salary")}>
            <option value="hourly">{t("hourly")}</option>
            <option value="salary">{t("salary")}</option>
          </NativeSelect>
        </div>
        <TextField
          id="wage-amount"
          label={type === "hourly" ? t("hourlyAmount", { currency: props.currency }) : t("salaryAmount", { currency: props.currency })}
          inputMode="decimal"
          value={amount}
          onChange={setAmount}
          errors={fieldErrors.rateCents}
        />
      </div>
      {type === "hourly" && (
        <div className="space-y-1">
          <Label htmlFor="wage-position">{t("position")}</Label>
          <NativeSelect id="wage-position" value={positionId} onChange={(e) => setPositionId(e.target.value)}>
            <option value="">{t("allPositions")}</option>
            {props.positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
          <FieldError errors={fieldErrors.positionId} />
        </div>
      )}
      <TextField id="wage-from" type="date" label={t("effectiveFrom")} hint={t("effectiveHint")} value={effectiveFrom} onChange={setEffectiveFrom} errors={fieldErrors.effectiveFrom} />
      <Button type="submit" disabled={pending}>
        {t("add")}
      </Button>
    </form>
  );
}
