import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { periodFor, periodOverview } from "@/server/services/timesheets";
import { addDaysKey } from "@/lib/time";
import { formatCents } from "@/lib/money";
import { hoursLabel } from "@/components/app/format";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("timesheets") };
}

export default async function TimesheetsPage({ params, searchParams }: PageProps<"/b/[businessId]/timesheets">) {
  const { businessId } = await params;
  const sp = await searchParams;
  const ctx = await requireBusinessPage(businessId);
  if (!hasPermission(ctx, "timesheets.approve") && !hasPermission(ctx, "reports.view")) notFound();
  const t = await getTranslations("timesheets");
  const period = periodFor(ctx, typeof sp.period === "string" ? sp.period : undefined);
  const rows = await periodOverview(ctx, period);
  const money = hasPermission(ctx, "wages.view");
  const prev = periodFor(ctx, addDaysKey(period.start, -1)).start;
  const next = addDaysKey(period.end, 1);
  const base = `/b/${businessId}/timesheets`;
  const approved = rows.filter((r) => r.sheet?.status === "approved").length;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("period", { start: period.start, end: period.end })}
        actions={
          money ? (
            <a href={`${base}/export?period=${period.start}`} className="inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm md:h-9" data-testid="export-csv">
              <Download className="size-4" aria-hidden />
              {t("exportCsv")}
            </a>
          ) : undefined
        }
      />
      <div className="mb-3 flex items-center gap-2">
        <Link href={`${base}?period=${prev}`} aria-label={t("prev")} className="inline-flex size-11 items-center justify-center rounded-lg border md:size-9">
          <ChevronLeft className="size-4" />
        </Link>
        <span className="text-sm">{t("approvedCount", { approved, total: rows.length })}</span>
        <Link href={`${base}?period=${next}`} aria-label={t("next")} className="inline-flex size-11 items-center justify-center rounded-lg border md:size-9">
          <ChevronRight className="size-4" />
        </Link>
      </div>
      <ul className="divide-y rounded-lg border" data-testid="timesheet-list">
        {rows.map(({ person, result, sheet }) => {
          const blocking = result.unresolvedFlags.filter((f) => f.blocking).length;
          const ot = result.overtime.reduce((n, o) => n + o.seconds, 0);
          return (
            <li key={person.id}>
              <Link href={`${base}/${person.id}?period=${period.start}`} className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-muted sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
                <span className="col-span-2 font-medium sm:col-span-1">
                  {person.displayName ?? person.user.name}
                  {person.status === "deactivated" && <span className="ml-2 text-xs text-muted-foreground">{t("deactivated")}</span>}
                </span>
                <span className="tabular-nums">{hoursLabel(result.workedSeconds)}</span>
                <span className="tabular-nums text-muted-foreground">{ot ? t("ot", { hours: hoursLabel(ot) }) : "—"}</span>
                <span className="tabular-nums">{money ? formatCents(result.grossCents, ctx.business.currency) : ""}</span>
                <span className="col-span-2 flex flex-wrap gap-1 sm:col-span-1 sm:justify-end">
                  {sheet?.status === "approved" ? (
                    <Badge>{sheet.isFinal ? t("approvedFinal") : t("approved")}</Badge>
                  ) : result.blocked.length ? (
                    <Badge variant="destructive">{t("cantCalculate")}</Badge>
                  ) : blocking ? (
                    <Badge variant="destructive">{t("blockingFlags", { count: blocking })}</Badge>
                  ) : (
                    <Badge variant="outline">{t("ready")}</Badge>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
