"use server";

import { z } from "zod";
import { businessAction } from "@/server/action";
import {
  copyPreviousWeek,
  createShift,
  createTemplate,
  deleteShift,
  deleteTemplate,
  moveShift,
  previewWarnings,
  publishWeek,
  shiftInputSchema,
  templateSchema,
  updateShift,
  weekScopeSchema,
} from "@/server/services/schedule";
import { saveLocationPreference } from "@/server/services/location-scope";
import { rotateCalendarFeed } from "@/server/platform/calendar";

export const createShiftAction = businessAction(shiftInputSchema, createShift);
export const updateShiftAction = businessAction(shiftInputSchema.extend({ id: z.string().min(1) }), (ctx, { id, ...input }) =>
  updateShift(ctx, id, input),
);
export const previewWarningsAction = businessAction(shiftInputSchema.extend({ id: z.string().nullable().optional() }), previewWarnings);
export const deleteShiftAction = businessAction(z.object({ id: z.string().min(1) }), (ctx, i) => deleteShift(ctx, i.id));
export const moveShiftAction = businessAction(
  z.object({ id: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), membershipId: z.string().min(1).nullable() }),
  (ctx, i) => moveShift(ctx, i.id, { date: i.date, membershipId: i.membershipId }),
);
export const publishWeekAction = businessAction(weekScopeSchema, publishWeek);
export const copyWeekAction = businessAction(weekScopeSchema, copyPreviousWeek);
export const createTemplateAction = businessAction(templateSchema, async (ctx, i) => ({ id: (await createTemplate(ctx, i)).id }));
export const deleteTemplateAction = businessAction(z.object({ id: z.string().min(1) }), (ctx, i) => deleteTemplate(ctx, i.id));
export const saveLocationPreferenceAction = businessAction(z.object({ value: z.string().min(1) }), (ctx, i) =>
  saveLocationPreference(ctx, i.value),
);
export const rotateCalendarFeedAction = businessAction(z.object({}), (ctx) => rotateCalendarFeed(ctx.userId));
