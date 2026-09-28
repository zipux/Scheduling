"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { TextField } from "@/components/app/form-fields";
import { FieldError } from "@/components/app/field-error";
import { useAction } from "@/components/app/use-action";
import { entryHistoryAction, requestCorrectionAction } from "./actions";

type Audit = { id: string; action: string; reason: string; at: string; before: unknown; after: unknown };

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

/** An employee can see the full edit history of their own entries (§7.4). */
export function HistoryButton({ businessId, entryId }: { businessId: string; entryId: string }) {
  const t = useTranslations("clock");
  const { pending, run } = useAction();
  const [rows, setRows] = useState<Audit[] | null>(null);
  return (
    <>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => entryHistoryAction(businessId, { id: entryId }), (r) => setRows(r))}>
        {t("history")}
      </Button>
      <Dialog open={rows !== null} onOpenChange={(o) => !o && setRows(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("history")}</DialogTitle>
          </DialogHeader>
          {rows?.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noHistory")}</p>
          ) : (
            <ol className="space-y-3 text-sm" data-testid="entry-history">
              {rows?.map((a) => {
                const b = (a.before ?? {}) as { clockIn?: string; clockOut?: string };
                const af = (a.after ?? {}) as { clockIn?: string; clockOut?: string };
                return (
                  <li key={a.id} className="rounded-md border p-2">
                    <p className="font-medium">
                      {fmt(a.at)} · {t(`audit.${a.action}`)}
                    </p>
                    {a.action !== "resolve_flag" && (
                      <p>
                        {fmt(b.clockIn)} → {fmt(b.clockOut)} ⟶ {fmt(af.clockIn)} → {fmt(af.clockOut)}
                      </p>
                    )}
                    <p className="text-muted-foreground">“{a.reason}”</p>
                  </li>
                );
              })}
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "I forgot to clock out at 22:00" → a correction request to approvers; never a punch. */
export function CorrectionForm({ businessId, entryId, date }: { businessId: string; entryId: string | null; date: string }) {
  const t = useTranslations("clock");
  const router = useRouter();
  const { pending, fieldErrors, run } = useAction();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState(date);
  const [inT, setIn] = useState("");
  const [outT, setOut] = useState("");
  const [message, setMessage] = useState("");
  const iso = (time: string) => (time ? `${d}T${time}` : null);
  return (
    <>
      <Button size="sm" variant={entryId ? "ghost" : "outline"} onClick={() => setOpen(true)}>
        {entryId ? t("requestCorrection") : t("missingShift")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{entryId ? t("requestCorrection") : t("missingShift")}</DialogTitle>
          </DialogHeader>
          <form
            noValidate
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              run<unknown>(
                () => requestCorrectionAction(businessId, { timeEntryId: entryId, proposedClockIn: iso(inT), proposedClockOut: iso(outT), message }),
                () => {
                  setOpen(false);
                  router.refresh();
                },
                { success: t("correctionSent") },
              );
            }}
          >
            <p className="text-sm text-muted-foreground">{t("correctionHint")}</p>
            <TextField id={`c-date-${entryId}`} type="date" label={t("date")} value={d} onChange={setD} />
            <div className="grid grid-cols-2 gap-2">
              <TextField id={`c-in-${entryId}`} type="time" label={t("actualIn")} value={inT} onChange={setIn} errors={fieldErrors.proposedClockIn} />
              <TextField id={`c-out-${entryId}`} type="time" label={t("actualOut")} value={outT} onChange={setOut} errors={fieldErrors.proposedClockOut} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`c-msg-${entryId}`}>{t("whatHappened")}</Label>
              <Textarea id={`c-msg-${entryId}`} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
              <FieldError errors={fieldErrors.message} />
            </div>
            <Button type="submit" disabled={pending}>
              {t("send")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
