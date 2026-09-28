import "server-only";
import { z } from "zod";
import { assertCan, type BusinessContext } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { isDateKey } from "@/lib/time";
import { holidaysFor } from "@/lib/holiday-presets";

export const holidaySchema = z.object({
  date: z.string().refine(isDateKey, "Choose a date"),
  name: z.string().trim().min(1, "Enter a name").max(80),
  isStatutory: z.boolean().default(true),
  premiumMultiplier: z.coerce.number().min(1).max(5),
});

export async function addHoliday(ctx: BusinessContext, input: z.infer<typeof holidaySchema>) {
  assertCan(ctx, "holidays.manage");
  const dup = await ctx.db.holiday.findFirst({ where: { date: new Date(`${input.date}T00:00:00Z`), name: input.name } });
  if (dup) throw new UserError("That holiday is already on the calendar.");
  const h = await ctx.db.holiday.create({ data: { ...input, date: new Date(`${input.date}T00:00:00Z`) } as never });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "HOLIDAY_ADDED", targetType: "Holiday", targetId: h.id, data: input });
}

export async function updateHoliday(ctx: BusinessContext, id: string, input: z.infer<typeof holidaySchema>) {
  assertCan(ctx, "holidays.manage");
  const n = await ctx.db.holiday.updateMany({ where: { id }, data: { ...input, date: new Date(`${input.date}T00:00:00Z`) } });
  if (!n.count) throw new UserError("Holiday not found.");
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "HOLIDAY_UPDATED", targetType: "Holiday", targetId: id, data: input });
}

export async function deleteHoliday(ctx: BusinessContext, id: string) {
  assertCan(ctx, "holidays.manage");
  const used = await ctx.db.holidayEntitlement.count({ where: { holidayId: id, NOT: { inputs: { equals: {} } } } });
  if (used) throw new UserError("This holiday is already on an approved timesheet; edit it instead of deleting.");
  await ctx.db.holidayEntitlement.deleteMany({ where: { holidayId: id } });
  await ctx.db.holiday.deleteMany({ where: { id } });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "HOLIDAY_DELETED", targetType: "Holiday", targetId: id });
}

/** Adds the province's preset holidays for a year (skipping ones already there). */
export async function addPresetYear(ctx: BusinessContext, year: number) {
  assertCan(ctx, "holidays.manage");
  const presets = holidaysFor(ctx.business.country, ctx.business.region, year);
  if (!presets.length) throw new UserError("There's no holiday preset for this province yet — add them by hand.");
  const r = await ctx.db.holiday.createMany({
    data: presets.map((p) => ({ date: new Date(`${p.date}T00:00:00Z`), name: p.name, isStatutory: true, premiumMultiplier: 1.5 })) as never,
    skipDuplicates: true,
  });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "HOLIDAY_PRESET_ADDED", data: { year, added: r.count } });
  return { added: r.count };
}
