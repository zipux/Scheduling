"use server";

import { z } from "zod";
import { requireBusinessAction, type BusinessContext } from "@/server/auth/context";
import { localToUtc } from "@/lib/time";
import { businessAction, toResult } from "@/server/action";
import { ClockError, punch, punchSchema } from "@/server/services/clock";
import {
  addEntry,
  addEntrySchema,
  correctionSchema,
  editEntry,
  editEntrySchema,
  entryHistory,
  requestCorrection,
  resolveFlag,
  resolveFlagSchema,
  reviewCorrection,
  reviewCorrectionSchema,
} from "@/server/services/time-corrections";

export type PunchResult =
  | { ok: true; data: { action: string; at: string; flags: string[] } }
  | { ok: false; error: string; code?: string; detail?: Record<string, unknown> };

async function run(businessId: string, input: unknown, offline?: { deviceTime: string }): Promise<PunchResult> {
  try {
    const ctx = await requireBusinessAction(businessId);
    const parsed = punchSchema.parse(input);
    const r = await punch(
      { businessId, membershipId: ctx.membership.id, source: "personal" },
      parsed,
      offline ? { deviceTime: new Date(offline.deviceTime), skipPin: true } : {},
    );
    return { ok: true, data: { action: r.action, at: r.at.toISOString(), flags: r.flags } };
  } catch (err) {
    if (err instanceof ClockError) return { ok: false, error: err.message, code: err.code, detail: err.detail };
    return toResult(err);
  }
}

/** Personal punch: the session identifies the person, the PIN confirms it (§7.1). */
export async function punchAction(businessId: string, input: z.input<typeof punchSchema>) {
  return run(businessId, input);
}

/**
 * Sync of a punch queued while offline. The session authenticates it; it is
 * flagged OFFLINE_QUEUED and provisional until a manager confirms it.
 */
export async function syncOfflinePunchAction(businessId: string, input: z.input<typeof punchSchema> & { deviceTime: string }) {
  const { deviceTime, ...rest } = input;
  if (!z.iso.datetime().safeParse(deviceTime).success) return { ok: false as const, error: "Invalid device time." };
  return run(businessId, { ...rest, pin: undefined }, { deviceTime });
}

// Times arrive as local wall-clock strings ("YYYY-MM-DDTHH:mm") and are converted
// here using the LOCATION's timezone — never the browser's.
const local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choose a date and time");
const optLocal = local.nullable().optional();
const toUtc = (v: string | null | undefined, tz: string) => (v ? localToUtc(v.slice(0, 10), v.slice(11, 16), tz) : null);

async function entryTz(ctx: BusinessContext, entryId: string | null) {
  if (entryId) {
    const e = await ctx.db.timeEntry.findUnique({ where: { id: entryId }, include: { location: { select: { timezone: true } } } });
    if (e) return e.location.timezone;
  }
  const ml = await ctx.db.membershipLocation.findFirst({ where: { membershipId: ctx.membership.id }, include: { location: { select: { timezone: true } } } });
  return ml?.location.timezone ?? ctx.business.timezone;
}

export const requestCorrectionAction = businessAction(
  z.object({ timeEntryId: z.string().min(1).nullable(), proposedClockIn: optLocal, proposedClockOut: optLocal, message: z.string() }),
  async (ctx, i) => {
    const tz = await entryTz(ctx, i.timeEntryId);
    return requestCorrection(ctx, correctionSchema.parse({ ...i, proposedClockIn: toUtc(i.proposedClockIn, tz), proposedClockOut: toUtc(i.proposedClockOut, tz) }));
  },
);

export const editEntryAction = businessAction(
  z.object({ entryId: z.string().min(1), clockIn: optLocal, clockOut: optLocal, reason: z.string() }),
  async (ctx, i) => {
    const tz = await entryTz(ctx, i.entryId);
    return editEntry(ctx, editEntrySchema.parse({ ...i, clockIn: toUtc(i.clockIn, tz), clockOut: toUtc(i.clockOut, tz) }));
  },
);

export const addEntryAction = businessAction(
  z.object({ membershipId: z.string().min(1), locationId: z.string().min(1), clockIn: local, clockOut: local, reason: z.string() }),
  async (ctx, i) => {
    const loc = await ctx.db.location.findUnique({ where: { id: i.locationId } });
    const tz = loc?.timezone ?? ctx.business.timezone;
    return addEntry(ctx, addEntrySchema.parse({ ...i, clockIn: toUtc(i.clockIn, tz), clockOut: toUtc(i.clockOut, tz) }));
  },
);
export const resolveFlagAction = businessAction(resolveFlagSchema, resolveFlag);
export const reviewCorrectionAction = businessAction(
  z.object({ id: z.string().min(1), approve: z.boolean(), clockIn: optLocal, clockOut: optLocal, reason: z.string() }),
  async (ctx, i) => {
    const c = await ctx.db.correctionRequest.findUnique({ where: { id: i.id } });
    const tz = c?.timeEntryId ? await entryTz(ctx, c.timeEntryId) : ctx.business.timezone;
    return reviewCorrection(
      ctx,
      reviewCorrectionSchema.parse({ ...i, clockIn: i.clockIn ? toUtc(i.clockIn, tz) : undefined, clockOut: i.clockOut ? toUtc(i.clockOut, tz) : undefined }),
    );
  },
);
export const entryHistoryAction = businessAction(z.object({ id: z.string().min(1) }), async (ctx, i) =>
  (await entryHistory(ctx, i.id)).map((a) => ({ id: a.id, action: a.action, reason: a.reason, at: a.createdAt.toISOString(), before: a.before, after: a.after })),
);
