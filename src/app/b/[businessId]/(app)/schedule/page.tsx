import { getTranslations } from "next-intl/server";
import { CalendarX2 } from "lucide-react";
import { hasPermission, requireBusinessPage } from "@/server/auth/context";
import { currentWeekStart, loadWeek, templateTimes } from "@/server/services/schedule";
import { resolveLocationScope } from "@/server/services/location-scope";
import { hasCalendarFeed } from "@/server/platform/calendar";
import { addDaysKey, dateKeyInTz, isDateKey, timeInTz, weekStartKey } from "@/lib/time";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { ScheduleBoard } from "./schedule-board";
import { MyShifts } from "./my-shifts";
import type { BoardData } from "./types";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("schedule") };
}

export default async function SchedulePage({ params, searchParams }: PageProps<"/b/[businessId]/schedule">) {
  const { businessId } = await params;
  const sp = await searchParams;
  const ctx = await requireBusinessPage(businessId);
  const t = await getTranslations("schedule");
  const canEdit = hasPermission(ctx, "schedule.edit");
  const view = sp.view === "mine" || (!canEdit && sp.view !== "team") ? "mine" : "team";

  const scope = await resolveLocationScope(ctx, typeof sp.loc === "string" ? sp.loc : null);
  if (!scope.options.length) {
    return (
      <>
        <PageHeader title={t("title")} />
        <EmptyState icon={CalendarX2} title={t("noLocations")} body={t("noLocationsBody")} />
      </>
    );
  }
  const tz = scope.options.find((o) => o.id === scope.selected)?.timezone ?? ctx.business.timezone;
  const today = dateKeyInTz(new Date(), tz);

  if (view === "mine") {
    return (
      <MyShifts
        ctx={ctx}
        businessId={businessId}
        canSeeTeam
        hasFeed={await hasCalendarFeed(ctx.userId)}
      />
    );
  }

  const weekStart = typeof sp.week === "string" && isDateKey(sp.week) ? weekStartKey(sp.week) : currentWeekStart(tz);
  const week = await loadWeek(ctx, weekStart, scope.ids);
  const templates = canEdit ? await ctx.db.shiftTemplate.findMany({ orderBy: { name: "asc" } }) : [];
  const positions = await ctx.db.position.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } });
  const now = new Date();

  const data: BoardData = {
    businessId,
    weekStart,
    prevWeek: addDaysKey(weekStart, -7),
    nextWeek: addDaysKey(weekStart, 7),
    thisWeek: currentWeekStart(tz),
    days: week.days,
    today,
    shifts: week.shifts.map((s) => {
      const ltz = s.location.timezone;
      return {
        id: s.id,
        membershipId: s.membershipId,
        date: dateKeyInTz(s.startsAt, ltz),
        start: timeInTz(s.startsAt, ltz),
        end: timeInTz(s.endsAt, ltz),
        breakMinutes: s.breakMinutes,
        locationId: s.locationId,
        locationName: s.location.name,
        positionId: s.positionId,
        positionName: s.position?.name ?? null,
        color: s.position?.color ?? "#64748b",
        status: s.status,
        notes: s.notes ?? "",
        past: s.endsAt < now,
        // Persistent warnings: shown until resolved or the shift is in the past (§5.1).
        warnings: s.endsAt < now ? [] : (week.warnings.get(s.id) ?? []),
        geofenceOverride: (s.geofenceOverride as BoardData["shifts"][number]["geofenceOverride"]) ?? null,
      };
    }),
    members: week.members.map((m) => ({
      id: m.id,
      name: m.displayName ?? m.user.name,
      positionIds: m.positions.map((p) => p.positionId),
      locationIds: m.locations.map((l) => l.locationId),
    })),
    positions: positions.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    locations: week.locations.map((l) => ({ id: l.id, name: l.name, timezone: l.timezone })),
    scope: { options: scope.options.map((o) => ({ id: o.id, name: o.name })), selected: scope.selected, showSwitcher: scope.showSwitcher },
    templates: templates.map((tp) => ({
      id: tp.id,
      name: tp.name,
      ...templateTimes(tp),
      breakMinutes: tp.breakMinutes,
      locationId: tp.locationId,
      positionId: tp.positionId,
    })),
    holidays: week.holidays.map((h) => ({ date: h.date.toISOString().slice(0, 10), name: h.name, isStatutory: h.isStatutory })),
    canEdit,
    canPublish: hasPermission(ctx, "schedule.publish"),
    wages: week.wages
      ? {
          currency: ctx.business.currency,
          byDay: week.wages.byDay,
          week: week.wages.week,
          burdenPercent: ctx.business.burdenPercent === null ? null : Number(ctx.business.burdenPercent),
          burdenNote: ctx.business.burdenNote,
          missingWage: week.wages.missingWage,
        }
      : null,
    draftCount: week.shifts.filter((s) => s.status === "draft").length,
  };
  return <ScheduleBoard data={data} />;
}
