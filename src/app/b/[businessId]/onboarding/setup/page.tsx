import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireBusinessPage } from "@/server/auth/context";
import { PageHeader } from "@/components/app/page-header";
import { PAY_PRESETS } from "@/lib/pay-presets";
import { timezones } from "@/lib/regions";
import { parsePermissions } from "@/lib/permissions";
import { SetupWizard } from "./setup-wizard";

export async function generateMetadata() {
  const t = await getTranslations("setup");
  return { title: t("title") };
}

function lastMonday(): string {
  const d = new Date();
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export default async function SetupPage({ params }: PageProps<"/b/[businessId]/onboarding/setup">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  if (ctx.business.setupCompletedAt) redirect(`/b/${businessId}`);
  if (!ctx.actor.isOwner) redirect(`/b/${businessId}`);
  const t = await getTranslations("setup");
  const rules = await ctx.db.payRules.findUnique({ where: { businessId } });
  const roles = await ctx.db.role.findMany({ orderBy: { rank: "asc" } });
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <SetupWizard
        businessId={businessId}
        timezone={ctx.business.timezone}
        timezones={timezones()}
        anchorDefault={lastMonday()}
        presetLabel={rules?.presetKey ? PAY_PRESETS[rules.presetKey]?.label : undefined}
        payRules={{
          dailyThresholdHours: str(rules?.dailyThresholdHours),
          dailyMultiplier: str(rules?.dailyMultiplier),
          dailySecondThresholdHours: str(rules?.dailySecondThresholdHours),
          dailySecondMultiplier: str(rules?.dailySecondMultiplier),
          weeklyThresholdHours: str(rules?.weeklyThresholdHours),
          weeklyMultiplier: str(rules?.weeklyMultiplier),
          minimumDailyPayHours: str(rules?.minimumDailyPayHours),
          maxSplitShiftSpanHours: str(rules?.maxSplitShiftSpanHours),
          vacationPayPercent: str(ctx.business.vacationPayPercent),
          confirmed: false,
        }}
        roles={roles.map((r) => ({ id: r.id, name: r.name, rank: r.rank, permissionCount: r.isOwner ? -1 : parsePermissions(r.permissions).length }))}
      />
    </>
  );
}
