"use server";

import { z } from "zod";
import { businessAction } from "@/server/action";
import {
  addBreakRule,
  breakRuleSchema,
  deleteBreakRule,
  holidayRulesSchema,
  payRulesSchema,
  saveHolidayRules,
  savePayRules,
  saveWorkDayStart,
  workDaySchema,
} from "@/server/services/pay-rules";
import { addHoliday, addPresetYear, deleteHoliday, holidaySchema, updateHoliday } from "@/server/services/holidays";

export const savePayRulesAction = businessAction(payRulesSchema, savePayRules);
export const saveWorkDayAction = businessAction(workDaySchema, saveWorkDayStart);
export const saveHolidayRulesAction = businessAction(holidayRulesSchema, saveHolidayRules);
export const addBreakRuleAction = businessAction(breakRuleSchema, addBreakRule);
export const deleteBreakRuleAction = businessAction(z.object({ id: z.string().min(1) }), (ctx, i) => deleteBreakRule(ctx, i.id));
export const addHolidayAction = businessAction(holidaySchema, addHoliday);
export const updateHolidayAction = businessAction(holidaySchema.extend({ id: z.string().min(1) }), (ctx, { id, ...i }) => updateHoliday(ctx, id, i));
export const deleteHolidayAction = businessAction(z.object({ id: z.string().min(1) }), (ctx, i) => deleteHoliday(ctx, i.id));
export const addPresetYearAction = businessAction(z.object({ year: z.number().int().min(2000).max(2100) }), (ctx, i) => addPresetYear(ctx, i.year));
