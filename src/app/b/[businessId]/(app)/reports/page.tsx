import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { buildReport, REPORTS, type ReportKey } from "@/server/services/reports";
import { periodFor } from "@/server/services/timesheets";
import { addDaysKey } from "@/lib/time";
import { PageHeader } from "@/components/app/page-header";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("reports") };
}

export default async function ReportsPage({ params, searchParams }: PageProps<"/b/[businessId]/reports">) {
  const { businessId } = await params;
  const sp = await searchParams;
  const ctx = await requireBusinessPage(businessId);
  if (!hasPermission(ctx, "reports.view")) notFound();
  const t = await getTranslations("reports");
  const key: ReportKey = REPORTS.includes(sp.type as ReportKey) ? (sp.type as ReportKey) : "hours";
  const period = periodFor(ctx, typeof sp.period === "string" ? sp.period : undefined);
  const table = await buildReport(ctx, key, period);
  const base = `/b/${businessId}/reports`;
  const q = (over: Record<string, string>) => new URLSearchParams({ type: key, period: period.start, ...over }).toString();
  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("period", { start: period.start, end: period.end })}
        actions={
          <a href={`${base}/export?${q({})}`} className="inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm md:h-9" data-testid="report-export">
            <Download className="size-4" aria-hidden />
            {t("export")}
          </a>
        }
      />
      <nav className="-mx-4 mb-3 flex gap-1 overflow-x-auto px-4" aria-label={t("title")}>
        {REPORTS.map((r) => (
          <Link key={r} href={`${base}?${q({ type: r })}`} aria-current={r === key ? "page" : undefined} className={cn("inline-flex h-11 shrink-0 items-center rounded-lg border px-3 text-sm md:h-9", r === key && "border-primary bg-primary text-primary-foreground")}>
            {t(`types.${r}`)}
          </Link>
        ))}
      </nav>
      <div className="mb-3 flex gap-2 text-sm">
        <Link href={`${base}?${q({ period: periodFor(ctx, addDaysKey(period.start, -1)).start })}`} className="underline">
          ← {t("prev")}
        </Link>
        <Link href={`${base}?${q({ period: addDaysKey(period.end, 1) })}`} className="underline">
          {t("next")} →
        </Link>
      </div>
      {table.note && <p className="mb-2 text-sm text-muted-foreground">{table.note}</p>}
      {table.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm" data-testid="report-table">
            <thead className="bg-muted/50">
              <tr>
                {table.columns.map((c) => (
                  <th key={c} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t">
                  {r.map((c, j) => (
                    <td key={j} className={cn("px-3 py-2 whitespace-nowrap", typeof c === "number" && "text-right tabular-nums")}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
