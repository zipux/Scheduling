"use server";

import { z } from "zod";
import { businessAction } from "@/server/action";
import {
  businessInfoSchema,
  clockRulesSchema,
  requestRulesSchema,
  saveBusinessInfo,
  saveClockRules,
  saveRequestRules,
} from "@/server/services/business-settings";
import { createLocation, locationSchema, setLocationArchived, updateLocation } from "@/server/services/locations";
import { createPosition, positionSchema, setPositionArchived, updatePosition } from "@/server/services/positions";

export const saveBusinessInfoAction = businessAction(businessInfoSchema, saveBusinessInfo);
export const saveRequestRulesAction = businessAction(requestRulesSchema, saveRequestRules);
export const saveClockRulesAction = businessAction(clockRulesSchema, saveClockRules);

export const createLocationAction = businessAction(locationSchema, async (ctx, i) => ({ id: (await createLocation(ctx, i)).id }));
export const updateLocationAction = businessAction(z.object({ id: z.string().min(1), location: locationSchema }), (ctx, i) =>
  updateLocation(ctx, i.id, i.location),
);
export const archiveLocationAction = businessAction(z.object({ id: z.string().min(1), archived: z.boolean() }), (ctx, i) =>
  setLocationArchived(ctx, i.id, i.archived),
);

export const createPositionAction = businessAction(positionSchema, async (ctx, i) => ({ id: (await createPosition(ctx, i)).id }));
export const updatePositionAction = businessAction(z.object({ id: z.string().min(1), position: positionSchema }), (ctx, i) =>
  updatePosition(ctx, i.id, i.position),
);
export const archivePositionAction = businessAction(z.object({ id: z.string().min(1), archived: z.boolean() }), (ctx, i) =>
  setPositionArchived(ctx, i.id, i.archived),
);
