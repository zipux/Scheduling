"use server";

import { z } from "zod";
import { businessAction } from "@/server/action";
import { blackoutSchema, cancelTimeOff, createBlackout, deleteBlackout, requestTimeOff, reviewSchema, reviewTimeOff, timeOffSchema } from "@/server/services/requests/timeoff";
import { availabilitySchema, cancelAvailability, reviewAvailability, reviewAvailabilitySchema, submitAvailability } from "@/server/services/requests/availability";
import {
  cancelTrade,
  claimShift,
  dropShift,
  proposeSwap,
  respondSwapSchema,
  respondToSwap,
  reviewTrade,
  reviewTradeSchema,
  swapCandidates,
  swapSchema,
} from "@/server/services/requests/trades";
import { resolveConflict, resolveConflictSchema } from "@/server/services/requests/conflicts";
import { dateKeyInTz, timeInTz } from "@/lib/time";

const id = z.object({ id: z.string().min(1) });

export const requestTimeOffAction = businessAction(timeOffSchema, requestTimeOff);
export const cancelTimeOffAction = businessAction(id, (ctx, i) => cancelTimeOff(ctx, i.id));
export const reviewTimeOffAction = businessAction(reviewSchema, reviewTimeOff);

export const submitAvailabilityAction = businessAction(availabilitySchema, submitAvailability);
export const cancelAvailabilityAction = businessAction(z.object({ requestId: z.string().min(1) }), (ctx, i) => cancelAvailability(ctx, i.requestId));
export const reviewAvailabilityAction = businessAction(reviewAvailabilitySchema, reviewAvailability);

export const dropShiftAction = businessAction(id, (ctx, i) => dropShift(ctx, i.id));
export const claimShiftAction = businessAction(id, (ctx, i) => claimShift(ctx, i.id));
export const proposeSwapAction = businessAction(swapSchema, proposeSwap);
export const respondSwapAction = businessAction(respondSwapSchema, respondToSwap);
export const reviewTradeAction = businessAction(reviewTradeSchema, reviewTrade);
export const cancelTradeAction = businessAction(id, (ctx, i) => cancelTrade(ctx, i.id));
export const swapCandidatesAction = businessAction(id, async (ctx, i) =>
  (await swapCandidates(ctx, i.id)).map((s) => ({
    id: s.id,
    who: s.membership?.displayName ?? s.membership?.user.name ?? "—",
    date: dateKeyInTz(s.startsAt, s.location.timezone),
    start: timeInTz(s.startsAt, s.location.timezone),
    end: timeInTz(s.endsAt, s.location.timezone),
    position: s.position?.name ?? null,
    location: s.location.name,
  })),
);

export const createBlackoutAction = businessAction(blackoutSchema, async (ctx, i) => ({ id: (await createBlackout(ctx, i)).id }));
export const deleteBlackoutAction = businessAction(id, (ctx, i) => deleteBlackout(ctx, i.id));

export const resolveConflictAction = businessAction(resolveConflictSchema, resolveConflict);
