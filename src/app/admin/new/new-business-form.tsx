"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/app/native-select";
import { FieldError } from "@/components/app/field-error";
import { createBusinessAction } from "../actions";

export function NewBusinessForm(props: {
  countries: { code: string; name: string }[];
  regions: Record<string, { code: string; name: string }[]>;
  timezones: string[];
  currencies: string[];
}) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState({
    name: "",
    country: "CA",
    region: "ON",
    timezone: "America/Toronto",
    currency: "CAD",
    ownerName: "",
    ownerEmail: "",
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV((s) => ({ ...s, [k]: e.target.value }));

  return (
    <form
      noValidate
      className="max-w-lg space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await createBusinessAction(v as never);
          if (!res.ok) {
            setErrors(res.fieldErrors ?? {});
            toast.error(res.error);
            return;
          }
          toast.success(t("created"));
          router.push(`/admin/businesses/${res.data.id}`);
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="name">{t("businessName")}</Label>
        <Input id="name" value={v.name} onChange={set("name")} />
        <FieldError errors={errors.name} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="country">{t("country")}</Label>
          <NativeSelect
            id="country"
            value={v.country}
            onChange={(e) => setV((s) => ({ ...s, country: e.target.value, region: props.regions[e.target.value]?.[0]?.code ?? "" }))}
          >
            {props.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="region">{t("region")}</Label>
          <NativeSelect id="region" value={v.region} onChange={set("region")}>
            {(props.regions[v.country] ?? []).map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
          <FieldError errors={errors.region} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="timezone">{t("timezone")}</Label>
          <NativeSelect id="timezone" value={v.timezone} onChange={set("timezone")}>
            {props.timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="currency">{t("currency")}</Label>
          <NativeSelect id="currency" value={v.currency} onChange={set("currency")}>
            {props.currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <fieldset className="space-y-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">{t("owner")}</legend>
        <div className="space-y-2">
          <Label htmlFor="ownerName">{t("ownerName")}</Label>
          <Input id="ownerName" autoComplete="off" value={v.ownerName} onChange={set("ownerName")} />
          <FieldError errors={errors.ownerName} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ownerEmail">{t("ownerEmail")}</Label>
          <Input id="ownerEmail" type="email" autoComplete="off" value={v.ownerEmail} onChange={set("ownerEmail")} />
          <FieldError errors={errors.ownerEmail} />
        </div>
      </fieldset>
      <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
        {t("createAndInvite")}
      </Button>
    </form>
  );
}
