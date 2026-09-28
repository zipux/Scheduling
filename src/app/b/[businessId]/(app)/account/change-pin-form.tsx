"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/app/field-error";
import { useAction } from "@/components/app/use-action";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import { changePinAction } from "./actions";

export function ChangePinForm({ businessId, hasPassword }: { businessId: string; hasPassword: boolean }) {
  const t = useTranslations("account");
  const pathname = usePathname();
  const { pending, fieldErrors, run } = useAction();
  const [currentPassword, setCurrentPassword] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");

  async function sendReauthLink() {
    const session = await authClient.getSession();
    const email = session.data?.user.email;
    if (!email) return;
    await authClient.signIn.magicLink({ email, callbackURL: pathname });
    toast.success(t("reauthSent"));
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => changePinAction(businessId, { currentPassword: currentPassword || undefined, pin, pinConfirm }),
          () => {
            setCurrentPassword("");
            setPin("");
            setPinConfirm("");
          },
          { success: t("pinChanged") },
        );
      }}
    >
      {hasPassword && (
        <div className="space-y-2">
          <Label htmlFor="currentPassword">{t("currentPassword")}</Label>
          <Input id="currentPassword" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          <FieldError errors={fieldErrors.currentPassword} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {hasPassword ? t("orReauth") : t("reauthOnly")}{" "}
        <button type="button" className="min-h-11 underline" onClick={sendReauthLink}>
          {t("sendReauthLink")}
        </button>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="newPin">{t("newPin")}</Label>
          <Input id="newPin" type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} />
          <FieldError errors={fieldErrors.pin} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="newPinConfirm">{t("repeatPin")}</Label>
          <Input id="newPinConfirm" type="password" inputMode="numeric" maxLength={6} value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value)} />
          <FieldError errors={fieldErrors.pinConfirm} />
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        {t("savePin")}
      </Button>
    </form>
  );
}
