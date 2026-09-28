import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatInTimeZone } from "date-fns-tz";
import { accessibleLocationIds, hasPermission, requireBusinessPage } from "@/server/auth/context";
import { raiseMissingClockOuts } from "@/server/services/clock";
import { pendingCorrections, unresolvedTime, workingNow } from "@/server/services/time-corrections";
import { isBlocking, type TimeFlag } from "@/lib/time-flags";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { AddEntryForm, CorrectionReview, EntryEditor, ResolveFlagButton } from "./review-tools";

export async function generateMetadata() {
  const t = await getTranslations("timeclock");
  return { title: t("title") };
}

export default async function TimeClockReviewPage({ params }: PageProps<"/b/[businessId]/timeclock">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  if (!hasPermission(ctx, "timeclock.edit") && !hasPermission(ctx, "timeclock.add")) notFound();
  const t = await getTranslations("timeclock");
  const tc = await getTranslations("clock");
  await raiseMissingClockOuts(businessId);
  const [now, queue, corrections, locIds] = await Promise.all([workingNow(ctx), unresolvedTime(ctx), pendingCorrections(ctx), accessibleLocationIds(ctx)]);
  const [locations, people] = await Promise.all([
    ctx.db.location.findMany({ where: { id: { in: locIds } }, orderBy: { name: "asc" } }),
    ctx.db.membership.findMany({ where: { status: "active", accessRevokedAt: null, NOT: { id: ctx.membership.id } }, include: { user: { select: { name: true } }, role: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const junior = people.filter((p) => ctx.actor.isOwner || p.role.rank > ctx.actor.rank);
  const fmt = (d: Date | null, tz: string, f = "EEE d MMM HH:mm") => (d ? formatInTimeZone(d, tz, f) : "—");
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <h2 className="font-semibold">{t("workingNow", { count: now.length })}</h2>
          {now.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("nobodyIn")}</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm" data-testid="working-now">
              {now.map((w) => (
                <li key={w.entry.id} className="flex items-center gap-2 px-4 py-2">
                  <span className="flex-1 font-medium">{w.name}</span>
                  <span className="text-muted-foreground">
                    {t("since", { time: fmt(w.entry.clockIn, w.entry.location.timezone, "HH:mm") })} · {w.entry.location.name}
                  </span>
                  {w.onBreak && <Badge variant="outline">{tc("onBreak")}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {hasPermission(ctx, "timeclock.add") && (
          <section className="space-y-2">
            <h2 className="font-semibold">{t("addMissing")}</h2>
            <AddEntryForm
              businessId={businessId}
              people={junior.map((p) => ({ id: p.id, name: p.displayName ?? p.user.name }))}
              locations={locations.map((l) => ({ id: l.id, name: l.name }))}
            />
          </section>
        )}

        <section className="space-y-2 lg:col-span-2">
          <h2 className="font-semibold">{t("unresolved", { count: queue.length })}</h2>
          <p className="text-sm text-muted-foreground">{t("unresolvedHint")}</p>
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("allResolved")}</p>
          ) : (
            <ul className="space-y-2" data-testid="unresolved-time">
              {queue.map(({ entry, flags, person }) => {
                const tz = entry.location.timezone;
                return (
                  <li key={entry.id} className="space-y-2 rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{person?.displayName ?? person?.user.name}</span>
                        <span className="block tabular-nums">
                          {fmt(entry.clockIn, tz)} → {entry.clockOut ? fmt(entry.clockOut, tz, "HH:mm") : tc("open")} · {entry.location.name}
                        </span>
                      </span>
                    </div>
                    <ul className="flex flex-wrap gap-2">
                      {flags.map((f) => (
                        <li key={f.id} className="flex items-center gap-1">
                          <Badge variant={isBlocking(f.type as TimeFlag) ? "destructive" : "outline"}>{tc(`flags.${f.type}`)}</Badge>
                          {f.type !== "MISSING_CLOCK_OUT" && f.type !== "MISSING_CLOCK_IN" && (
                            <ResolveFlagButton businessId={businessId} flagId={f.id} label={isBlocking(f.type as TimeFlag) ? t("confirm") : t("acknowledge")} />
                          )}
                        </li>
                      ))}
                    </ul>
                    <EntryEditor
                      businessId={businessId}
                      entry={{ id: entry.id, clockIn: iso(entry.clockIn), clockOut: iso(entry.clockOut), tz }}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-2 lg:col-span-2">
          <h2 className="font-semibold">{t("corrections", { count: corrections.length })}</h2>
          {corrections.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noCorrections")}</p>
          ) : (
            <ul className="space-y-2" data-testid="pending-corrections">
              {corrections.map((c) => (
                <li key={c.id} className="space-y-1 rounded-lg border p-3 text-sm">
                  <p className="font-medium">{c.person.displayName ?? c.person.user.name}</p>
                  <p>“{c.message}”</p>
                  <p className="text-muted-foreground tabular-nums">
                    {t("proposed")}: {c.proposedClockIn ? fmt(c.proposedClockIn, ctx.business.timezone) : "—"} → {c.proposedClockOut ? fmt(c.proposedClockOut, ctx.business.timezone) : "—"}
                  </p>
                  <CorrectionReview businessId={businessId} id={c.id} proposedIn={iso(c.proposedClockIn)} proposedOut={iso(c.proposedClockOut)} tz={ctx.business.timezone} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
