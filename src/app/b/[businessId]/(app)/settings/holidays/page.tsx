import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { PageHeader } from "@/components/app/page-header";
import { ActionButton } from "@/components/app/action-button";
import { Badge } from "@/components/ui/badge";
import { deleteHolidayAction } from "../pay-rules/actions";
import { AddHolidayForm, PresetButton } from "./holiday-forms";

export default async function HolidaysPage({ params }: PageProps<"/b/[businessId]/settings/holidays">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  if (!hasPermission(ctx, "holidays.manage")) notFound();
  const t = await getTranslations("holidaysPage");
  const holidays = await ctx.db.holiday.findMany({ orderBy: { date: "asc" } });
  const year = new Date().getUTCFullYear();
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="max-w-2xl space-y-4">
        <div className="flex flex-wrap gap-2">
          <PresetButton businessId={businessId} year={year} label={t("addPreset", { year })} />
          <PresetButton businessId={businessId} year={year + 1} label={t("addPreset", { year: year + 1 })} />
        </div>
        <AddHolidayForm businessId={businessId} />
        <ul className="divide-y rounded-lg border text-sm" data-testid="holiday-list">
          {holidays.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <span className="w-24 tabular-nums">{h.date.toISOString().slice(0, 10)}</span>
              <span className="min-w-0 flex-1 font-medium">{h.name}</span>
              {h.isStatutory ? <Badge variant="secondary">{t("statutory")}</Badge> : <Badge variant="outline">{t("notStatutory")}</Badge>}
              <span className="text-muted-foreground">×{Number(h.premiumMultiplier)}</span>
              <ActionButton action={deleteHolidayAction} businessId={businessId} args={{ id: h.id }} label={t("delete")} variant="ghost" />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
