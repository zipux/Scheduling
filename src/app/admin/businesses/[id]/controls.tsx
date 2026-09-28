"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/app/native-select";
import { resendOwnerInviteAction, updateStatusAction } from "../../actions";

export function BusinessStatusControls(props: { businessId: string; subscriptionStatus: string; suspended: boolean }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (input: Parameters<typeof updateStatusAction>[0]) =>
    start(async () => {
      const res = await updateStatusAction(input);
      if (!res.ok) return void toast.error(res.error);
      toast.success(t("saved"));
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-2">
        <Label htmlFor="sub">{t("subscriptionLabel")}</Label>
        <NativeSelect
          id="sub"
          className="w-48"
          defaultValue={props.subscriptionStatus}
          disabled={pending}
          onChange={(e) => run({ businessId: props.businessId, subscriptionStatus: e.target.value as never })}
        >
          {(["trial", "active", "past_due", "cancelled"] as const).map((s) => (
            <option key={s} value={s}>
              {t(`subscription.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button
        variant={props.suspended ? "default" : "destructive"}
        disabled={pending}
        onClick={() => run({ businessId: props.businessId, suspended: !props.suspended })}
      >
        {props.suspended ? t("reactivate") : t("suspend")}
      </Button>
    </div>
  );
}

export function ResendOwnerInvite({ businessId, invitationId }: { businessId: string; invitationId: string }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await resendOwnerInviteAction(businessId, invitationId);
          if (!res.ok) return void toast.error(res.error);
          toast.success(t("resent"));
          router.refresh();
        })
      }
    >
      {t("resend")}
    </Button>
  );
}
