"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/app/native-select";
import { TextField } from "@/components/app/form-fields";
import { useAction } from "@/components/app/use-action";
import { enrolKioskAction } from "../actions";

type Option = { businessId: string; businessName: string; locations: { id: string; name: string }[] };

export function EnrolForm({ options }: { options: Option[] }) {
  const t = useTranslations("kiosk");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [businessId, setBusiness] = useState(options[0].businessId);
  const biz = options.find((o) => o.businessId === businessId)!;
  const [locationId, setLocation] = useState(biz.locations[0]?.id ?? "");
  const [name, setName] = useState("Front counter tablet");
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => enrolKioskAction(businessId, { locationId, name }), () => {
          router.replace("/kiosk");
          router.refresh();
        });
      }}
    >
      {options.length > 1 && (
        <div className="space-y-1">
          <Label htmlFor="k-biz">{t("business")}</Label>
          <NativeSelect
            id="k-biz"
            value={businessId}
            onChange={(e) => {
              setBusiness(e.target.value);
              setLocation(options.find((o) => o.businessId === e.target.value)?.locations[0]?.id ?? "");
            }}
          >
            {options.map((o) => (
              <option key={o.businessId} value={o.businessId}>
                {o.businessName}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="k-loc">{t("location")}</Label>
        <NativeSelect id="k-loc" value={locationId} onChange={(e) => setLocation(e.target.value)}>
          {biz.locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <TextField id="k-name" label={t("deviceName")} value={name} onChange={setName} errors={fieldErrors.name} />
      <p className="text-sm text-muted-foreground">{t("enrolWarning")}</p>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {t("enrol")}
      </Button>
    </form>
  );
}
