import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatInTimeZone } from "date-fns-tz";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { periodFor, timesheetDetail } from "@/server/services/timesheets";
import { formatCents } from "@/lib/money";
import { canManagePerson } from "@/lib/permissions";
import { hoursLabel } from "@/components/app/format";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { ApprovePanel, EntitlementOverride, ReopenForm, VacationAdjust } from "./tools";

export default async function TimesheetDetailPage({ params, searchParams }: PageProps<"/b/[businessId]/timesheets/[membershipId]">) {
  const { businessId, membershipId } = await params;
  const sp = await searchParams;
  const ctx = await requireBusinessPage(businessId);
  const t = await getTranslations("timesheets");
  const tc = await getTranslations("clock");
  const period = periodFor(ctx, typeof sp.period === "string" ? sp.period : undefined);
  const d = await timesheetDetail(ctx, membershipId, period);
  const r = d.result;
  const cur = ctx.business.currency;
  const $ = (c: number) => (d.showMoney ? formatCents(c, cur) : "—");
  const approved = d.sheet?.status === "approved";
  const canApprove =
    !d.self && hasPermission(ctx, "timesheets.approve") && canManagePerson(ctx.actor, { membershipId: d.person.id, rank: d.person.role.rank }, "timesheets.approve");
  const blocking = r.unresolvedFlags.filter((f) => f.blocking);
  const endInPeriod = d.person.employmentEndedAt && d.person.employmentEndedAt.toISOString().slice(0, 10) <= period.end && d.person.employmentEndedAt.toISOString().slice(0, 10) >= period.start;

  return (
    <>
      <PageHeader
        title={d.person.displayName ?? d.person.user.name}
        description={t("period", { start: r.period.start, end: r.period.end })}
        actions={approved ? <Badge>{d.sheet?.isFinal ? t("approvedFinal") : t("approved")}</Badge> : undefined}
      />
      {r.blocked.length > 0 && (
        <div role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid="blocked-reasons">
          <p className="font-medium">{t("cantCalculateTitle")}</p>
          <ul className="list-disc pl-5">
            {r.blocked.map((b) => (
              <li key={b.code}>{b.detail}</li>
            ))}
          </ul>
        </div>
      )}
      {!approved && blocking.length > 0 && (
        <div role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid="blocking-flags">
          <p className="font-medium">{t("blockingTitle", { count: blocking.length })}</p>
          <ul className="flex flex-wrap gap-1 py-1">
            {blocking.map((f, i) => (
              <li key={i}>
                <Badge variant="destructive">{tc(`flags.${f.type}`)}</Badge>
              </li>
            ))}
          </ul>
          {hasPermission(ctx, "timeclock.edit") && (
            <Link href={`/b/${businessId}/timeclock`} className="underline">
              {t("resolveThem")}
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <h2 className="font-semibold">{t("summary")}</h2>
          <dl className="grid grid-cols-2 gap-y-1 rounded-lg border p-3 text-sm" data-testid="timesheet-summary">
            <dt>{t("worked")}</dt>
            <dd className="text-right tabular-nums">{hoursLabel(r.workedSeconds)}</dd>
            <dt>{t("regular")}</dt>
            <dd className="text-right tabular-nums">{hoursLabel(r.regularSeconds)}</dd>
            {r.overtime.map((o) => (
              <div key={`${o.tier}-${o.multiplier}`} className="col-span-2 grid grid-cols-2">
                <dt>{t(`tier.${o.tier}`, { m: o.multiplier })}</dt>
                <dd className="text-right tabular-nums">{hoursLabel(o.seconds)}</dd>
              </div>
            ))}
            <dt>{t("breaks")}</dt>
            <dd className="text-right tabular-nums">{hoursLabel(r.breakSeconds)}</dd>
            {r.topUpSeconds > 0 && (
              <>
                <dt>{t("topUp")}</dt>
                <dd className="text-right tabular-nums">{hoursLabel(r.topUpSeconds)}</dd>
              </>
            )}
            <dt className="border-t pt-1 font-medium">{t("gross")}</dt>
            <dd className="border-t pt-1 text-right font-medium tabular-nums" data-testid="gross">
              {$(r.grossCents)}
            </dd>
            <dt>{t("vacationAccrued")}</dt>
            <dd className="text-right tabular-nums">{$(r.vacationAccruedCents)}</dd>
            {d.balanceCents !== null && (
              <>
                <dt>{t("vacationBalance")}</dt>
                <dd className="text-right tabular-nums">{$(d.balanceCents)}</dd>
              </>
            )}
          </dl>
          {d.showMoney && r.lines.length > 0 && (
            <table className="w-full text-sm">
              <tbody>
                {r.lines.map((l, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1">{l.label}</td>
                    <td className="py-1 text-right tabular-nums text-muted-foreground">{l.seconds ? hoursLabel(l.seconds) : ""}</td>
                    <td className="py-1 text-right tabular-nums">{$(l.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {r.salaried && <p className="text-sm text-muted-foreground">{t("salaried")}</p>}
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">{t("days")}</h2>
          <ul className="divide-y rounded-lg border text-sm" data-testid="timesheet-days">
            {r.days.map((day) => (
              <li key={day.workDay} className="px-3 py-2">
                <div className="flex justify-between">
                  <span className="font-medium">{day.workDay}</span>
                  <span className="tabular-nums">{hoursLabel(day.seconds)}</span>
                </div>
                <ul className="text-muted-foreground">
                  {d.entries
                    .filter((e) => day.entryIds.includes(e.id))
                    .map((e) => (
                      <li key={e.id} className="tabular-nums">
                        {e.clockIn ? formatInTimeZone(e.clockIn, e.tz, "HH:mm") : "?"}–{e.clockOut ? formatInTimeZone(e.clockOut, e.tz, "HH:mm") : "?"}
                        {e.breaks.length > 0 && ` · ${t("breakCount", { count: e.breaks.length })}`}
                        {e.flags.filter((f) => !f.resolved).map((f) => ` · ${tc(`flags.${f.type}`)}`)}
                      </li>
                    ))}
                </ul>
              </li>
            ))}
            {!r.days.length && <li className="px-3 py-2 text-muted-foreground">{t("noTime")}</li>}
          </ul>
        </section>

        {r.holidays.length > 0 && (
          <section className="space-y-2 lg:col-span-2" data-testid="holiday-verdicts">
            <h2 className="font-semibold">{t("holidays")}</h2>
            {r.holidays.map((h) => (
              <div key={h.holidayId} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  {h.worked ? t("holidayWorked") : h.eligible ? t("holidayEligible") : t("holidayIneligible")} · {h.worked ? $(h.premiumCents) : $(h.holidayPayCents)}
                </p>
                <p className="text-muted-foreground">
                  {t("holidayInputs", {
                    employed: h.inputs.employmentDays ?? "?",
                    minEmployed: h.inputs.minEmploymentDays,
                    worked: h.inputs.daysWorkedInLookback,
                    minWorked: h.inputs.minDaysWorked,
                    from: h.inputs.lookbackFrom,
                    to: h.inputs.lookbackTo,
                  })}
                  {h.inputs.overridden && ` ${t("overridden", { reason: h.inputs.overrideReason ?? "" })}`}
                </p>
                {!approved && hasPermission(ctx, "holidays.manage") && <EntitlementOverride businessId={businessId} holidayId={h.holidayId} membershipId={d.person.id} overridden={h.inputs.overridden} />}
              </div>
            ))}
          </section>
        )}
      </div>

      <div className="mt-6 max-w-xl space-y-4">
        {canApprove && !approved && (
          <ApprovePanel
            businessId={businessId}
            membershipId={d.person.id}
            periodStart={period.start}
            isOwner={ctx.actor.isOwner}
            blockingCount={blocking.length}
            blocked={r.blocked.length > 0}
            canFinal={!!endInPeriod}
          />
        )}
        {approved && ctx.actor.isOwner && <ReopenForm businessId={businessId} membershipId={d.person.id} periodStart={period.start} />}
        {hasPermission(ctx, "wages.edit") && !d.self && d.showMoney && <VacationAdjust businessId={businessId} membershipId={d.person.id} currency={cur} />}
      </div>
    </>
  );
}
