"use server";

import { z } from "zod";
import { businessAction, toResult, type ActionResult } from "@/server/action";
import { requireBusinessAction } from "@/server/auth/context";
import {
  announcementReceipts,
  announcementSchema,
  confirmAnnouncement,
  conversationView,
  createGroup,
  groupSchema,
  leaveGroup,
  markAnnouncementsRead,
  openDirect,
  sendAnnouncement,
  sendMessage,
  sendSchema,
  setMuted,
  uploadImage,
} from "@/server/services/messaging";
import { markNotificationsRead, myNotifications, preferenceSchema, setPreference } from "@/server/services/notifications";

const id = z.object({ id: z.string().min(1) });

export const openDirectAction = businessAction(id, (ctx, i) => openDirect(ctx, i.id));
export const createGroupAction = businessAction(groupSchema, createGroup);
export const sendMessageAction = businessAction(sendSchema, sendMessage);
export const muteAction = businessAction(z.object({ id: z.string().min(1), muted: z.boolean() }), (ctx, i) => setMuted(ctx, i.id, i.muted));
export const leaveGroupAction = businessAction(id, (ctx, i) => leaveGroup(ctx, i.id));
export const pollMessagesAction = businessAction(z.object({ id: z.string().min(1), after: z.string().datetime().nullable() }), async (ctx, i) =>
  (await conversationView(ctx, i.id, { after: i.after ? new Date(i.after) : undefined })).messages,
);
export const sendAnnouncementAction = businessAction(announcementSchema, sendAnnouncement);
export const confirmAnnouncementAction = businessAction(id, (ctx, i) => confirmAnnouncement(ctx, i.id));
export const markAnnouncementsReadAction = businessAction(z.object({ ids: z.array(z.string()).max(200) }), (ctx, i) => markAnnouncementsRead(ctx, i.ids));
export const receiptsAction = businessAction(id, (ctx, i) => announcementReceipts(ctx, i.id));

export const notificationsAction = businessAction(z.object({}), async (ctx) =>
  (await myNotifications(ctx)).map((n) => ({ id: n.id, title: n.title, body: n.body, at: n.createdAt.toISOString(), read: !!n.readAt, type: n.type })),
);
export const markNotificationsReadAction = businessAction(z.object({ ids: z.union([z.array(z.string()), z.literal("all")]) }), (ctx, i) => markNotificationsRead(ctx, i.ids));
export const setPreferenceAction = businessAction(preferenceSchema, setPreference);

/** Image upload for a message attachment (multipart). */
export async function uploadImageAction(businessId: string, form: FormData): Promise<ActionResult<{ key: string }>> {
  try {
    const ctx = await requireBusinessAction(businessId);
    const file = form.get("file");
    if (!(file instanceof File)) return { ok: false, error: "Choose an image." };
    return { ok: true, data: await uploadImage(ctx, new Uint8Array(await file.arrayBuffer())) };
  } catch (err) {
    return toResult(err);
  }
}
