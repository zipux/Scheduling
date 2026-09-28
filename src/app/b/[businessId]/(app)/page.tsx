import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { needsAttention } from "@/server/services/invitations";
import { myUpcomingShifts, upcomingWarnings } from "@/server/services/schedule";
import { warningText } from "@/components/app/warning-text";
import { formatInTimeZone } from "date-fns-tz";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export async function generateMetadata() {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

export default async function DashboardPage({ params }: PageProps<"/b/[businessId]">) {
  const { businessId } = await params;
  const ctx = await requireBusinessPage(businessId);
  const t = await getTranslations("dashboard");
  const tw = await getTranslations("warnings");
  const shiftWarnings = await upcomingWarnings(ctx);
  const next = (await myUpcomingShifts(ctx, 14))[0];
  let invitationWarnings = 0;
  if (hasPermission(ctx, "employees.invite")) {
    const pending = await ctx.db.invitation.findMany({ where: { status: "pending" } });
    invitationWarnings = pending.filter((i) => needsAttention(i)).length;
  }
  return (
    <>
      {invitationWarnings > 0 && (
        <Alert variant="destructive" className="mb-4" data-testid="invitation-warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>{t("invitationWarningTitle", { count: invitationWarnings })}</AlertTitle>
          <AlertDescription>
            {t("invitationWarningBody")}{" "}
            <Link href={`/b/${businessId}/people`} className="font-medium underline">
              {t("reviewInvitations")}
            </Link>
          </AlertDescription>
        </Alert>
      )}
      <PageHeader title={t("welcome", { name: ctx.membership.displayName ?? ctx.userName })} description={ctx.membership.role.name} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("nextShift")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm" data-testid="next-shift">
            {next ? (
              <>
                <span className="block font-medium">
                  {formatInTimeZone(next.startsAt, next.location.timezone, "EEE d MMM")} ·{" "}
                  {formatInTimeZone(next.startsAt, next.location.timezone, "HH:mm")}–{formatInTimeZone(next.endsAt, next.location.timezone, "HH:mm")}
                </span>
                <span className="block text-muted-foreground">{[next.position?.name, next.location.name].filter(Boolean).join(" · ")}</span>
              </>
            ) : (
              <span className="text-muted-foreground">{t("noUpcomingShift")}</span>
            )}
          </CardContent>
        </Card>
        {hasPermission(ctx, "schedule.edit") && (
          <Card data-testid="dashboard-schedule-warnings">
            <CardHeader>
              <CardTitle className="text-base">{t("scheduleWarnings")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {shiftWarnings.length === 0 ? (
                <p className="text-muted-foreground">{t("scheduleWarningsNone")}</p>
              ) : (
                <ul className="space-y-2">
                  {shiftWarnings.slice(0, 6).map(({ shift, warnings }) => (
                    <li key={shift.id}>
                      <span className="font-medium">
                        {formatInTimeZone(shift.startsAt, shift.location.timezone, "EEE d MMM HH:mm")} ·{" "}
                        {shift.membership?.displayName ?? shift.membership?.user.name}
                      </span>
                      <ul className="list-disc pl-5 text-amber-800 dark:text-amber-300">
                        {warnings.map((w, i) => (
                          <li key={i}>{warningText(tw, w)}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
              <Link href={`/b/${businessId}/schedule`} className="inline-flex min-h-11 items-center underline">
                {t("openSchedule")}
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
