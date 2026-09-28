import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/auth/context";
import { UserError } from "@/server/action";
import {
  announcementReceipts,
  announcementsForMe,
  confirmAnnouncement,
  conversationView,
  createGroup,
  listConversations,
  openDirect,
  readAttachment,
  sendAnnouncement,
  sendMessage,
  setMuted,
  syncAutoGroups,
  unreadCounts,
  uploadImage,
} from "@/server/services/messaging";
import { setPreference } from "@/server/services/notifications";
import { flushAllDueNotifications } from "@/server/platform/notifications";
import { addMember, ctxFor, db, makeBusiness } from "../support/fixtures";

type Fx = Awaited<ReturnType<typeof makeBusiness>>;
let A: Fx;
let B: Fx;
let mgr: string;
let e1: string;
let e2: string;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0]);

beforeAll(async () => {
  A = await makeBusiness("MsgA");
  B = await makeBusiness("MsgB");
  mgr = (await addMember(A.business.id, A.roles.manager.id, "Mgr")).membership.id;
  e1 = (await addMember(A.business.id, A.roles.employee.id, "E1")).membership.id;
  e2 = (await addMember(A.business.id, A.roles.employee.id, "E2")).membership.id;
  await db.membershipLocation.create({ data: { businessId: A.business.id, membershipId: e1, locationId: A.location.id } });
  await db.membershipPosition.create({ data: { businessId: A.business.id, membershipId: e1, positionId: A.position.id } });
}, 300_000);

describe("direct messages and groups (§9)", () => {
  it("a DM is reused, unread counts rise for the recipient and clear when read", async () => {
    const a = await openDirect(await ctxFor(e1), e2);
    const b = await openDirect(await ctxFor(e2), e1);
    expect(a.id).toBe(b.id);
    await sendMessage(await ctxFor(e1), { conversationId: a.id, body: "Hi!" });
    expect((await unreadCounts(await ctxFor(e2))).messages).toBe(1);
    expect((await unreadCounts(await ctxFor(e1))).messages).toBe(0);
    const v = await conversationView(await ctxFor(e2), a.id);
    expect(v.messages.map((m) => m.body)).toEqual(["Hi!"]);
    expect((await unreadCounts(await ctxFor(e2))).messages).toBe(0);
  });

  it("outsiders can't read or post, and can't DM someone in another business", async () => {
    const dm = await openDirect(await ctxFor(e1), e2);
    await expect(conversationView(await ctxFor(mgr), dm.id)).rejects.toThrow(UserError);
    await expect(sendMessage(await ctxFor(mgr), { conversationId: dm.id, body: "sneaky" })).rejects.toThrow(UserError);
    await expect(openDirect(await ctxFor(e1), B.employee.id)).rejects.toThrow(UserError);
    await expect(conversationView(await ctxFor(B.owner.id), dm.id)).rejects.toThrow(UserError);
  });

  it("groups, and muting removes a chat from the unread badge", async () => {
    const g = await createGroup(await ctxFor(mgr), { name: "Closers", memberIds: [e1, e2] });
    await sendMessage(await ctxFor(mgr), { conversationId: g.id, body: "Close at 11 tonight" });
    expect((await unreadCounts(await ctxFor(e1))).messages).toBe(1);
    await setMuted(await ctxFor(e1), g.id, true);
    expect((await unreadCounts(await ctxFor(e1))).messages).toBe(0);
    expect((await listConversations(await ctxFor(e1))).find((c) => c.id === g.id)?.muted).toBe(true);
  });

  it("auto-groups per location and position follow assignments", async () => {
    await db.business.update({ where: { id: A.business.id }, data: { autoChatGroups: true } });
    await syncAutoGroups(await ctxFor(mgr));
    const loc = await db.conversation.findFirstOrThrow({ where: { businessId: A.business.id, autoKey: `location:${A.location.id}` }, include: { members: true } });
    expect(loc.members.map((m) => m.membershipId)).toContain(e1);
    expect(loc.members.map((m) => m.membershipId)).not.toContain(e2);
    await db.membershipLocation.deleteMany({ where: { membershipId: e1 } });
    await syncAutoGroups(await ctxFor(mgr));
    const after = await db.conversationMember.count({ where: { conversationId: loc.id, membershipId: e1 } });
    expect(after).toBe(0);
  });
});

describe("image attachments (§9)", () => {
  it("accepts real images only, and serves them only to conversation members of the same business", async () => {
    await expect(uploadImage(await ctxFor(e1), new TextEncoder().encode("<script>"))).rejects.toThrow("PNG, JPEG, GIF or WebP");
    await expect(uploadImage(await ctxFor(e1), new Uint8Array(5 * 1024 * 1024 + 1))).rejects.toThrow("5 MB");
    const { key } = await uploadImage(await ctxFor(e1), PNG);
    const dm = await openDirect(await ctxFor(e1), e2);
    await sendMessage(await ctxFor(e1), { conversationId: dm.id, body: "", attachmentKey: key });
    expect((await readAttachment(await ctxFor(e2), key))?.contentType).toBe("image/png");
    expect(await readAttachment(await ctxFor(mgr), key)).toBeNull();
    expect(await readAttachment(await ctxFor(B.owner.id), key)).toBeNull();
    await expect(sendMessage(await ctxFor(B.owner.id), { conversationId: dm.id, body: "", attachmentKey: key })).rejects.toThrow();
  });
});

describe("announcements (§9)", () => {
  it("need messages.broadcast; target an audience; carry read receipts and confirmation", async () => {
    await expect(sendAnnouncement(await ctxFor(e1), { audience: { type: "all" }, title: "x", body: "y", requireReadConfirmation: false })).rejects.toThrow(ForbiddenError);
    await db.membershipLocation.create({ data: { businessId: A.business.id, membershipId: e2, locationId: A.location.id } });
    const a = await sendAnnouncement(await ctxFor(mgr), { audience: { type: "location", id: A.location.id }, title: "Fire drill", body: "Thursday 10am", requireReadConfirmation: true });
    expect(a.recipients).toBe(1); // only e2 is assigned to the location now
    expect((await announcementsForMe(await ctxFor(e2))).some((x) => x.id === a.id)).toBe(true);
    expect((await announcementsForMe(await ctxFor(e1))).some((x) => x.id === a.id)).toBe(false);
    await confirmAnnouncement(await ctxFor(e2), a.id);
    expect(await announcementReceipts(await ctxFor(mgr), a.id)).toEqual([{ name: "E2", read: true, confirmed: true }]);
    await expect(announcementReceipts(await ctxFor(e2), a.id)).rejects.toThrow(ForbiddenError);
    await expect(sendAnnouncement(await ctxFor(mgr), { audience: { type: "location", id: B.location.id }, title: "x", body: "y", requireReadConfirmation: false })).rejects.toThrow(UserError);
  });

  it("emails notifications unless the person opted out of that type (in-app always stays)", async () => {
    await setPreference(await ctxFor(e2), { type: "announcement", email: false });
    const a = await sendAnnouncement(await ctxFor(mgr), { audience: { type: "all" }, title: "Staff party", body: "Friday", requireReadConfirmation: false });
    await flushAllDueNotifications(new Date(Date.now() + 1000));
    const rows = await db.notification.findMany({ where: { businessId: A.business.id, type: "announcement", payload: { path: ["announcementId"], equals: a.id } } });
    const byPerson = new Map(rows.map((r) => [r.membershipId, r]));
    expect(byPerson.get(e2)?.emailedAt).toBeNull();
    expect(byPerson.get(e1)?.emailedAt).not.toBeNull();
  });
});
