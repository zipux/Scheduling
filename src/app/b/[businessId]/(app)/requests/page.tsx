import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatInTimeZone } from "date-fns-tz";
import { Inbox } from "lucide-react";
import { hasPermission, requireBusinessPage, type BusinessContext } from "@/server/auth/context";
import { myTimeOff, timeOffToReview, upcomingBlackouts } from "@/server/services/requests/timeoff";
import { availabilityToReview, myAvailability } from "@/server/services/requests/availability";
import { availableShifts, myTrades, shiftsById, tradesToReview } from "@/server/services/requests/trades";
import { dateKeyInTz } from "@/lib/time";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { ActionButton } from "@/components/app/action-button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AvailabilityForm, ReviewButtons, TimeOffForm } from "./forms";
import { cancelAvailabilityAction, cancelTimeOffAction, cancelTradeAction, claimShiftAction, respondSwapAction } from "./actions";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("requests") };
}

const hhmm = (m: number | null) => (m === null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);

function when(start: Date, end: Date, allDay: boolean, tz: string) {
  if (allDay) {
    const a = formatInTimeZone(start, tz, "EEE d MMM");
    const b = formatInTimeZone(new Date(end.getTime() - 1), tz, "EEE d MMM");
    return a === b ? a : `${a} – ${b}`;
  }
  return `${formatInTimeZone(start, tz, "EEE d MMM HH:mm")}–${formatInTimeZone(end, tz, "HH:mm")}`;
}

function shiftLabel(s: { startsAt: Date; endsAt: Date; location: { name: string; timezone: string }; position: { name: string } | null }) {
  const tz = s.location.timezone;
  return `${formatInTimeZone(s.startsAt, tz, "EEE d MMM HH:mm")}–${formatInTimeZone(s.endsAt, tz, "HH:mm")} · ${[s.position?.name, s.location.name].filter(Boolean).join(" · ")}`;
}

export default async function RequestsPage({ params, searchParams }: PageProps<"/b/[businessId]/requests">) {
  const { businessId } = await params;
  const sp = await searchParams;
  const ctx = await requireBusinessPage(businessId);
  const t = await getTranslations("requests");
  const canReview = ["timeoff.approve", "availability.approve", "trades.approve"].some((p) => hasPermission(ctx, p as never));
  const tab = sp.tab === "available" ? "available" : sp.tab === "approvals" && canReview ? "approvals" : "mine";
  const tabs = [
    { key: "mine", label: t("tabs.mine") },
    { key: "available", label: t("tabs.available") },
    ...(canReview ? [{ key: "approvals", label: t("tabs.approvals") }] : []),
  ];

  return (
    <>
      <PageHeader title={t("title")} />
      <nav className="-mx-4 mb-4 flex gap-1 overflow-x-auto px-4" aria-label={t("title")}>
        {tabs.map((x) => (
          <Link
            key={x.key}
            href={`/b/${businessId}/requests?tab=${x.key}`}
            aria-current={tab === x.key ? "page" : undefined}
            className={cn("inline-flex h-11 shrink-0 items-center rounded-lg border px-4 text-sm md:h-9", tab === x.key && "border-primary bg-primary text-primary-foreground")}
          >
            {x.label}
          </Link>
        ))}
      </nav>
      {tab === "mine" && <Mine ctx={ctx} businessId={businessId} />}
      {tab === "available" && <Available ctx={ctx} businessId={businessId} />}
      {tab === "approvals" && <Approvals ctx={ctx} businessId={businessId} />}
    </>
  );
}

async function Mine({ ctx, businessId }: { ctx: BusinessContext; businessId: string }) {
  const t = await getTranslations("requests");
  const tz = ctx.business.timezone;
  const [timeOff, availability, trades, blackouts] = await Promise.all([myTimeOff(ctx), myAvailability(ctx), myTrades(ctx), upcomingBlackouts(ctx)]);
  const shifts = await shiftsById(ctx, trades.flatMap((x) => [x.shiftId, x.swapShiftId].filter((v): v is string => !!v)));
  const base = availability.pending.length ? availability.pending : availability.current;
  const current = Array.from({ length: 7 }, (_, i) => {
    const r = base.find((x) => x.weekday === i);
    return { kind: (r?.kind ?? "all_day") as "all_day" | "between" | "unavailable", start: hhmm(r?.startMinutes ?? 540) || "09:00", end: hhmm(r?.endMinutes ?? 1020) || "17:00" };
  });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-3">
        <h2 className="font-semibold">{t("timeOff")}</h2>
        <TimeOffForm
          businessId={businessId}
          types={ctx.business.timeOffTypes}
          today={dateKeyInTz(new Date(), tz)}
          blackouts={blackouts.map((b) => ({ start: b.startDate.toISOString().slice(0, 10), end: b.endDate.toISOString().slice(0, 10), reason: b.reason }))}
        />
        {timeOff.length > 0 && (
          <ul className="divide-y rounded-lg border" data-testid="my-timeoff">
            {timeOff.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{when(r.startsAt, r.endsAt, r.allDay, tz)}</span>
                  <span className="block text-muted-foreground">
                    {t.has(`types.${r.type}`) ? t(`types.${r.type}`) : r.type}
                    {r.reviewerNote ? ` · “${r.reviewerNote}”` : ""}
                  </span>
                </span>
                <Badge variant={r.status === "approved" ? "default" : r.status === "denied" ? "destructive" : "outline"}>{t(`status.${r.status}`)}</Badge>
                {r.status === "pending" && <ActionButton action={cancelTimeOffAction} businessId={businessId} args={{ id: r.id }} label={t("cancel")} variant="ghost" />}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">{t("availability")}</h2>
        {availability.pending.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-2 text-sm">
            <span className="flex-1">{t("availabilityPending", { date: availability.pending[0].effectiveFrom.toISOString().slice(0, 10) })}</span>
            <ActionButton action={cancelAvailabilityAction} businessId={businessId} args={{ requestId: availability.pending[0].requestId }} label={t("cancel")} variant="ghost" />
          </div>
        )}
        <AvailabilityForm businessId={businessId} today={dateKeyInTz(new Date(), tz)} current={current} />
      </section>
      <section className="space-y-3 lg:col-span-2">
        <h2 className="font-semibold">{t("shiftRequests")}</h2>
        {trades.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noShiftRequests")}</p>
        ) : (
          <ul className="divide-y rounded-lg border" data-testid="my-trades">
            {trades.map((r) => {
              const s = shifts.get(r.shiftId);
              const other = r.swapShiftId ? shifts.get(r.swapShiftId) : null;
              const incoming = r.type === "swap" && r.toMembershipId === ctx.membership.id;
              return (
                <li key={r.id} className="space-y-1 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{t(`trade.${r.type}`)}</Badge>
                    <span className="min-w-0 flex-1">{s ? shiftLabel(s) : "—"}</span>
                    <Badge variant="secondary">{r.type === "swap" && r.coworkerAcceptedAt ? t("awaitingManager") : t("status.pending")}</Badge>
                  </div>
                  {other && <p className="text-muted-foreground">{t("inExchangeFor", { shift: shiftLabel(other), who: other.membership?.user.name ?? "" })}</p>}
                  <div className="flex gap-2">
                    {incoming && !r.coworkerAcceptedAt ? (
                      <>
                        <ActionButton action={respondSwapAction} businessId={businessId} args={{ id: r.id, accept: true }} label={t("accept")} variant="default" success={t("accepted")} />
                        <ActionButton action={respondSwapAction} businessId={businessId} args={{ id: r.id, accept: false }} label={t("decline")} />
                      </>
                    ) : !incoming ? (
                      <ActionButton action={cancelTradeAction} businessId={businessId} args={{ id: r.id }} label={t("cancel")} variant="ghost" />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

async function Available({ ctx, businessId }: { ctx: BusinessContext; businessId: string }) {
  const t = await getTranslations("requests");
  const list = await availableShifts(ctx);
  if (!list.length) return <EmptyState icon={Inbox} title={t("noAvailable")} body={t("noAvailableBody")} />;
  return (
    <ul className="space-y-2" data-testid="available-shifts">
      {list.map(({ shift: s, offered, claimed }) => (
        <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
          <span className="w-1 self-stretch rounded-full" style={{ backgroundColor: s.position?.color ?? "#64748b" }} aria-hidden />
          <span className="min-w-0 flex-1 text-sm">
            <span className="block font-medium">{shiftLabel(s)}</span>
            <span className="block text-muted-foreground">{offered ? t("offeredByCoworker") : t("openShift")}</span>
          </span>
          {claimed ? (
            <Badge variant="secondary">{t("claimPending")}</Badge>
          ) : (
            <ActionButton action={claimShiftAction} businessId={businessId} args={{ id: s.id }} label={t("claim")} variant="default" success={t("claimed")} testId="claim" />
          )}
        </li>
      ))}
    </ul>
  );
}

async function Approvals({ ctx, businessId }: { ctx: BusinessContext; businessId: string }) {
  const t = await getTranslations("requests");
  const tz = ctx.business.timezone;
  const [timeOff, availability, trades] = await Promise.all([timeOffToReview(ctx), availabilityToReview(ctx), tradesToReview(ctx)]);
  const shifts = await shiftsById(ctx, trades.flatMap((x) => [x.shiftId, x.swapShiftId].filter((v): v is string => !!v)));
  const badges = (r: { escalated: boolean; self: boolean }) => (
    <>
      {r.escalated && <Badge variant="destructive">{t("escalated")}</Badge>}
      {r.self && <Badge variant="outline">{t("yours")}</Badge>}
    </>
  );
  if (!timeOff.length && !availability.length && !trades.length) return <EmptyState icon={Inbox} title={t("nothingToReview")} />;
  return (
    <div className="space-y-6" data-testid="approvals">
      {timeOff.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">{t("timeOff")}</h2>
          <ul className="space-y-2">
            {timeOff.map((r) => (
              <li key={r.id} className="rounded-lg border p-3 text-sm" data-testid="review-timeoff">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{r.requesterName}</span>
                    <span className="block">
                      {when(r.startsAt, r.endsAt, r.allDay, tz)} · {t.has(`types.${r.type}`) ? t(`types.${r.type}`) : r.type}
                    </span>
                    {r.reason && <span className="block text-muted-foreground">“{r.reason}”</span>}
                  </span>
                  {badges(r)}
                </div>
                <ReviewButtons businessId={businessId} kind="timeoff" id={r.id} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {availability.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">{t("availability")}</h2>
          <ul className="space-y-2">
            {availability.map((g) => (
              <li key={g.requestId} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-medium">
                    {g.requesterName} · {t("fromDate", { date: g.effectiveFrom.toISOString().slice(0, 10) })}
                  </span>
                  {badges(g)}
                </div>
                <ul className="mt-1 grid grid-cols-2 gap-x-4 text-muted-foreground sm:grid-cols-4">
                  {[1, 2, 3, 4, 5, 6, 0].map((i) => {
                    const d = g.days.find((x) => x.weekday === i);
                    return (
                      <li key={i}>
                        {t(`weekdays.${i}`)}: {d?.kind === "between" ? `${hhmm(d.startMinutes)}–${hhmm(d.endMinutes)}` : t(`kinds.${d?.kind ?? "all_day"}`)}
                      </li>
                    );
                  })}
                </ul>
                <ReviewButtons businessId={businessId} kind="availability" id={g.requestId} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {trades.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">{t("shiftRequests")}</h2>
          <ul className="space-y-2">
            {trades.map((r) => {
              const s = shifts.get(r.shiftId);
              const other = r.swapShiftId ? shifts.get(r.swapShiftId) : null;
              return (
                <li key={r.id} className="rounded-lg border p-3 text-sm" data-testid="review-trade">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{t(`trade.${r.type}`)}</Badge>
                    <span className="min-w-0 flex-1 font-medium">{r.requesterName}</span>
                    {badges(r)}
                  </div>
                  <p className="mt-1">{s ? shiftLabel(s) : "—"}</p>
                  {other && <p className="text-muted-foreground">{t("inExchangeFor", { shift: shiftLabel(other), who: other.membership?.user.name ?? "" })}</p>}
                  <ReviewButtons businessId={businessId} kind="trade" id={r.id} />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
