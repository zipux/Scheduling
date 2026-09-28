"use server";

import { z } from "zod";
import { businessAction } from "@/server/action";
import { inviteMember, inviteSchema, resendInvitation, revokeInvitation } from "@/server/services/invitations";
import { changeMemberRole, deactivateMember, deactivateSchema, reactivateMember } from "@/server/services/members";
import { resetPin } from "@/server/services/profile";

export const inviteAction = businessAction(inviteSchema, inviteMember);

export const resendInvitationAction = businessAction(
  z.object({ invitationId: z.string().min(1), email: z.string().trim().toLowerCase().email("Enter a valid email").optional() }),
  (ctx, i) => resendInvitation(ctx, i.invitationId, i.email),
);

export const revokeInvitationAction = businessAction(z.object({ invitationId: z.string().min(1) }), (ctx, i) =>
  revokeInvitation(ctx, i.invitationId),
);

export const changeRoleAction = businessAction(
  z.object({ membershipId: z.string().min(1), roleId: z.string().min(1) }),
  changeMemberRole,
);

export const deactivateAction = businessAction(deactivateSchema, deactivateMember);

export const reactivateAction = businessAction(z.object({ membershipId: z.string().min(1) }), (ctx, i) =>
  reactivateMember(ctx, i.membershipId),
);

export const resetPinAction = businessAction(z.object({ membershipId: z.string().min(1) }), (ctx, i) =>
  resetPin(ctx, i.membershipId),
);
