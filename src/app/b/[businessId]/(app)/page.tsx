import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { needsAttention } from "@/server/services/invitations";
import { myUpcomingShifts, upcomingWarnings } from "@/server/services/schedule";
import { openConflicts } from "@/server/services/requests/conflicts";
import { timeOffToReview } from "@/server/services/requests/timeoff";
import { availabilityToReview } from "@/server/services/requests/availability";
import { myTrades, tradesToReview } from "@/server/services/requests/trades";
import { ActionButton } from "@/components/app/action-button";
import { resolveConflictAction } from "./requests/actions";
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
  const conflicts = hasPermission(ctx, "schedule.edit") ? await openConflicts(ctx) : [];
  const [toReviewTimeOff, toReviewAvail, toReviewTrades, mine] = await Promise.all([timeOffToReview(ctx), availabilityToReview(ctx), tradesToReview(ctx), myTrades(ctx)]);
  const toReview = [...toReviewTimeOff, ...toReviewAvail, ...toReviewTrades];
  const escalated = toReview.filter((r) => r.escalated).length;
  const myPending = (await ctx.db.timeOffRequest.count({ where: { membershipId: ctx.membership.id, status: "pending" } })) + mine.length;
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("pendingRequests")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm" data-testid="dashboard-requests">
            <p>{t("myPending", { count: myPending })}</p>
            {toReview.length > 0 && (
              <p>
                <Link href={`/b/${businessId}/requests?tab=approvals`} className="underline">
                  {t("toReview", { count: toReview.length })}
                </Link>
                {escalated > 0 && <span className="ml-2 font-medium text-destructive">{t("escalated", { count: escalated })}</span>}
              </p>
            )}
          </CardContent>
        </Card>
        {conflicts.length > 0 && (
          <Card className="sm:col-span-2 lg:col-span-3" data-testid="dashboard-conflicts">
            <CardHeader>
              <CardTitle className="text-base">{t("conflicts", { count: conflicts.length })}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-sm">
                {conflicts.map(({ conflict, shift }) => (
                  <li key={conflict.id} className="rounded-md border p-2">
                    <p className="font-medium">
                      {formatInTimeZone(shift.startsAt, shift.location.timezone, "EEE d MMM HH:mm")}–{formatInTimeZone(shift.endsAt, shift.location.timezone, "HH:mm")} ·{" "}
                      {shift.membership?.displayName ?? shift.membership?.user.name} · {shift.location.name}
                    </p>
                    <p className="text-amber-800 dark:text-amber-300">{conflict.reason}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link
                        href={`/b/${businessId}/schedule?view=team&week=${formatInTimeZone(shift.startsAt, shift.location.timezone, "yyyy-MM-dd")}&loc=${shift.locationId}`}
                        className="inline-flex h-11 items-center rounded-lg border px-3 md:h-8"
                      >
                        {t("reassign")}
                      </Link>
                      <ActionButton action={resolveConflictAction} businessId={businessId} args={{ id: conflict.id, action: "make_open" }} label={t("makeOpen")} />
                      <ActionButton action={resolveConflictAction} businessId={businessId} args={{ id: conflict.id, action: "keep" }} label={t("keepAnyway")} variant="ghost" />
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
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
