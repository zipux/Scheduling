"use server";

import { z } from "zod";
import { businessAction } from "@/server/action";
import { createRole, deleteRole, roleSchema, updateRole } from "@/server/services/roles";

export const createRoleAction = businessAction(roleSchema, async (ctx, input) => ({ id: (await createRole(ctx, input)).id }));
export const updateRoleAction = businessAction(roleSchema.extend({ roleId: z.string().min(1) }), async (ctx, { roleId, ...input }) => {
  await updateRole(ctx, roleId, input);
  return { id: roleId };
});
export const deleteRoleAction = businessAction(z.object({ roleId: z.string().min(1) }), (ctx, i) => deleteRole(ctx, i.roleId));
