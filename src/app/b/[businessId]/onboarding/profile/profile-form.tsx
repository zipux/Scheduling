"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/app/field-error";
import { useAction } from "@/components/app/use-action";
import { completeProfileAction } from "../actions";

const FIELDS = [
  "phone",
  "dateOfBirth",
  "address",
  "emergencyContactName",
  "emergencyContactRelation",
  "emergencyContactPhone",
  "pin",
  "pinConfirm",
] as const;
type Field = (typeof FIELDS)[number];

export function ProfileForm({ businessId }: { businessId: string }) {
  const t = useTranslations("profile");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [v, setV] = useState<Record<Field, string>>(
    Object.fromEntries(FIELDS.map((f) => [f, ""])) as Record<Field, string>,
  );
  const bind = (f: Field) => ({
    id: f,
    name: f,
    value: v[f],
    "aria-invalid": fieldErrors[f] ? true : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [f]: e.target.value })),
  });

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => completeProfileAction(businessId, v),
          () => {
            router.replace(`/b/${businessId}`);
            router.refresh();
          },
        );
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="phone">{t("phone")}</Label>
        <Input {...bind("phone")} type="tel" inputMode="tel" autoComplete="tel" placeholder="+1 416 555 0100" />
        <FieldError errors={fieldErrors.phone} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="dateOfBirth">{t("dateOfBirth")}</Label>
        <Input {...bind("dateOfBirth")} type="date" autoComplete="bday" />
        <FieldError errors={fieldErrors.dateOfBirth} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="address">{t("address")}</Label>
        <Input {...bind("address")} autoComplete="street-address" />
        <FieldError errors={fieldErrors.address} />
      </div>
      <fieldset className="space-y-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">{t("emergencyContact")}</legend>
        <div className="space-y-2">
          <Label htmlFor="emergencyContactName">{t("ecName")}</Label>
          <Input {...bind("emergencyContactName")} autoComplete="off" />
          <FieldError errors={fieldErrors.emergencyContactName} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="emergencyContactRelation">{t("ecRelation")}</Label>
          <Input {...bind("emergencyContactRelation")} autoComplete="off" />
          <FieldError errors={fieldErrors.emergencyContactRelation} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="emergencyContactPhone">{t("ecPhone")}</Label>
          <Input {...bind("emergencyContactPhone")} type="tel" inputMode="tel" autoComplete="off" />
          <FieldError errors={fieldErrors.emergencyContactPhone} />
        </div>
      </fieldset>
      <fieldset className="space-y-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">{t("pinTitle")}</legend>
        <p className="text-sm text-muted-foreground">{t("pinHint")}</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="pin">{t("pin")}</Label>
            <Input {...bind("pin")} type="password" inputMode="numeric" autoComplete="off" maxLength={6} pattern="\d*" />
            <FieldError errors={fieldErrors.pin} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pinConfirm">{t("pinConfirm")}</Label>
            <Input {...bind("pinConfirm")} type="password" inputMode="numeric" autoComplete="off" maxLength={6} pattern="\d*" />
            <FieldError errors={fieldErrors.pinConfirm} />
          </div>
        </div>
      </fieldset>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {t("save")}
      </Button>
    </form>
  );
}
