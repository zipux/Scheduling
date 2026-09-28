import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { PAY_PRESETS } from "@/lib/pay-presets";
import { PageHeader } from "@/components/app/page-header";
import { ActionButton } from "@/components/app/action-button";
import { deleteBreakRuleAction } from "./actions";
import { BreakRuleForm, HolidayRulesForm, OvertimeForm, WorkDayForm } from "./forms";

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export default async function PayRulesPage({ params }: PageProps<"/b/[businessId]/settings/pay-rules">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  if (!hasPermission(ctx, "payrules.manage")) notFound();
  const t = await getTranslations("payRulesPage");
  const [rules, breakRules] = await Promise.all([ctx.db.payRules.findUniqueOrThrow({ where: { businessId } }), ctx.db.breakRule.findMany({ orderBy: { afterHours: "asc" } })]);
  const b = ctx.business;
  return (
    <>
      <PageHeader title={t("title")} />
      {/* §7.6.8: stated plainly at the top. */}
      <div role="note" className="mb-6 max-w-2xl rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50" data-testid="payrules-responsibility">
        <p className="font-semibold">{t("responsibilityTitle")}</p>
        <p className="mt-1">{t("responsibilityBody")}</p>
        {rules.confirmedAt && <p className="mt-2 text-xs">{t("lastConfirmed", { date: rules.confirmedAt.toISOString().slice(0, 10) })}</p>}
      </div>
      <div className="max-w-2xl space-y-10">
        <OvertimeForm
          businessId={businessId}
          presetLabel={rules.presetKey ? PAY_PRESETS[rules.presetKey]?.label : undefined}
          initial={{
            dailyThresholdHours: str(rules.dailyThresholdHours),
            dailyMultiplier: str(rules.dailyMultiplier),
            dailySecondThresholdHours: str(rules.dailySecondThresholdHours),
            dailySecondMultiplier: str(rules.dailySecondMultiplier),
            weeklyThresholdHours: str(rules.weeklyThresholdHours),
            weeklyMultiplier: str(rules.weeklyMultiplier),
            minimumDailyPayHours: str(rules.minimumDailyPayHours),
            maxSplitShiftSpanHours: str(rules.maxSplitShiftSpanHours),
            vacationPayPercent: str(b.vacationPayPercent),
            confirmed: false,
          }}
        />
        <WorkDayForm businessId={businessId} initial={`${String(Math.floor(b.workDayStartMinutes / 60)).padStart(2, "0")}:${String(b.workDayStartMinutes % 60).padStart(2, "0")}`} />
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("breaks")}</h2>
          <p className="text-sm text-muted-foreground">{t("breaksHint")}</p>
          {breakRules.length > 0 && (
            <ul className="divide-y rounded-lg border text-sm" data-testid="break-rules">
              {breakRules.map((r) => (
                <li key={r.id} className="flex items-center gap-2 px-4 py-2">
                  <span className="flex-1">{t("breakRule", { hours: Number(r.afterHours), minutes: r.breakMinutes })}</span>
                  <ActionButton action={deleteBreakRuleAction} businessId={businessId} args={{ id: r.id }} label={t("remove")} variant="ghost" />
                </li>
              ))}
            </ul>
          )}
          <BreakRuleForm businessId={businessId} />
        </section>
        <HolidayRulesForm
          businessId={businessId}
          initial={{
            holidayMinEmploymentDays: String(rules.holidayMinEmploymentDays),
            holidayMinDaysWorkedLookback: String(rules.holidayMinDaysWorkedLookback),
            holidayLookbackDays: String(rules.holidayLookbackDays),
            holidayAverageDivisor: (rules.holidayAverageDivisor as "days_worked" | "fixed" | null) ?? "",
            holidayAverageFixedDivisor: str(rules.holidayAverageFixedDivisor),
          }}
          holidaysLink={
            <Link href={`/b/${businessId}/settings/holidays`} className="underline">
              {t("editHolidays")}
            </Link>
          }
        />
      </div>
    </>
  );
}
