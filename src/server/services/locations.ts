import "server-only";
import { z } from "zod";
import { isValidTimezone } from "@/lib/regions";
import { assertCan, type BusinessContext } from "@/server/auth/context";
import { audit } from "@/server/audit";
import { UserError } from "@/server/action";

const optionalNumber = (min: number, max: number) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().min(min).max(max).nullable());

export const locationSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(120),
    address: z.string().trim().max(300).optional().default(""),
    timezone: z.string().refine(isValidTimezone, "Choose a valid timezone"),
    lat: optionalNumber(-90, 90),
    lng: optionalNumber(-180, 180),
    radiusM: z.coerce.number().int().min(10, "At least 10 m").max(5000, "At most 5 km"),
    geofenceMode: z.enum(["required", "warn", "off"]),
    isTemporary: z.boolean().default(false),
  })
  .refine((v) => v.geofenceMode === "off" || (v.lat !== null && v.lng !== null), {
    path: ["lat"],
    message: "Set the location's position, or turn the geofence off",
  });
export type LocationInput = z.infer<typeof locationSchema>;

export async function createLocation(ctx: BusinessContext, input: LocationInput) {
  assertCan(ctx, "business.settings");
  const loc = await ctx.db.location.create({
    data: {
      name: input.name,
      address: input.address || null,
      timezone: input.timezone,
      lat: input.lat,
      lng: input.lng,
      radiusM: input.radiusM,
      geofenceMode: input.geofenceMode,
      isTemporary: input.isTemporary,
    } as never,
  });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "LOCATION_CREATED", targetType: "Location", targetId: loc.id });
  return loc;
}

async function loadLocation(ctx: BusinessContext, id: string) {
  assertCan(ctx, "business.settings");
  const loc = await ctx.db.location.findUnique({ where: { id } });
  if (!loc) throw new UserError("Location not found.");
  return loc;
}

export async function updateLocation(ctx: BusinessContext, id: string, input: LocationInput) {
  const before = await loadLocation(ctx, id);
  const after = await ctx.db.location.update({
    where: { id },
    data: {
      name: input.name,
      address: input.address || null,
      timezone: input.timezone,
      lat: input.lat,
      lng: input.lng,
      radiusM: input.radiusM,
      geofenceMode: input.geofenceMode,
      isTemporary: input.isTemporary,
    },
  });
  await audit({
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    action: "LOCATION_UPDATED",
    targetType: "Location",
    targetId: id,
    data: JSON.parse(JSON.stringify({ before, after })),
  });
}

export async function setLocationArchived(ctx: BusinessContext, id: string, archived: boolean) {
  const loc = await loadLocation(ctx, id);
  if (archived) {
    const active = await ctx.db.location.count({ where: { archivedAt: null } });
    if (active <= 1 && !loc.archivedAt) throw new UserError("A business needs at least one active location.");
  }
  await ctx.db.location.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: archived ? "LOCATION_ARCHIVED" : "LOCATION_RESTORED", targetType: "Location", targetId: id });
}
