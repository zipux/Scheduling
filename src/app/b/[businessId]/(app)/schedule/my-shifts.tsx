import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatInTimeZone } from "date-fns-tz";
import { CalendarDays } from "lucide-react";
import type { BusinessContext } from "@/server/auth/context";
import { myUpcomingShifts } from "@/server/services/schedule";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { CalendarFeedButton } from "./calendar-feed-button";

/** Employee view: my upcoming published shifts (§5.3 "My shifts"). */
export async function MyShifts({ ctx, businessId, hasFeed }: { ctx: BusinessContext; businessId: string; canSeeTeam: boolean; hasFeed: boolean }) {
  const t = await getTranslations("schedule");
  const shifts = await myUpcomingShifts(ctx);
  return (
    <>
      <PageHeader
        title={t("myShifts")}
        actions={
          <Link href={`/b/${businessId}/schedule?view=team`} className="inline-flex h-11 items-center rounded-lg border px-4 text-sm md:h-9">
            {t("teamSchedule")}
          </Link>
        }
      />
      {shifts.length === 0 ? (
        <EmptyState icon={CalendarDays} title={t("noUpcoming")} body={t("noUpcomingBody")} />
      ) : (
        <ul className="space-y-2" data-testid="my-shifts">
          {shifts.map((s) => {
            const tz = s.location.timezone;
            return (
              <li key={s.id} className="flex items-stretch gap-3 rounded-lg border p-3">
                <span className="w-1 shrink-0 rounded-full" style={{ backgroundColor: s.position?.color ?? "#64748b" }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{formatInTimeZone(s.startsAt, tz, "EEE d MMM")}</span>
                  <span className="block tabular-nums">
                    {formatInTimeZone(s.startsAt, tz, "HH:mm")}–{formatInTimeZone(s.endsAt, tz, "HH:mm")}
                    {s.breakMinutes > 0 && <span className="text-sm text-muted-foreground"> · {t("breakShort", { minutes: s.breakMinutes })}</span>}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {[s.position?.name, s.location.name].filter(Boolean).join(" · ")}
                  </span>
                  {s.notes && <span className="mt-1 block text-sm">{s.notes}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <section className="mt-8 max-w-md space-y-2">
        <h2 className="font-medium">{t("addToCalendar")}</h2>
        <p className="text-sm text-muted-foreground">{t("addToCalendarHint")}</p>
        <CalendarFeedButton businessId={businessId} hasFeed={hasFeed} />
      </section>
    </>
  );
}
