"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/app/use-action";
import { cancelAccountDeletionAction, requestAccountDeletionAction } from "./actions";

export function DeleteAccount({ requestedOn }: { requestedOn: string | null }) {
  const t = useTranslations("account");
  const router = useRouter();
  const { pending, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const refresh = () => {
    setConfirming(false);
    router.refresh();
  };

  if (requestedOn)
    return (
      <div className="space-y-2" data-testid="deletion-requested">
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{t("deletionRequested", { date: requestedOn })}</p>
        <Button variant="outline" disabled={pending} onClick={() => run(() => cancelAccountDeletionAction(), refresh, { success: t("deletionCancelled") })}>
          {t("cancelDeletion")}
        </Button>
      </div>
    );

  if (!confirming)
    return (
      <Button variant="destructive" onClick={() => setConfirming(true)}>
        {t("requestDeletion")}
      </Button>
    );

  return (
    <div className="space-y-3 rounded-lg border border-destructive/40 p-3" role="group" aria-labelledby="confirm-deletion">
      <p id="confirm-deletion" className="text-sm">
        {t("confirmDeletion")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="destructive" disabled={pending} onClick={() => run(() => requestAccountDeletionAction(), refresh, { success: t("deletionSent") })}>
          {t("confirmDeletionButton")}
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => setConfirming(false)}>
          {t("keepAccount")}
        </Button>
      </div>
    </div>
  );
}
