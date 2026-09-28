"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAction } from "@/components/app/use-action";
import { dropShiftAction, proposeSwapAction, swapCandidatesAction } from "../requests/actions";

type Candidate = { id: string; who: string; date: string; start: string; end: string; position: string | null; location: string };

/** Drop or swap one of my published shifts (§6.3). */
export function ShiftTradeActions({ businessId, shiftId, pending }: { businessId: string; shiftId: string; pending: boolean }) {
  const t = useTranslations("requests");
  const router = useRouter();
  const { pending: busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);

  if (pending) return <span className="text-xs text-muted-foreground">{t("requestPending")}</span>;
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => run<unknown>(() => dropShiftAction(businessId, { id: shiftId }), () => router.refresh(), { success: t("dropped") })}>
        {t("drop")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setOpen(true);
          setCandidates(null);
          run(() => swapCandidatesAction(businessId, { id: shiftId }), (c) => setCandidates(c));
        }}
      >
        {t("swap")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("swapTitle")}</DialogTitle>
            <DialogDescription>{t("swapHint")}</DialogDescription>
          </DialogHeader>
          {candidates === null ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : candidates.length === 0 ? (
            <p className="text-sm">{t("noSwapCandidates")}</p>
          ) : (
            <ul className="space-y-2" data-testid="swap-candidates">
              {candidates.map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                  <span className="flex-1">
                    <span className="block font-medium">{c.who}</span>
                    <span className="block text-muted-foreground">
                      {c.date} {c.start}–{c.end} · {[c.position, c.location].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run<unknown>(
                        () => proposeSwapAction(businessId, { shiftId, swapShiftId: c.id }),
                        () => {
                          setOpen(false);
                          router.refresh();
                        },
                        { success: t("swapProposed") },
                      )
                    }
                  >
                    {t("propose")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
