import "server-only";
import { z } from "zod";
import { accessibleLocationIds, assertCan, ForbiddenError, type BusinessContext } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { can, canManagePerson, canViewWage } from "@/lib/permissions";
import { addDaysKey, dateKeyInTz, isDateKey } from "@/lib/time";
import { calculateTimesheet, entryWorkDay, type PayEntry, type TimesheetInput, type TimesheetResult } from "@/lib/pay/calculate";
import { periodContaining, inPeriod, type Frequency, type Period } from "@/lib/pay/periods";
import { approvalGate } from "@/lib/pay/approval";
import type { TimeFlag } from "@/lib/time-flags";
import { notify } from "./requests/common";

/**
 * Timesheets (§7.5). All arithmetic is §7.6 (src/lib/pay). This module only
 * gathers inputs from the database and persists approvals.
 */

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const dkey = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export function periodFor(ctx: BusinessContext, day?: string): Period {
  const d = day && isDateKey(day) ? day : dateKeyInTz(new Date(), ctx.business.timezone);
  return periodContaining(ctx.business.payPeriodFrequency as Frequency, dkey(ctx.business.payPeriodAnchorDate), d);
}

async function payConfig(ctx: BusinessContext) {
  const [rules, breakRules, holidays] = await Promise.all([
    ctx.db.payRules.findUniqueOrThrow({ where: { businessId: ctx.businessId } }),
    ctx.db.breakRule.findMany(),
    ctx.db.holiday.findMany({ orderBy: { date: "asc" } }),
  ]);
  return { rules, breakRules, holidays };
}

type Config = Awaited<ReturnType<typeof payConfig>>;

/** Loads everything needed to calculate timesheets for several people in one period. */
async function loadInputs(ctx: BusinessContext, membershipIds: string[], period: Period, cfg: Config, endOverride?: string) {
  const lookback = Math.max(cfg.rules.holidayLookbackDays, ...cfg.holidays.map((h) => Number((h.eligibilityRule as { lookbackDays?: number } | null)?.lookbackDays ?? 0)));
  // Wide UTC window: work-days are local and can start before/after midnight UTC.
  const from = new Date(`${addDaysKey(period.start, -lookback - 2)}T00:00:00Z`);
  const to = new Date(`${addDaysKey(period.end, 2)}T00:00:00Z`);
  const [entries, wages, members, entitlements] = await Promise.all([
    ctx.db.timeEntry.findMany({
      where: {
        membershipId: { in: membershipIds },
        OR: [{ clockIn: { gte: from, lt: to } }, { clockIn: null, clockOut: { gte: from, lt: to } }],
      },
      include: { breaks: true, flags: true, location: { select: { timezone: true } } },
    }),
    ctx.db.wage.findMany({ where: { membershipId: { in: membershipIds } } }),
    ctx.db.membership.findMany({ where: { id: { in: membershipIds } } }),
    ctx.db.holidayEntitlement.findMany({ where: { membershipId: { in: membershipIds } } }),
  ]);
  const b = ctx.business;
  const r = cfg.rules;
  const out = new Map<string, TimesheetInput>();
  for (const m of members) {
    const effective: Period = { start: period.start, end: endOverride && endOverride < period.end ? endOverride : period.end };
    const mine: PayEntry[] = entries
      .filter((e) => e.membershipId === m.id)
      .map((e) => ({
        id: e.id,
        tz: e.location.timezone,
        positionId: e.positionId,
        clockIn: e.clockIn,
        clockOut: e.clockOut,
        clockInRounded: e.clockInRounded,
        clockOutRounded: e.clockOutRounded,
        breaks: e.breaks.map((x) => ({ startsAt: x.startsAt, endsAt: x.endsAt, paid: x.paid })),
        flags: e.flags.map((f) => ({ id: f.id, type: f.type as TimeFlag, resolved: !!f.resolvedAt })),
      }));
    out.set(m.id, {
      period: effective,
      frequency: b.payPeriodFrequency as Frequency,
      anchor: dkey(b.payPeriodAnchorDate),
      workDayStartMinutes: b.workDayStartMinutes,
      rules: {
        dailyThresholdHours: num(r.dailyThresholdHours),
        dailyMultiplier: num(r.dailyMultiplier),
        dailySecondThresholdHours: num(r.dailySecondThresholdHours),
        dailySecondMultiplier: num(r.dailySecondMultiplier),
        weeklyThresholdHours: num(r.weeklyThresholdHours),
        weeklyMultiplier: num(r.weeklyMultiplier),
        minimumDailyPayHours: num(r.minimumDailyPayHours),
      },
      vacationPayPercent: Number(b.vacationPayPercent),
      breakRules: cfg.breakRules.map((x) => ({ id: x.id, afterHours: Number(x.afterHours), breakMinutes: x.breakMinutes })),
      holidayRule: { minEmploymentDays: r.holidayMinEmploymentDays, minDaysWorked: r.holidayMinDaysWorkedLookback, lookbackDays: r.holidayLookbackDays },
      average: { divisor: (r.holidayAverageDivisor as "days_worked" | "fixed" | null) ?? null, fixedDivisor: r.holidayAverageFixedDivisor },
      wages: wages
        .filter((w) => w.membershipId === m.id)
        .map((w) => ({ rateCents: w.rateCents, type: w.type, positionId: w.positionId, effectiveFrom: w.effectiveFrom.toISOString().slice(0, 10) })),
      hireDate: dkey(m.hireDate),
      entries: mine,
      holidays: cfg.holidays.map((h) => {
        const ent = entitlements.find((x) => x.holidayId === h.id && x.membershipId === m.id);
        const rule = h.eligibilityRule as { minEmploymentDays?: number; minDaysWorked?: number; lookbackDays?: number } | null;
        return {
          id: h.id,
          date: h.date.toISOString().slice(0, 10),
          name: h.name,
          isStatutory: h.isStatutory,
          premiumMultiplier: Number(h.premiumMultiplier),
          eligibilityRule: rule,
          override: ent?.overrideEligible !== null && ent?.overrideEligible !== undefined ? { eligible: ent.overrideEligible, reason: ent.overrideReason ?? "" } : null,
        };
      }),
    });
  }
  return out;
}

/** People who belong on a period's timesheets: employed during it (incl. deactivated staff, §11), or with time in it. */
async function peopleForPeriod(ctx: BusinessContext, period: Period) {
  const allowed = await accessibleLocationIds(ctx);
  const scopeAll = ctx.actor.isOwner || ctx.actor.permissions.has("locations.scope_all");
  const start = new Date(`${period.start}T00:00:00Z`);
  const end = new Date(`${period.end}T00:00:00Z`);
  return ctx.db.membership.findMany({
    where: {
      AND: [
        { OR: [{ hireDate: null }, { hireDate: { lte: end } }] },
        { OR: [{ employmentEndedAt: null }, { employmentEndedAt: { gte: start } }] },
        scopeAll ? {} : { locations: { some: { locationId: { in: allowed } } } },
      ],
    },
    include: { user: { select: { name: true } }, role: true },
    orderBy: [{ role: { rank: "asc" } }, { createdAt: "asc" }],
  });
}

export async function periodOverview(ctx: BusinessContext, period: Period) {
  if (!can(ctx.actor, "timesheets.approve") && !can(ctx.actor, "reports.view")) throw new ForbiddenError();
  const cfg = await payConfig(ctx);
  const people = await peopleForPeriod(ctx, period);
  const inputs = await loadInputs(ctx, people.map((p) => p.id), period, cfg);
  const pp = await ctx.db.payPeriod.findUnique({ where: { businessId_startDate: { businessId: ctx.businessId, startDate: new Date(`${period.start}T00:00:00Z`) } } });
  const sheets = pp ? await ctx.db.timesheet.findMany({ where: { payPeriodId: pp.id } }) : [];
  return people
    .map((p) => {
      const sheet = sheets.find((s) => s.membershipId === p.id);
      // An approved timesheet shows its approval-time snapshot: approved numbers never move.
      const result = sheet?.status === "approved" && sheet.totals ? (sheet.totals as unknown as TimesheetResult) : calculateTimesheet(inputs.get(p.id)!);
      return { person: p, result, sheet: sheet ?? null };
    })
    .filter((x) => x.result.days.length > 0 || x.person.status === "active" || x.sheet);
}

export async function timesheetDetail(ctx: BusinessContext, membershipId: string, period: Period) {
  const m = await ctx.db.membership.findUnique({ where: { id: membershipId }, include: { user: { select: { name: true } }, role: true } });
  if (!m) throw new UserError("Person not found.");
  const self = m.id === ctx.membership.id;
  if (!self && !can(ctx.actor, "timesheets.approve") && !can(ctx.actor, "reports.view")) throw new ForbiddenError();
  // Wages are visible to the person themselves or with wages.view (§3.3).
  const showMoney = canViewWage(ctx.actor, m.id);
  const cfg = await payConfig(ctx);
  const pp = await ctx.db.payPeriod.findUnique({ where: { businessId_startDate: { businessId: ctx.businessId, startDate: new Date(`${period.start}T00:00:00Z`) } } });
  const sheet = pp ? await ctx.db.timesheet.findUnique({ where: { payPeriodId_membershipId: { payPeriodId: pp.id, membershipId: m.id } } }) : null;
  const endOverride = sheet?.isFinal ? (sheet.totals as unknown as TimesheetResult | null)?.period.end : undefined;
  const input = (await loadInputs(ctx, [m.id], period, cfg, endOverride)).get(m.id)!;
  const live = calculateTimesheet(input);
  const result = sheet?.status === "approved" && sheet.totals ? (sheet.totals as unknown as TimesheetResult) : live;
  const entries = input.entries.filter((e) => {
    const d = entryWorkDay(e, input.workDayStartMinutes);
    return d && inPeriod(result.period, d);
  });
  const balance = await vacationBalance(ctx, m.id);
  return { person: m, result, live, sheet, entries, showMoney, self, balanceCents: showMoney ? balance : null };
}

export async function vacationBalance(ctx: BusinessContext, membershipId: string) {
  const agg = await ctx.db.vacationAccrual.aggregate({ where: { membershipId }, _sum: { amountCents: true } });
  return agg._sum.amountCents ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Approval, locking, reopening, final timesheet
// ─────────────────────────────────────────────────────────────────────────────

export const approveSchema = z.object({
  membershipId: z.string().min(1),
  periodStart: z.string().refine(isDateKey),
  withExceptions: z.boolean().default(false),
  final: z.boolean().default(false),
});

export async function approveTimesheet(ctx: BusinessContext, input: z.infer<typeof approveSchema>) {
  assertCan(ctx, "timesheets.approve");
  const m = await ctx.db.membership.findUnique({ where: { id: input.membershipId }, include: { role: true } });
  if (!m) throw new UserError("Person not found.");
  if (m.id === ctx.membership.id) throw new ForbiddenError("You can't approve your own timesheet.");
  if (!canManagePerson(ctx.actor, { membershipId: m.id, rank: m.role.rank }, "timesheets.approve")) {
    throw new UserError("You can only approve timesheets for people junior to you.");
  }
  const period = periodFor(ctx, input.periodStart);
  if (period.start !== input.periodStart) throw new UserError("That isn't the start of a pay period.");

  // Final timesheet (§11): closes out a partial period at the employment end date.
  let endOverride: string | undefined;
  if (input.final) {
    const end = dkey(m.employmentEndedAt);
    if (!end || !inPeriod(period, end)) throw new UserError("A final timesheet needs an employment end date inside this period.");
    endOverride = end;
  }

  // A normal approval is for a finished period; a Final timesheet may close one early.
  const today = dateKeyInTz(new Date(), ctx.business.timezone);
  if (!input.final && period.end >= today) throw new UserError(`This pay period ends on ${period.end}. Approve it after it has ended.`);

  const cfg = await payConfig(ctx);
  const inputData = (await loadInputs(ctx, [m.id], period, cfg, endOverride)).get(m.id)!;
  const result = calculateTimesheet(inputData);
  // Someone still clocked in: that time isn't payable yet, so approving now would silently drop it.
  const stillOpen = inputData.entries.filter((e) => e.clockIn && !e.clockOut && result.unpayableEntryIds.includes(e.id) && !e.flags.some((f) => !f.resolved && f.type === "MISSING_CLOCK_OUT"));
  if (stillOpen.length) throw new UserError("This person is still clocked in on an entry in this period. Approve after they clock out.");
  const gate = approvalGate(result, { isOwner: ctx.actor.isOwner, withExceptions: input.withExceptions });
  if (!gate.allowed) {
    throw new UserError(
      gate.reason === "CALCULATION_BLOCKED"
        ? `This timesheet can't be calculated yet: ${result.blocked.map((b) => b.detail).join(" ")}`
        : `${gate.count} unresolved ${gate.count === 1 ? "entry blocks" : "entries block"} approval. Resolve them first${ctx.actor.isOwner ? ", or approve with exceptions" : ""}.`,
    );
  }

  const pp = await ctx.db.payPeriod.upsert({
    where: { businessId_startDate: { businessId: ctx.businessId, startDate: new Date(`${period.start}T00:00:00Z`) } },
    create: { startDate: new Date(`${period.start}T00:00:00Z`), endDate: new Date(`${period.end}T00:00:00Z`) } as never,
    update: {},
  });
  // The row exists before the transaction so rows written inside it can reference it
  // (the tenant layer verifies references outside the transaction).
  const existing =
    (await ctx.db.timesheet.findUnique({ where: { payPeriodId_membershipId: { payPeriodId: pp.id, membershipId: m.id } } })) ??
    (await ctx.db.timesheet.create({ data: { payPeriodId: pp.id, membershipId: m.id, status: "open" } as never }));
  if (existing.status === "approved") throw new UserError("This timesheet is already approved.");

  const now = new Date();
  const entryIds = result.days.flatMap((d) => d.entryIds);
  await ctx.db.$transaction(async (tx) => {
    const approved = await tx.timesheet.updateMany({
      where: { id: existing.id, status: "open" },
      data: { status: "approved", totals: JSON.parse(JSON.stringify(result)), grossCents: result.grossCents, approvedById: ctx.userId, approvedAt: now, approvedWithExceptions: gate.exceptions.length > 0, isFinal: input.final },
    });
    if (approved.count !== 1) throw new UserError("This timesheet is already approved.");
    const sheet = existing;
    // Approving locks the entries (§7.5): later edits need an Owner and are audited.
    await tx.timeEntry.updateMany({ where: { id: { in: entryIds } }, data: { lockedAt: now } });
    // §7.6.5: accrual recorded per approved timesheet.
    if (result.vacationAccruedCents) {
      await tx.vacationAccrual.create({ data: { membershipId: m.id, timesheetId: sheet.id, amountCents: result.vacationAccruedCents, kind: "accrual", actorUserId: ctx.userId } as never });
    }
    // Entitlement records with the inputs that produced each verdict (§7.6.4).
    for (const h of result.holidays) {
      const data = {
        worked: h.worked,
        eligible: h.eligible,
        inputs: JSON.parse(JSON.stringify(h.inputs)),
        premiumHours: Math.round((h.premiumSeconds / 3600) * 100) / 100,
        amountCents: h.premiumCents + h.holidayPayCents,
      };
      await tx.holidayEntitlement.upsert({
        where: { holidayId_membershipId: { holidayId: h.holidayId, membershipId: m.id } },
        create: { holidayId: h.holidayId, membershipId: m.id, ...data } as never,
        update: data,
      });
    }
  });
  await audit({
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action: input.final ? "FINAL_TIMESHEET_APPROVED" : "TIMESHEET_APPROVED",
    targetType: "Membership",
    targetId: m.id,
    data: { period: { ...period }, grossCents: result.grossCents, withExceptions: gate.exceptions.length },
  });
  // Each unresolved flag approved over is written individually (§7.6.7).
  for (const f of gate.exceptions) {
    await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "APPROVED_WITH_EXCEPTION", targetType: "TimeEntryFlag", targetId: f.flagId, data: { entryId: f.entryId, flag: f.type, membershipId: m.id, period: { ...period } } });
  }
  // The period is approved once every timesheet in it is.
  const remaining = (await periodOverview(ctx, period)).filter((x) => x.sheet?.status !== "approved" && x.person.id !== m.id);
  if (!remaining.length) await ctx.db.payPeriod.update({ where: { id: pp.id }, data: { status: "approved" } });
  await notify(ctx.db, m.id, "timesheet.approved", "Your timesheet was approved", `Pay period ${period.start} – ${period.end}.`);
  return { grossCents: result.grossCents, exceptions: gate.exceptions.length };
}

export const reopenSchema = z.object({ membershipId: z.string().min(1), periodStart: z.string().refine(isDateKey), reason: z.string().trim().min(3, "Give a reason").max(500) });

/** Owner-only: reopen an approved timesheet (unlocks its entries, reverses its accrual), audited. */
export async function reopenTimesheet(ctx: BusinessContext, input: z.infer<typeof reopenSchema>) {
  if (!ctx.actor.isOwner) throw new ForbiddenError("Only an Owner can reopen an approved timesheet.");
  const pp = await ctx.db.payPeriod.findUnique({ where: { businessId_startDate: { businessId: ctx.businessId, startDate: new Date(`${input.periodStart}T00:00:00Z`) } } });
  const sheet = pp && (await ctx.db.timesheet.findUnique({ where: { payPeriodId_membershipId: { payPeriodId: pp.id, membershipId: input.membershipId } } }));
  if (!pp || !sheet || sheet.status !== "approved") throw new UserError("Nothing to reopen.");
  const totals = sheet.totals as unknown as TimesheetResult;
  await ctx.db.$transaction(async (tx) => {
    await tx.timesheet.update({ where: { id: sheet.id }, data: { status: "open", approvedAt: null, approvedById: null } });
    await tx.payPeriod.update({ where: { id: pp.id }, data: { status: "open" } });
    await tx.timeEntry.updateMany({ where: { id: { in: totals.days.flatMap((d) => d.entryIds) } }, data: { lockedAt: null } });
    if (totals.vacationAccruedCents) {
      await tx.vacationAccrual.create({ data: { membershipId: input.membershipId, timesheetId: sheet.id, amountCents: -totals.vacationAccruedCents, kind: "adjustment", reason: `Timesheet reopened: ${input.reason}`, actorUserId: ctx.userId } as never });
    }
  });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "TIMESHEET_REOPENED", targetType: "Membership", targetId: input.membershipId, data: { periodStart: input.periodStart, reason: input.reason } });
}

export const vacationAdjustSchema = z.object({ membershipId: z.string().min(1), amountCents: z.number().int().refine((v) => v !== 0, "Enter an amount"), reason: z.string().trim().min(3, "Give a reason").max(300) });

/** §7.6.5: manual balance adjustment (e.g. vacation paid out), with a reason. */
export async function adjustVacation(ctx: BusinessContext, input: z.infer<typeof vacationAdjustSchema>) {
  assertCan(ctx, "wages.edit");
  const m = await ctx.db.membership.findUnique({ where: { id: input.membershipId }, include: { role: true } });
  if (!m) throw new UserError("Person not found.");
  if (m.id === ctx.membership.id || !canManagePerson(ctx.actor, { membershipId: m.id, rank: m.role.rank }, "wages.edit")) throw new UserError("You can only adjust balances for people junior to you.");
  await ctx.db.vacationAccrual.create({ data: { membershipId: m.id, amountCents: input.amountCents, kind: "adjustment", reason: input.reason, actorUserId: ctx.userId } as never });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "VACATION_ADJUSTED", targetType: "Membership", targetId: m.id, data: input });
}

export const overrideEntitlementSchema = z.object({
  holidayId: z.string().min(1),
  membershipId: z.string().min(1),
  eligible: z.boolean().nullable(),
  reason: z.string().trim().max(300).default(""),
}).refine((v) => v.eligible === null || v.reason.length >= 3, { path: ["reason"], message: "Give a reason" });

/** §7.6.4: manual override of a holiday verdict, carrying a reason. null clears it. */
export async function overrideEntitlement(ctx: BusinessContext, input: z.infer<typeof overrideEntitlementSchema>) {
  assertCan(ctx, "holidays.manage");
  const data = { overrideEligible: input.eligible, overrideReason: input.eligible === null ? null : input.reason, overrideById: input.eligible === null ? null : ctx.userId };
  await ctx.db.holidayEntitlement.upsert({
    where: { holidayId_membershipId: { holidayId: input.holidayId, membershipId: input.membershipId } },
    create: { holidayId: input.holidayId, membershipId: input.membershipId, worked: false, eligible: !!input.eligible, inputs: {}, ...data } as never,
    update: data,
  });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "HOLIDAY_ENTITLEMENT_OVERRIDDEN", targetType: "Holiday", targetId: input.holidayId, data: input });
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV export (§7.5)
// ─────────────────────────────────────────────────────────────────────────────

export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formula injection and quote as needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const hours = (s: number) => (s / 3600).toFixed(2);
const money = (c: number) => (c / 100).toFixed(2);

export async function payrollCsv(ctx: BusinessContext, period: Period) {
  if (!can(ctx.actor, "reports.view") && !can(ctx.actor, "timesheets.approve")) throw new ForbiddenError();
  if (!can(ctx.actor, "wages.view")) throw new ForbiddenError("Exporting payroll needs permission to see wages.");
  const rows = await periodOverview(ctx, period);
  const holidays = (await ctx.db.holiday.findMany({ where: { isStatutory: true, date: { gte: new Date(`${period.start}T00:00:00Z`), lte: new Date(`${period.end}T00:00:00Z`) } }, orderBy: { date: "asc" } }));
  const multipliers = [...new Set(rows.flatMap((r) => r.result.overtime.map((o) => o.multiplier)))].sort();
  const header = [
    "Employee",
    "Employee ID",
    "Status",
    "Employment ended",
    "Regular hours",
    ...multipliers.map((m) => `Overtime hours x${m}`),
    "Break hours",
    "Minimum pay top-up hours",
    ...holidays.flatMap((h) => [`${h.name} ${h.date.toISOString().slice(0, 10)} premium hours`, `${h.name} premium pay`, `${h.name} holiday pay`]),
    "Gross pay",
    "Vacation accrued",
    "Vacation balance",
    "Timesheet",
    "Unresolved blocking flags",
    "Blocked calculation",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const { person, result, sheet } of rows) {
    const bal = await vacationBalance(ctx, person.id);
    const hv = (id: string) => result.holidays.find((h) => h.holidayId === id);
    lines.push(
      [
        person.displayName ?? person.user.name,
        person.id,
        person.status,
        dkey(person.employmentEndedAt) ?? "",
        hours(result.regularSeconds),
        ...multipliers.map((m) => hours(result.overtime.filter((o) => o.multiplier === m).reduce((n, o) => n + o.seconds, 0))),
        hours(result.breakSeconds),
        hours(result.topUpSeconds),
        ...holidays.flatMap((h) => [hours(hv(h.id)?.premiumSeconds ?? 0), money(hv(h.id)?.premiumCents ?? 0), money(hv(h.id)?.holidayPayCents ?? 0)]),
        money(result.grossCents),
        money(result.vacationAccruedCents),
        money(bal),
        sheet?.status === "approved" ? (sheet.isFinal ? "approved (final)" : "approved") : "not approved",
        result.unresolvedFlags.filter((f) => f.blocking).length,
        result.blocked.map((b) => b.code).join(" "),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "EXPORT", targetType: "PayrollCsv", data: { period: { ...period } } });
  return lines.join("\r\n") + "\r\n";
}
