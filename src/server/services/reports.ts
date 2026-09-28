import "server-only";
import { formatInTimeZone } from "date-fns-tz";
import { accessibleLocationIds, assertCan, type BusinessContext } from "@/server/auth/context";
import { can } from "@/lib/permissions";
import { audit } from "@/server/audit";
import { addDaysKey } from "@/lib/time";
import { workedSeconds } from "@/lib/pay/hours";
import { workDayOf, periodContaining, type Frequency, type Period } from "@/lib/pay/periods";
import { wageForPeriod } from "@/lib/wages";
import { csvCell, periodOverview } from "./timesheets";

/** A report is a plain table so the page and the CSV export share one source. */
export interface ReportTable {
  key: ReportKey;
  columns: string[];
  rows: (string | number)[][];
  note?: string;
}

export const REPORTS = ["hours", "wages", "attendance", "timeoff", "holidays"] as const;
export type ReportKey = (typeof REPORTS)[number];

const h = (s: number) => Number((s / 3600).toFixed(2));
const money = (c: number) => Number((c / 100).toFixed(2));

async function names(ctx: BusinessContext) {
  const ms = await ctx.db.membership.findMany({ include: { user: { select: { name: true } } } });
  return new Map(ms.map((m) => [m.id, m.displayName ?? m.user.name]));
}

function range(period: Period) {
  return { gte: new Date(`${addDaysKey(period.start, -1)}T00:00:00Z`), lt: new Date(`${addDaysKey(period.end, 2)}T00:00:00Z`) };
}

export async function buildReport(ctx: BusinessContext, key: ReportKey, period: Period): Promise<ReportTable> {
  assertCan(ctx, "reports.view");
  const money$ = can(ctx.actor, "wages.view");
  const allowed = await accessibleLocationIds(ctx);
  const b = ctx.business;
  const inP = (day: string) => day >= period.start && day <= period.end;

  if (key === "hours") {
    const rows = await periodOverview(ctx, period);
    return {
      key,
      columns: ["Employee", "Worked h", "Regular h", "Overtime h", "Break h", ...(money$ ? ["Gross"] : []), "Blocking flags"],
      rows: rows.map(({ person, result }) => [
        person.displayName ?? person.user.name,
        h(result.workedSeconds),
        h(result.regularSeconds),
        h(result.overtime.reduce((n, o) => n + o.seconds, 0)),
        h(result.breakSeconds),
        ...(money$ ? [money(result.grossCents)] : []),
        result.unresolvedFlags.filter((f) => f.blocking).length,
      ]),
    };
  }

  if (key === "wages") {
    if (!money$) return { key, columns: [], rows: [], note: "Needs permission to see wages." };
    const [entries, wages, positions] = await Promise.all([
      ctx.db.timeEntry.findMany({ where: { clockIn: range(period), locationId: { in: allowed } }, include: { breaks: true, location: { select: { name: true, timezone: true } } } }),
      ctx.db.wage.findMany(),
      ctx.db.position.findMany(),
    ]);
    const posName = new Map(positions.map((p) => [p.id, p.name]));
    const agg = new Map<string, { day: string; location: string; position: string; seconds: number; cents: number }>();
    for (const e of entries) {
      const secs = workedSeconds(e);
      if (secs === null || !e.clockIn) continue;
      const day = workDayOf(e.clockIn, e.location.timezone, b.workDayStartMinutes);
      if (!inP(day)) continue;
      const w = wageForPeriod(
        wages.filter((x) => x.membershipId === e.membershipId).map((x) => ({ rateCents: x.rateCents, type: x.type, positionId: x.positionId, effectiveFrom: x.effectiveFrom.toISOString().slice(0, 10) })),
        periodContaining(b.payPeriodFrequency as Frequency, b.payPeriodAnchorDate?.toISOString().slice(0, 10) ?? null, day).start,
        e.positionId,
      );
      const k = `${day}|${e.location.name}|${e.positionId ?? ""}`;
      const row = agg.get(k) ?? { day, location: e.location.name, position: e.positionId ? posName.get(e.positionId) ?? "—" : "—", seconds: 0, cents: 0 };
      row.seconds += secs;
      if (w?.type === "hourly") row.cents += Math.round((secs * w.rateCents) / 3600);
      agg.set(k, row);
    }
    return {
      key,
      columns: ["Work-day", "Location", "Position", "Hours", "Straight-time wages"],
      rows: [...agg.values()].sort((a, b2) => a.day.localeCompare(b2.day) || a.location.localeCompare(b2.location)).map((r) => [r.day, r.location, r.position, h(r.seconds), money(r.cents)]),
      note: "Actual hours × hourly wage, before overtime premiums. See Timesheets for gross pay.",
    };
  }

  if (key === "attendance") {
    const who = await names(ctx);
    const [flags, shifts, entries] = await Promise.all([
      ctx.db.timeEntryFlag.findMany({
        where: { type: { in: ["LATE", "EARLY_LEAVE", "MISSING_CLOCK_IN", "MISSING_CLOCK_OUT"] }, timeEntry: { locationId: { in: allowed }, OR: [{ clockIn: range(period) }, { clockIn: null, clockOut: range(period) }] } },
        include: { timeEntry: { include: { location: { select: { name: true, timezone: true } } } } },
      }),
      ctx.db.shift.findMany({ where: { status: "published", deletedAt: null, membershipId: { not: null }, locationId: { in: allowed }, startsAt: range(period), endsAt: { lt: new Date() } }, include: { location: { select: { name: true, timezone: true } } } }),
      ctx.db.timeEntry.findMany({ where: { locationId: { in: allowed }, OR: [{ clockIn: range(period) }, { clockOut: range(period) }] }, select: { membershipId: true, clockIn: true, clockOut: true, shiftId: true } }),
    ]);
    const rows: (string | number)[][] = [];
    for (const f of flags) {
      const at = f.timeEntry.clockIn ?? f.timeEntry.clockOut!;
      const day = workDayOf(at, f.timeEntry.location.timezone, b.workDayStartMinutes);
      if (!inP(day)) continue;
      rows.push([day, who.get(f.timeEntry.membershipId) ?? "—", f.timeEntry.location.name, f.type, formatInTimeZone(at, f.timeEntry.location.timezone, "HH:mm"), f.resolvedAt ? "resolved" : "open"]);
    }
    // No-show: a past published shift with no entry for that person overlapping it.
    for (const s of shifts) {
      const day = formatInTimeZone(s.startsAt, s.location.timezone, "yyyy-MM-dd");
      if (!inP(day)) continue;
      const showed = entries.some((e) => e.membershipId === s.membershipId && (e.shiftId === s.id || ((e.clockIn ?? e.clockOut!) < s.endsAt && (e.clockOut ?? e.clockIn!) > s.startsAt)));
      if (!showed) rows.push([day, who.get(s.membershipId!) ?? "—", s.location.name, "NO_SHOW", formatInTimeZone(s.startsAt, s.location.timezone, "HH:mm"), "—"]);
    }
    rows.sort((a, c) => String(a[0]).localeCompare(String(c[0])));
    return { key, columns: ["Work-day", "Employee", "Location", "Event", "Time", "Status"], rows };
  }

  if (key === "timeoff") {
    const who = await names(ctx);
    const reqs = await ctx.db.timeOffRequest.findMany({
      where: { status: { in: ["approved", "pending"] }, startsAt: { lt: new Date(`${addDaysKey(period.end, 1)}T12:00:00Z`) }, endsAt: { gt: new Date(`${period.start}T00:00:00Z`) } },
      orderBy: { startsAt: "asc" },
    });
    return {
      key,
      columns: ["Employee", "Type", "Status", "From", "To", "Hours"],
      rows: reqs.map((r) => [
        who.get(r.membershipId) ?? "—",
        r.type,
        r.status,
        formatInTimeZone(r.startsAt, b.timezone, "yyyy-MM-dd HH:mm"),
        formatInTimeZone(r.endsAt, b.timezone, "yyyy-MM-dd HH:mm"),
        r.allDay ? "" : h((r.endsAt.getTime() - r.startsAt.getTime()) / 1000),
      ]),
    };
  }

  // holidays
  const rows = await periodOverview(ctx, period);
  const holidays = new Map((await ctx.db.holiday.findMany()).map((x) => [x.id, x]));
  const out: (string | number)[][] = [];
  for (const { person, result } of rows) {
    for (const v of result.holidays) {
      const hol = holidays.get(v.holidayId);
      out.push([
        hol?.date.toISOString().slice(0, 10) ?? "",
        hol?.name ?? "",
        person.displayName ?? person.user.name,
        v.worked ? "worked" : "not worked",
        v.eligible ? "eligible" : "not eligible",
        v.inputs.employmentDays ?? "",
        v.inputs.daysWorkedInLookback,
        h(v.premiumSeconds),
        ...(money$ ? [money(v.premiumCents), money(v.holidayPayCents)] : []),
        v.inputs.overridden ? `override: ${v.inputs.overrideReason ?? ""}` : "",
      ]);
    }
  }
  return {
    key,
    columns: ["Date", "Holiday", "Employee", "Worked", "Eligibility", "Days employed", "Days worked (lookback)", "Premium h", ...(money$ ? ["Premium pay", "Holiday pay"] : []), "Override"],
    rows: out,
  };
}

export async function reportCsv(ctx: BusinessContext, key: ReportKey, period: Period) {
  const t = await buildReport(ctx, key, period);
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "EXPORT", targetType: `Report:${key}`, data: { period: { ...period } } });
  return [t.columns, ...t.rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
