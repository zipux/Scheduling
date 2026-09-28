"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Delete, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exitKioskAction, kioskIdentifyAction, kioskPunchAction } from "./actions";

type Person = { id: string; name: string };
type Step = { kind: "list" } | { kind: "pin"; person: Person; exit?: boolean } | { kind: "actions"; person: Person; ticket: string; clockedIn: boolean; onBreak: boolean; needsPreviousFinish: boolean };

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  return <span className="tabular-nums">{now ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>;
}

/** Shared tablet at the location: tap your name, enter your PIN, punch (§7.1). */
export function KioskScreen({ deviceName, location, staff }: { deviceName: string; location: string; staff: Person[] }) {
  const t = useTranslations("kiosk");
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "list" });
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, start] = useTransition();

  // Return to the name list after inactivity, so the next person never sees someone else's screen.
  useEffect(() => {
    if (step.kind === "list") return;
    const id = setTimeout(() => {
      setStep({ kind: "list" });
      setPin("");
    }, 30_000);
    return () => clearTimeout(id);
  }, [step, pin]);

  const reset = (msg?: { text: string; bad?: boolean }) => {
    setStep({ kind: "list" });
    setPin("");
    setMessage(msg ?? null);
  };

  function submitPin() {
    if (step.kind !== "pin") return;
    start(async () => {
      if (step.exit) {
        const r = await exitKioskAction(step.person.id, pin);
        if (r.ok) router.replace("/sign-in");
        else reset({ text: r.error, bad: true });
        return;
      }
      const r = await kioskIdentifyAction(step.person.id, pin);
      setPin("");
      if (!r.ok) return setMessage({ text: r.error, bad: true });
      setMessage(null);
      setStep({ kind: "actions", person: step.person, ...r.data });
    });
  }

  function punch(action: "in" | "break_start" | "break_end" | "out") {
    if (step.kind !== "actions") return;
    start(async () => {
      const r = await kioskPunchAction(step.person.id, step.ticket, action);
      if (!r.ok) return reset({ text: r.error, bad: true });
      reset({ text: t(`done.${action}`, { name: step.person.name }) });
    });
  }

  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <div className="flex-1">
          <p className="font-semibold">{location}</p>
          <p className="text-xs text-muted-foreground">{deviceName}</p>
        </div>
        <p className="text-2xl font-semibold">
          <Clock />
        </p>
      </header>
      {message && (
        <p role="status" className={`mx-4 mt-4 rounded-lg p-3 text-center text-lg ${message.bad ? "bg-destructive/10 text-destructive" : "bg-primary/10"}`} data-testid="kiosk-message">
          {message.text}
        </p>
      )}
      <div className="flex-1 p-4">
        {step.kind === "list" && (
          <>
            <h1 className="mb-3 text-xl font-semibold">{t("tapName")}</h1>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="kiosk-staff">
              {staff.map((p) => (
                <li key={p.id}>
                  <button type="button" className="min-h-20 w-full rounded-xl border bg-card p-3 text-lg font-medium hover:bg-muted" onClick={() => setStep({ kind: "pin", person: p })}>
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {step.kind === "pin" && (
          <div className="mx-auto max-w-xs space-y-4 text-center">
            <h1 className="text-xl font-semibold">{step.exit ? t("managerPin", { name: step.person.name }) : t("enterPin", { name: step.person.name })}</h1>
            <p className="h-10 text-3xl tracking-[0.5em]" aria-label={t("pinEntered", { n: pin.length })} data-testid="kiosk-pin-dots">
              {"•".repeat(pin.length)}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button key={d} type="button" className="h-16 rounded-xl border text-2xl font-medium hover:bg-muted" onClick={() => setPin((p) => (p.length < 6 ? p + d : p))}>
                  {d}
                </button>
              ))}
              <button type="button" className="h-16 rounded-xl border" aria-label={t("delete")} onClick={() => setPin((p) => p.slice(0, -1))}>
                <Delete className="mx-auto" aria-hidden />
              </button>
              <button type="button" className="h-16 rounded-xl border text-2xl font-medium hover:bg-muted" onClick={() => setPin((p) => (p.length < 6 ? p + "0" : p))}>
                0
              </button>
              <Button className="h-16 text-lg" disabled={pending || pin.length < 4} onClick={submitPin}>
                {t("ok")}
              </Button>
            </div>
            <Button variant="ghost" onClick={() => reset()}>
              {t("cancel")}
            </Button>
          </div>
        )}
        {step.kind === "actions" && (
          <div className="mx-auto max-w-sm space-y-3 text-center">
            <h1 className="text-xl font-semibold">{t("hello", { name: step.person.name })}</h1>
            {step.needsPreviousFinish ? (
              <p className="rounded-lg bg-muted p-3">{t("previousOpen")}</p>
            ) : !step.clockedIn ? (
              <Button className="h-16 w-full text-lg" disabled={pending} onClick={() => punch("in")}>
                {t("clockIn")}
              </Button>
            ) : (
              <>
                {step.onBreak ? (
                  <Button className="h-16 w-full text-lg" disabled={pending} onClick={() => punch("break_end")}>
                    {t("endBreak")}
                  </Button>
                ) : (
                  <Button variant="outline" className="h-16 w-full text-lg" disabled={pending} onClick={() => punch("break_start")}>
                    {t("startBreak")}
                  </Button>
                )}
                <Button className="h-16 w-full text-lg" disabled={pending} onClick={() => punch("out")}>
                  {t("clockOut")}
                </Button>
              </>
            )}
            <Button variant="ghost" onClick={() => reset()}>
              {t("cancel")}
            </Button>
          </div>
        )}
      </div>
      {step.kind === "list" && (
        <footer className="border-t p-3 text-right">
          <details className="inline-block text-left">
            <summary className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <LogOut className="size-4" aria-hidden />
              {t("exit")}
            </summary>
            <p className="mt-2 text-sm">{t("exitHint")}</p>
            <ul className="mt-2 flex max-w-md flex-wrap gap-2">
              {staff.map((p) => (
                <li key={p.id}>
                  <Button size="sm" variant="outline" onClick={() => setStep({ kind: "pin", person: p, exit: true })}>
                    {p.name}
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        </footer>
      )}
    </main>
  );
}
