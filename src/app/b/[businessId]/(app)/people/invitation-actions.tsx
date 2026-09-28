"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/app/field-error";
import { useAction } from "@/components/app/use-action";
import { resendInvitationAction, revokeInvitationAction } from "./actions";

export function InvitationActions(props: { businessId: string; invitationId: string; email: string; failed: boolean }) {
  const t = useTranslations("people");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(props.email);
  const done = () => {
    setEditing(false);
    router.refresh();
  };

  if (editing) {
    return (
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => resendInvitationAction(props.businessId, { invitationId: props.invitationId, email }), done, { success: t("resent") });
        }}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={`email-${props.invitationId}`}>{t("email")}</Label>
          <Input id={`email-${props.invitationId}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <FieldError errors={fieldErrors.email} />
        </div>
        <Button type="submit" disabled={pending}>
          {t("saveAndResend")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
          {t("cancel")}
        </Button>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {props.failed ? (
        <Button size="sm" variant="default" onClick={() => setEditing(true)}>
          {t("editAndResend")}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => resendInvitationAction(props.businessId, { invitationId: props.invitationId }), done, { success: t("resent") })}
        >
          {t("resend")}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => run(() => revokeInvitationAction(props.businessId, { invitationId: props.invitationId }), done, { success: t("revoked") })}
      >
        {t("revoke")}
      </Button>
    </div>
  );
}
