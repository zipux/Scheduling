"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/app/field-error";
import { useAction } from "@/components/app/use-action";
import { setInitialPinAction } from "../actions";

export function PinForm({ businessId }: { businessId: string }) {
  const t = useTranslations("profile");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setInitialPinAction(businessId, { pin, pinConfirm }), () => {
          router.replace(`/b/${businessId}`);
          router.refresh();
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="pin">{t("pin")}</Label>
          <Input id="pin" type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} />
          <FieldError errors={fieldErrors.pin} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pinConfirm">{t("pinConfirm")}</Label>
          <Input id="pinConfirm" type="password" inputMode="numeric" maxLength={6} value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value)} />
          <FieldError errors={fieldErrors.pinConfirm} />
        </div>
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {t("save")}
      </Button>
    </form>
  );
}
