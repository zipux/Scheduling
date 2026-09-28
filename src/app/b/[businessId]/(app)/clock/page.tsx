import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatInTimeZone } from "date-fns-tz";
import { activeMemberships, hasPermission, requireBusinessPage } from "@/server/auth/context";
import { clockStatus } from "@/server/services/clock";
import { myEntries } from "@/server/services/time-corrections";
import { myUpcomingShifts } from "@/server/services/schedule";
import { isBlocking, type TimeFlag } from "@/lib/time-flags";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { ClockPanel } from "./clock-panel";
import { CorrectionForm, HistoryButton } from "./entry-tools";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("clock") };
}

export default async function ClockPage({ params }: PageProps<"/b/[businessId]/clock">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  const t = await getTranslations("clock");
  const tz = ctx.business.timezone;
  const [status, entries, upcoming, memberships] = await Promise.all([
    clockStatus(businessId, ctx.membership.id),
    myEntries(ctx),
    myUpcomingShifts(ctx, 2),
    activeMemberships(ctx.userId),
  ]);
  const fmt = (d: Date, f = "EEE d MMM HH:mm") => formatInTimeZone(d, tz, f);
  const next = upcoming[0];
  const open = status.open;

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          hasPermission(ctx, "timeclock.edit") || hasPermission(ctx, "timeclock.add") ? (
            <Link href={`/b/${businessId}/timeclock`} className="inline-flex h-11 items-center rounded-lg border px-4 text-sm md:h-9">
              {t("review")}
            </Link>
          ) : undefined
        }
      />
      {memberships.length > 1 && (
        <nav aria-label={t("clockingFor")} className="mb-4 flex flex-wrap items-center gap-2 text-sm" data-testid="clock-business-switcher">
          <span className="text-muted-foreground">{t("clockingFor")}</span>
          {memberships.map((m) => (
            <Link
              key={m.id}
              href={`/b/${m.businessId}/clock`}
              aria-current={m.businessId === businessId ? "page" : undefined}
              className={`inline-flex h-11 items-center rounded-full border px-3 md:h-8 ${m.businessId === businessId ? "border-primary bg-primary text-primary-foreground" : ""}`}
            >
              {m.business.name}
            </Link>
          ))}
          <Link href="/me/hours" className="ml-auto inline-flex h-11 items-center underline md:h-8">
            {t("allMyHours")}
          </Link>
        </nav>
      )}
      <ClockPanel
        businessId={businessId}
        state={{
          clockedIn: !!open,
          onBreak: status.onBreak,
          since: open?.clockIn ? fmt(open.clockIn, "HH:mm") : null,
          needsPreviousFinish: status.needsPreviousFinish
            ? {
                entryId: status.needsPreviousFinish.entryId,
                clockIn: status.needsPreviousFinish.clockIn.toISOString(),
                clockInLabel: fmt(status.needsPreviousFinish.clockIn),
                date: formatInTimeZone(status.needsPreviousFinish.clockIn, tz, "yyyy-MM-dd"),
              }
            : null,
          staleAnswered: status.staleAnswered,
          nextShiftLabel: next ? `${fmt(next.startsAt)}–${formatInTimeZone(next.endsAt, next.location.timezone, "HH:mm")} · ${next.location.name}` : null,
        }}
      />
      <section className="mt-8 space-y-3">
        <h2 className="font-semibold">{t("myTime")}</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noEntries")}</p>
        ) : (
          <ul className="divide-y rounded-lg border" data-testid="my-entries">
            {entries.map((e) => {
              const unresolved = e.flags.filter((f) => !f.resolvedAt);
              return (
                <li key={e.id} className="space-y-1 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 tabular-nums">
                      {e.clockIn ? fmt(e.clockIn) : t("noClockIn")} → {e.clockOut ? fmt(e.clockOut, "HH:mm") : t("open")}
                      <span className="text-muted-foreground"> · {e.location.name}</span>
                    </span>
                    {unresolved.map((f) => (
                      <Badge key={f.id} variant={isBlocking(f.type as TimeFlag) ? "destructive" : "outline"}>
                        {t(`flags.${f.type}`)}
                      </Badge>
                    ))}
                  </div>
                  {e.breaks.length > 0 && (
                    <p className="text-muted-foreground">
                      {t("breaks")}: {e.breaks.map((b) => `${fmt(b.startsAt, "HH:mm")}–${b.endsAt ? fmt(b.endsAt, "HH:mm") : "…"}`).join(", ")}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <HistoryButton businessId={businessId} entryId={e.id} />
                    <CorrectionForm businessId={businessId} entryId={e.id} date={formatInTimeZone(e.clockIn ?? e.clockOut!, tz, "yyyy-MM-dd")} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <CorrectionForm businessId={businessId} entryId={null} date={formatInTimeZone(new Date(), tz, "yyyy-MM-dd")} />
      </section>
    </>
  );
}
