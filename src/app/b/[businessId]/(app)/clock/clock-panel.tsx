"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CloudOff, Coffee, LogIn, LogOut, MapPinOff, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { currentPosition, dequeue, enqueue, lastFix, queued } from "@/components/app/punch-queue";
import { punchAction, requestCorrectionAction, syncOfflinePunchAction, type PunchResult } from "./actions";

type Action = "in" | "break_start" | "break_end" | "out";

export interface ClockState {
  clockedIn: boolean;
  onBreak: boolean;
  since: string | null;
  needsPreviousFinish: { entryId: string; clockIn: string; clockInLabel: string; date: string } | null;
  staleAnswered: boolean;
  nextShiftLabel: string | null;
}

export function ClockPanel({ businessId, state }: { businessId: string; state: ClockState }) {
  const t = useTranslations("clock");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [finishDate, setFinishDate] = useState(state.needsPreviousFinish?.date ?? "");
  const [finishTime, setFinishTime] = useState("");

  const sync = useCallback(async () => {
    const list = queued(businessId);
    for (const p of list) {
      try {
        const r = await syncOfflinePunchAction(businessId, { action: p.action, position: p.position, deviceTime: p.deviceTime });
        dequeue(businessId, p.id);
        if (!r.ok) toast.error(t("syncFailed", { error: r.error }));
        else toast.success(t("synced"));
      } catch {
        break; // still offline
      }
    }
    setQueuedCount(queued(businessId).length);
    router.refresh();
  }, [businessId, router, t]);

  useEffect(() => {
    // Sync on page load and whenever the connection comes back.
    const initial = setTimeout(() => {
      setQueuedCount(queued(businessId).length);
      if (navigator.onLine && queued(businessId).length) void sync();
    }, 0);
    window.addEventListener("online", sync);
    return () => {
      clearTimeout(initial);
      window.removeEventListener("online", sync);
    };
  }, [businessId, sync]);

  function doPunch(action: Action) {
    setError(null);
    start(async () => {
      const needsFix = action === "in" || action === "out";
      const { fix, denied } = needsFix ? await currentPosition() : { fix: null, denied: false };
      const queueIt = () => {
        enqueue(businessId, { action, deviceTime: new Date().toISOString(), position: fix ?? lastFix() });
        setQueuedCount(queued(businessId).length);
        setPin("");
        toast.message(t("queuedOffline"));
      };
      if (!navigator.onLine) return queueIt();
      let r: PunchResult;
      try {
        r = await punchAction(businessId, { action, pin, position: fix });
      } catch {
        return queueIt();
      }
      if (!r.ok) {
        setError({ text: denied && r.code === "GEO_NO_POSITION" ? t("locationDenied") : r.error, code: r.code });
        if (r.code === "PIN_WRONG" || r.code === "PIN_LOCKED") setPin("");
        return;
      }
      setPin("");
      toast.success(t(`done.${action}`));
      if (r.data.flags.length) toast.message(t("flagged", { flags: r.data.flags.join(", ") }));
      router.refresh();
    });
  }

  function answerPrevious() {
    if (!state.needsPreviousFinish || !finishDate || !finishTime) return;
    start(async () => {
      const r = await requestCorrectionAction(businessId, {
        timeEntryId: state.needsPreviousFinish!.entryId,
        proposedClockIn: null,
        proposedClockOut: `${finishDate}T${finishTime}`,
        message: t("forgotMessage"),
      });
      if (!r.ok) return setError({ text: r.error });
      toast.success(t("answerSent"));
      router.refresh();
    });
  }

  if (state.needsPreviousFinish) {
    return (
      <div className="max-w-md space-y-4" data-testid="previous-finish">
        <Alert>
          <AlertTitle>{t("previousTitle")}</AlertTitle>
          <AlertDescription>{t("previousBody", { since: state.needsPreviousFinish.clockInLabel })}</AlertDescription>
        </Alert>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="pf-date">{t("finishDate")}</Label>
            <Input id="pf-date" type="date" value={finishDate} onChange={(e) => setFinishDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pf-time">{t("finishTime")}</Label>
            <Input id="pf-time" type="time" value={finishTime} onChange={(e) => setFinishTime(e.target.value)} />
          </div>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error.text}</p>}
        <Button size="lg" className="w-full" disabled={pending || !finishTime} onClick={answerPrevious}>
          {t("sendFinish")}
        </Button>
        <p className="text-xs text-muted-foreground">{t("previousHint")}</p>
      </div>
    );
  }

  const actions: { action: Action; label: string; icon: typeof LogIn; primary?: boolean }[] = !state.clockedIn
    ? [{ action: "in", label: t("clockIn"), icon: LogIn, primary: true }]
    : state.onBreak
      ? [{ action: "break_end", label: t("endBreak"), icon: Play, primary: true }, { action: "out", label: t("clockOut"), icon: LogOut }]
      : [{ action: "out", label: t("clockOut"), icon: LogOut, primary: true }, { action: "break_start", label: t("startBreak"), icon: Coffee }];

  return (
    <div className="max-w-md space-y-4" data-testid="clock-panel">
      <div className="rounded-xl border p-4 text-center" role="status" data-testid="clock-status">
        <p className="text-sm text-muted-foreground">{t("status")}</p>
        <p className="text-2xl font-semibold">{state.clockedIn ? (state.onBreak ? t("onBreak") : t("clockedIn")) : t("clockedOut")}</p>
        {state.since && <p className="text-sm text-muted-foreground">{t("since", { time: state.since })}</p>}
        {!state.clockedIn && state.nextShiftLabel && <p className="mt-1 text-sm">{t("nextShift", { shift: state.nextShiftLabel })}</p>}
      </div>
      {queuedCount > 0 && (
        <Alert data-testid="offline-queue">
          <CloudOff aria-hidden />
          <AlertDescription>{t("queuedCount", { count: queuedCount })}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-1">
        <Label htmlFor="pin">{t("pin")}</Label>
        <Input
          id="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          className="h-14 text-center text-2xl tracking-[0.5em]"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />
      </div>
      {error && (
        <Alert variant="destructive" data-testid="clock-error">
          {error.code?.startsWith("GEO") && <MapPinOff aria-hidden />}
          <AlertDescription>{error.text}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-2">
        {actions.map((a) => (
          <Button key={a.action} size="lg" variant={a.primary ? "default" : "outline"} className="h-14 text-base" disabled={pending || pin.length < 4} onClick={() => doPunch(a.action)}>
            <a.icon aria-hidden />
            {a.label}
          </Button>
        ))}
        {!state.clockedIn && (
          <Button variant="ghost" size="sm" disabled={pending || pin.length < 4} onClick={() => doPunch("out")}>
            {t("forgotIn")}
          </Button>
        )}
      </div>
      {state.staleAnswered && <p className="text-xs text-muted-foreground">{t("staleAnswered")}</p>}
      <p className="text-xs text-muted-foreground">{t("locationNote")}</p>
    </div>
  );
}
