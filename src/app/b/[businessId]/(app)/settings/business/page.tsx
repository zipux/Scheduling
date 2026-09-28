import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { PageHeader } from "@/components/app/page-header";
import { CURRENCIES, timezones } from "@/lib/regions";
import { BusinessInfoForm, ClockRulesForm, RequestRulesForm } from "./forms";

export default async function BusinessSettingsPage({ params }: PageProps<"/b/[businessId]/settings/business">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  if (!hasPermission(ctx, "business.settings")) notFound();
  const t = await getTranslations("settings.business");
  const b = ctx.business;
  return (
    <>
      <PageHeader title={t("title")} />
      <div className="max-w-lg space-y-10">
        <BusinessInfoForm
          businessId={businessId}
          timezones={timezones()}
          currencies={[...CURRENCIES]}
          initial={{
            name: b.name,
            timezone: b.timezone,
            currency: b.currency,
            minorAgeThreshold: String(b.minorAgeThreshold),
            burdenPercent: b.burdenPercent === null ? "" : String(b.burdenPercent),
            burdenNote: b.burdenNote ?? "",
            directoryShowsPhone: b.directoryShowsPhone,
            directoryShowsEmail: b.directoryShowsEmail,
          }}
        />
        <RequestRulesForm
          businessId={businessId}
          initial={{
            allowSelfTimeOffApproval: b.allowSelfTimeOffApproval,
            escalateAfterHours: String(b.escalateAfterHours),
            timeOffMinNoticeDays: String(b.timeOffMinNoticeDays),
            availabilityNeedsApproval: b.availabilityNeedsApproval,
            dropNeedsApproval: b.dropNeedsApproval,
            pickupNeedsApproval: b.pickupNeedsApproval,
            swapNeedsApproval: b.swapNeedsApproval,
          }}
        />
        <ClockRulesForm
          businessId={businessId}
          initial={{
            clockModePersonal: b.clockModePersonal,
            clockModeKiosk: b.clockModeKiosk,
            earlyClockInMinutes: String(b.earlyClockInMinutes),
            allowUnscheduledClockIn: b.allowUnscheduledClockIn,
            roundingMode: b.roundingMode,
            roundingIntervalMinutes: String(b.roundingIntervalMinutes || 15),
            lateToleranceMinutes: String(b.lateToleranceMinutes),
            maxShiftHours: String(b.maxShiftHours),
            maxClockSkewMinutes: String(b.maxClockSkewMinutes),
          }}
        />
      </div>
    </>
  );
}
