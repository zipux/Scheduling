"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/app/native-select";
import { FieldError } from "@/components/app/field-error";
import { useAction } from "@/components/app/use-action";
import { inviteAction } from "../actions";
import { parseMoneyToCents } from "@/lib/money";

type Opt = { id: string; name: string };

function CheckList({ legend, options, value, onChange }: { legend: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void }) {
  if (!options.length) return null;
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {options.map((o) => (
        <label key={o.id} className="flex min-h-11 items-center gap-3">
          <Checkbox
            className="size-5"
            checked={value.includes(o.id)}
            onCheckedChange={(c) => onChange(c ? [...value, o.id] : value.filter((x) => x !== o.id))}
          />
          {o.name}
        </label>
      ))}
    </fieldset>
  );
}

export function InviteForm(props: {
  businessId: string;
  roles: Opt[];
  locations: Opt[];
  positions: Opt[];
  canSetWage: boolean;
  currency: string;
}) {
  const t = useTranslations("people");
  const router = useRouter();
  const { pending, fieldErrors, run, setFieldErrors } = useAction();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState(props.roles.at(-1)?.id ?? "");
  const [locationIds, setLocationIds] = useState<string[]>(props.locations.length === 1 ? [props.locations[0].id] : []);
  const [positionIds, setPositionIds] = useState<string[]>([]);
  const [wage, setWage] = useState("");
  const [hireDate, setHireDate] = useState("");

  return (
    <form
      noValidate
      className="max-w-lg space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const wageCents = parseMoneyToCents(wage);
        if (Number.isNaN(wageCents)) return setFieldErrors({ wageCents: [t("wageInvalid")] });
        run(
          () =>
            inviteAction(props.businessId, {
              name,
              email,
              roleId,
              locationIds,
              positionIds,
              wageCents: wageCents,
              hireDate: hireDate || null,
            }),
          () => router.push(`/b/${props.businessId}/people`),
          { success: t("invited") },
        );
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="name">{t("name")}</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <FieldError errors={fieldErrors.name} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        <FieldError errors={fieldErrors.email} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="role">{t("role")}</Label>
        <NativeSelect id="role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          {props.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </NativeSelect>
        <FieldError errors={fieldErrors.roleId} />
      </div>
      <CheckList legend={t("locations")} options={props.locations} value={locationIds} onChange={setLocationIds} />
      <CheckList legend={t("positions")} options={props.positions} value={positionIds} onChange={setPositionIds} />
      <div className="grid grid-cols-2 gap-3">
        {props.canSetWage && (
          <div className="space-y-2">
            <Label htmlFor="wage">{t("hourlyWage", { currency: props.currency })}</Label>
            <Input id="wage" inputMode="decimal" value={wage} onChange={(e) => setWage(e.target.value)} placeholder="18.50" />
            <FieldError errors={fieldErrors.wageCents} />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="hireDate">{t("hireDate")}</Label>
          <Input id="hireDate" type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} />
        </div>
      </div>
      <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
        {t("sendInvitation")}
      </Button>
    </form>
  );
}
