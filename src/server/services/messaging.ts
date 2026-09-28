import "server-only";
import { z } from "zod";
import { assertCan, type BusinessContext } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { randomToken } from "@/lib/crypto";
import { fileStorage, MAX_IMAGE_BYTES, sniffImage } from "@/server/storage";

/**
 * Messaging (§9). Every read and write checks that the caller is a member of the
 * conversation. Deactivated staff lose access immediately (the business context
 * refuses them before any of this runs).
 */

const activeMember = { status: "active" as const, accessRevokedAt: null };

async function assertMember(ctx: BusinessContext, conversationId: string) {
  const cm = await ctx.db.conversationMember.findFirst({ where: { conversationId, membershipId: ctx.membership.id } });
  if (!cm) throw new UserError("Conversation not found.");
  return cm;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversations
// ─────────────────────────────────────────────────────────────────────────────

export async function listConversations(ctx: BusinessContext) {
  await syncAutoGroups(ctx);
  const mine = await ctx.db.conversationMember.findMany({
    where: { membershipId: ctx.membership.id },
    include: {
      conversation: {
        include: {
          members: { select: { membershipId: true } },
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });
  const people = await ctx.db.membership.findMany({
    where: { id: { in: [...new Set(mine.flatMap((m) => m.conversation.members.map((x) => x.membershipId)))] } },
    include: { user: { select: { name: true } } },
  });
  const nameOf = new Map(people.map((p) => [p.id, p.displayName ?? p.user.name]));
  const rows = await Promise.all(
    mine.map(async (m) => {
      const unread = await ctx.db.message.count({
        where: { conversationId: m.conversationId, senderMembershipId: { not: ctx.membership.id }, ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}) },
      });
      const c = m.conversation;
      const others = c.members.filter((x) => x.membershipId !== ctx.membership.id).map((x) => nameOf.get(x.membershipId) ?? "—");
      return {
        id: c.id,
        kind: c.kind,
        title: c.kind === "direct" ? (others[0] ?? "—") : (c.name ?? others.join(", ")),
        memberCount: c.members.length,
        last: c.messages[0] ?? null,
        lastSender: c.messages[0] ? nameOf.get(c.messages[0].senderMembershipId) ?? "—" : null,
        unread,
        muted: m.muted,
      };
    }),
  );
  return rows.sort((a, b) => (b.last?.createdAt.getTime() ?? 0) - (a.last?.createdAt.getTime() ?? 0));
}

export async function openDirect(ctx: BusinessContext, otherMembershipId: string) {
  if (otherMembershipId === ctx.membership.id) throw new UserError("Choose someone else.");
  const other = await ctx.db.membership.findFirst({ where: { id: otherMembershipId, ...activeMember } });
  if (!other) throw new UserError("That person isn't available.");
  const autoKey = `dm:${[ctx.membership.id, other.id].sort().join(":")}`;
  const existing = await ctx.db.conversation.findFirst({ where: { autoKey } });
  if (existing) return { id: existing.id };
  const c = await ctx.db.conversation.create({ data: { kind: "direct", autoKey } as never });
  await ctx.db.conversationMember.createMany({ data: [ctx.membership.id, other.id].map((membershipId) => ({ conversationId: c.id, membershipId })) as never });
  return { id: c.id };
}

export const groupSchema = z.object({
  name: z.string().trim().min(1, "Name the group").max(60),
  memberIds: z.array(z.string().min(1)).min(1, "Add at least one person").max(200),
});

export async function createGroup(ctx: BusinessContext, input: z.infer<typeof groupSchema>) {
  const ids = [...new Set([ctx.membership.id, ...input.memberIds])];
  const ok = await ctx.db.membership.count({ where: { id: { in: ids }, ...activeMember } });
  if (ok !== ids.length) throw new UserError("Some of those people aren't available.");
  const c = await ctx.db.conversation.create({ data: { kind: "group", name: input.name } as never });
  await ctx.db.conversationMember.createMany({ data: ids.map((membershipId) => ({ conversationId: c.id, membershipId })) as never });
  return { id: c.id };
}

export async function setMuted(ctx: BusinessContext, conversationId: string, muted: boolean) {
  const cm = await assertMember(ctx, conversationId);
  await ctx.db.conversationMember.update({ where: { id: cm.id }, data: { muted } });
}

export async function leaveGroup(ctx: BusinessContext, conversationId: string) {
  const cm = await assertMember(ctx, conversationId);
  const c = await ctx.db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  if (c.kind !== "group") throw new UserError("You can only leave group chats.");
  await ctx.db.conversationMember.delete({ where: { id: cm.id } });
}

/**
 * Optional auto-groups per location and per position (§9), kept in sync with
 * assignments whenever someone opens Messages.
 */
export async function syncAutoGroups(ctx: BusinessContext) {
  if (!ctx.business.autoChatGroups) return;
  const [locations, positions, members] = await Promise.all([
    ctx.db.location.findMany({ where: { archivedAt: null } }),
    ctx.db.position.findMany({ where: { archivedAt: null } }),
    ctx.db.membership.findMany({ where: activeMember, include: { locations: true, positions: true } }),
  ]);
  const want = [
    ...locations.map((l) => ({ key: `location:${l.id}`, kind: "location", name: l.name, ids: members.filter((m) => m.locations.some((x) => x.locationId === l.id)).map((m) => m.id) })),
    ...positions.map((p) => ({ key: `position:${p.id}`, kind: "position", name: p.name, ids: members.filter((m) => m.positions.some((x) => x.positionId === p.id)).map((m) => m.id) })),
  ];
  for (const g of want) {
    let c = await ctx.db.conversation.findFirst({ where: { autoKey: g.key }, include: { members: true } });
    if (!c) {
      if (!g.ids.length) continue;
      c = { ...(await ctx.db.conversation.create({ data: { kind: g.kind, name: g.name, autoKey: g.key } as never })), members: [] };
    } else if (c.name !== g.name) {
      await ctx.db.conversation.update({ where: { id: c.id }, data: { name: g.name } });
    }
    const have = new Set(c.members.map((m) => m.membershipId));
    const add = g.ids.filter((id) => !have.has(id));
    const remove = c.members.filter((m) => !g.ids.includes(m.membershipId)).map((m) => m.id);
    if (add.length) await ctx.db.conversationMember.createMany({ data: add.map((membershipId) => ({ conversationId: c!.id, membershipId })) as never, skipDuplicates: true });
    if (remove.length) await ctx.db.conversationMember.deleteMany({ where: { id: { in: remove } } });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────────────────

export async function conversationView(ctx: BusinessContext, conversationId: string, opts: { after?: Date } = {}) {
  const cm = await assertMember(ctx, conversationId);
  const c = await ctx.db.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { members: true } });
  // Initial load: the latest 200 messages; polling: everything after the last one seen.
  const recent = opts.after
    ? await ctx.db.message.findMany({ where: { conversationId, createdAt: { gt: opts.after } }, orderBy: { createdAt: "asc" }, take: 200 })
    : (await ctx.db.message.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: 200 })).reverse();
  const people = await ctx.db.membership.findMany({ where: { id: { in: c.members.map((m) => m.membershipId) } }, include: { user: { select: { name: true } } } });
  const nameOf = new Map(people.map((p) => [p.id, p.displayName ?? p.user.name]));
  await ctx.db.conversationMember.update({ where: { id: cm.id }, data: { lastReadAt: new Date() } });
  const others = c.members.filter((m) => m.membershipId !== ctx.membership.id).map((m) => nameOf.get(m.membershipId) ?? "—");
  return {
    id: c.id,
    kind: c.kind,
    title: c.kind === "direct" ? (others[0] ?? "—") : (c.name ?? others.join(", ")),
    members: c.members.map((m) => nameOf.get(m.membershipId) ?? "—"),
    muted: cm.muted,
    messages: recent.map((m) => ({
      id: m.id,
      mine: m.senderMembershipId === ctx.membership.id,
      sender: nameOf.get(m.senderMembershipId) ?? "—",
      body: m.body,
      attachment: m.attachmentUrl,
      at: m.createdAt.toISOString(),
    })),
  };
}

export const sendSchema = z.object({
  conversationId: z.string().min(1),
  body: z.string().trim().max(4000),
  attachmentKey: z.string().regex(/^msg\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/).nullable().optional(),
});

export async function sendMessage(ctx: BusinessContext, input: z.infer<typeof sendSchema>) {
  await assertMember(ctx, input.conversationId);
  if (!input.body && !input.attachmentKey) throw new UserError("Write a message.");
  if (input.attachmentKey && !input.attachmentKey.startsWith(`msg/${ctx.businessId}/`)) throw new UserError("Attachment not found.");
  const m = await ctx.db.message.create({
    data: { conversationId: input.conversationId, senderMembershipId: ctx.membership.id, body: input.body, attachmentUrl: input.attachmentKey ?? null } as never,
  });
  await ctx.db.conversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } });
  await ctx.db.conversationMember.updateMany({ where: { conversationId: input.conversationId, membershipId: ctx.membership.id }, data: { lastReadAt: new Date() } });
  return { id: m.id };
}

/** Stores an image attachment (≤ 5 MB, PNG/JPEG/GIF/WebP by content) and returns its key. */
export async function uploadImage(ctx: BusinessContext, bytes: Uint8Array) {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new UserError("Images can be up to 5 MB.");
  const type = sniffImage(bytes);
  if (!type) throw new UserError("Only PNG, JPEG, GIF or WebP images.");
  const key = `msg/${ctx.businessId}/${randomToken(16)}`;
  await fileStorage().put(key, bytes, type);
  return { key };
}

/** An attachment may be read only by members of a conversation that contains it. */
export async function readAttachment(ctx: BusinessContext, key: string) {
  if (!key.startsWith(`msg/${ctx.businessId}/`)) return null;
  const m = await ctx.db.message.findFirst({ where: { attachmentUrl: key, conversation: { members: { some: { membershipId: ctx.membership.id } } } } });
  if (!m) return null;
  return fileStorage().get(key);
}

/** Unread messages across unmuted conversations, plus unread announcements. */
export async function unreadCounts(ctx: BusinessContext) {
  const mine = await ctx.db.conversationMember.findMany({ where: { membershipId: ctx.membership.id, muted: false } });
  let messages = 0;
  for (const m of mine) {
    messages += await ctx.db.message.count({
      where: { conversationId: m.conversationId, senderMembershipId: { not: ctx.membership.id }, ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}) },
    });
  }
  const announcements = (await announcementsForMe(ctx)).filter((a) => !a.read).length;
  return { messages, announcements };
}

// ─────────────────────────────────────────────────────────────────────────────
// Announcements
// ─────────────────────────────────────────────────────────────────────────────

export const audienceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }),
  z.object({ type: z.literal("location"), id: z.string().min(1) }),
  z.object({ type: z.literal("role"), id: z.string().min(1) }),
  z.object({ type: z.literal("position"), id: z.string().min(1) }),
]);
type Audience = z.infer<typeof audienceSchema>;

export const announcementSchema = z.object({
  audience: audienceSchema,
  title: z.string().trim().min(1, "Add a title").max(120),
  body: z.string().trim().min(1, "Write the announcement").max(4000),
  requireReadConfirmation: z.boolean().default(false),
});

async function audienceMembers(ctx: BusinessContext, a: Audience) {
  const where =
    a.type === "all"
      ? {}
      : a.type === "location"
        ? { locations: { some: { locationId: a.id } } }
        : a.type === "role"
          ? { roleId: a.id }
          : { positions: { some: { positionId: a.id } } };
  return ctx.db.membership.findMany({ where: { ...activeMember, ...where }, select: { id: true } });
}

export async function sendAnnouncement(ctx: BusinessContext, input: z.infer<typeof announcementSchema>) {
  assertCan(ctx, "messages.broadcast");
  // Validate the target belongs to this business (the tenant layer checks ids only in known fields).
  if (input.audience.type === "location" && !(await ctx.db.location.findUnique({ where: { id: input.audience.id } }))) throw new UserError("Choose a location.");
  if (input.audience.type === "role" && !(await ctx.db.role.findUnique({ where: { id: input.audience.id } }))) throw new UserError("Choose a role.");
  if (input.audience.type === "position" && !(await ctx.db.position.findUnique({ where: { id: input.audience.id } }))) throw new UserError("Choose a position.");
  const a = await ctx.db.announcement.create({
    data: { senderMembershipId: ctx.membership.id, audience: input.audience, title: input.title, body: input.body, requireReadConfirmation: input.requireReadConfirmation } as never,
  });
  const recipients = (await audienceMembers(ctx, input.audience)).filter((m) => m.id !== ctx.membership.id);
  if (recipients.length) {
    await ctx.db.notification.createMany({
      data: recipients.map((r) => ({ membershipId: r.id, type: "announcement", title: input.title, body: input.body.slice(0, 280), payload: { announcementId: a.id }, flushAfter: new Date() })) as never,
    });
  }
  await audit({ businessId: ctx.businessId, actorUserId: ctx.userId, action: "ANNOUNCEMENT_SENT", targetType: "Announcement", targetId: a.id, data: { audience: input.audience, recipients: recipients.length } });
  return { id: a.id, recipients: recipients.length };
}

function inAudience(a: Audience, me: { id: string; roleId: string; locationIds: string[]; positionIds: string[] }) {
  if (a.type === "all") return true;
  if (a.type === "location") return me.locationIds.includes(a.id);
  if (a.type === "role") return me.roleId === a.id;
  return me.positionIds.includes(a.id);
}

export async function announcementsForMe(ctx: BusinessContext) {
  const me = await ctx.db.membership.findUniqueOrThrow({ where: { id: ctx.membership.id }, include: { locations: true, positions: true } });
  const all = await ctx.db.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { reads: { where: { membershipId: ctx.membership.id } } } });
  const who = { id: me.id, roleId: me.roleId, locationIds: me.locations.map((l) => l.locationId), positionIds: me.positions.map((p) => p.positionId) };
  return all
    .filter((a) => a.senderMembershipId === me.id || inAudience(a.audience as Audience, who))
    .map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      at: a.createdAt,
      mine: a.senderMembershipId === me.id,
      requireReadConfirmation: a.requireReadConfirmation,
      read: a.senderMembershipId === me.id || !!a.reads[0],
      confirmed: !!a.reads[0]?.confirmedAt,
    }));
}

/** Viewing marks announcements read; confirming records an explicit read receipt. */
export async function markAnnouncementsRead(ctx: BusinessContext, ids: string[]) {
  for (const id of ids) {
    await ctx.db.announcementRead.upsert({
      where: { announcementId_membershipId: { announcementId: id, membershipId: ctx.membership.id } },
      create: { announcementId: id, membershipId: ctx.membership.id } as never,
      update: {},
    });
  }
}

export async function confirmAnnouncement(ctx: BusinessContext, id: string) {
  const mine = (await announcementsForMe(ctx)).find((a) => a.id === id);
  if (!mine) throw new UserError("Announcement not found.");
  await ctx.db.announcementRead.upsert({
    where: { announcementId_membershipId: { announcementId: id, membershipId: ctx.membership.id } },
    create: { announcementId: id, membershipId: ctx.membership.id, confirmedAt: new Date() } as never,
    update: { confirmedAt: new Date() },
  });
}

/** Read receipts for senders and broadcasters (§9). */
export async function announcementReceipts(ctx: BusinessContext, id: string) {
  const a = await ctx.db.announcement.findUnique({ where: { id }, include: { reads: true } });
  if (!a) throw new UserError("Announcement not found.");
  if (a.senderMembershipId !== ctx.membership.id) assertCan(ctx, "messages.broadcast");
  const audience = (await audienceMembers(ctx, a.audience as Audience)).filter((m) => m.id !== a.senderMembershipId);
  const people = await ctx.db.membership.findMany({ where: { id: { in: audience.map((m) => m.id) } }, include: { user: { select: { name: true } } } });
  return people.map((p) => {
    const r = a.reads.find((x) => x.membershipId === p.id);
    return { name: p.displayName ?? p.user.name, read: !!r, confirmed: !!r?.confirmedAt };
  });
}
