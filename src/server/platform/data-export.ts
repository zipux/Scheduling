import "server-only";
import { rawDb } from "@/server/db/client";
import { tenantDb } from "@/server/db/tenant";
import { audit } from "@/server/audit";

/**
 * "Export my data" payload (Spec §10.1).
 *
 * Contains the user's own profile, memberships, wage history, shifts, requests,
 * time entries and the audit records concerning them — and only the messages
 * they sent themselves. Messages and announcements they received appear as
 * metadata (conversation, timestamp, sender) with no body text, so a departing
 * employee can't walk off with colleagues' conversations.
 *
 * Every business is read through its own tenant client; nothing is joined
 * across businesses.
 */
export async function buildUserExport(userId: string) {
  const user = await rawDb.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, email: true, locale: true, createdAt: true, deletionRequestedAt: true },
  });
  const memberships = await rawDb.membership.findMany({
    where: { userId },
    select: { id: true, businessId: true, business: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  const businesses = [];
  for (const m of memberships) businesses.push(await exportMembership(m.businessId, m.id, m.business.name, userId));

  return { exportedAt: new Date().toISOString(), format: "shiftwise-export/1", user, businesses };
}

async function exportMembership(businessId: string, membershipId: string, businessName: string, userId: string) {
  const db = tenantDb(businessId);
  const mine = { membershipId };

  const [membership, wages, shifts, timeOff, availability, trades, corrections, entries, timesheets, holidayEntitlements, vacationAccruals] =
    await Promise.all([
      db.membership.findFirstOrThrow({
        where: { id: membershipId },
        select: {
          id: true,
          status: true,
          displayName: true,
          hireDate: true,
          accessRevokedAt: true,
          employmentEndedAt: true,
          createdAt: true,
          role: { select: { name: true } },
          locations: { select: { location: { select: { name: true } } } },
          positions: { select: { position: { select: { name: true } } } },
          profile: {
            select: {
              phone: true,
              dateOfBirth: true,
              address: true,
              emergencyContactName: true,
              emergencyContactRelation: true,
              emergencyContactPhone: true,
              photoUrl: true,
              pinHmac: true,
              completedAt: true,
            },
          },
        },
      }),
      db.wage.findMany({ where: mine, orderBy: { effectiveFrom: "asc" } }),
      // Published shifts only: drafts aren't visible to the employee yet.
      db.shift.findMany({
        where: { ...mine, status: "published", deletedAt: null },
        select: { id: true, startsAt: true, endsAt: true, breakMinutes: true, notes: true, location: { select: { name: true } }, position: { select: { name: true } } },
        orderBy: { startsAt: "asc" },
      }),
      db.timeOffRequest.findMany({ where: mine, orderBy: { createdAt: "asc" } }),
      db.availabilityRule.findMany({ where: mine, orderBy: { createdAt: "asc" } }),
      db.shiftTradeRequest.findMany({ where: { OR: [{ fromMembershipId: membershipId }, { toMembershipId: membershipId }] }, orderBy: { createdAt: "asc" } }),
      db.correctionRequest.findMany({ where: mine, orderBy: { createdAt: "asc" } }),
      db.timeEntry.findMany({
        where: mine,
        include: { breaks: true, flags: true, location: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      db.timesheet.findMany({ where: mine, orderBy: { createdAt: "asc" } }),
      db.holidayEntitlement.findMany({ where: mine, orderBy: { createdAt: "asc" } }),
      db.vacationAccrual.findMany({ where: mine, orderBy: { createdAt: "asc" } }),
    ]);

  const entryIds = entries.map((e) => e.id);
  const ownIds = [
    membershipId,
    userId,
    ...entryIds,
    ...entries.flatMap((e) => e.flags.map((f) => f.id)),
    ...timeOff.map((r) => r.id),
    ...availability.map((r) => r.id),
    ...trades.map((r) => r.id),
  ];
  const [auditLog, timeEntryAudit] = await Promise.all([
    db.auditLog.findMany({ where: { targetId: { in: ownIds } }, orderBy: { createdAt: "asc" } }),
    db.timeEntryAudit.findMany({ where: { timeEntryId: { in: entryIds } }, orderBy: { createdAt: "asc" } }),
  ]);

  const { profile, ...rest } = membership;
  const { pinHmac, ...profileFields } = profile ?? { pinHmac: null };

  return {
    business: { id: businessId, name: businessName },
    membership: {
      ...rest,
      role: rest.role.name,
      locations: rest.locations.map((l) => l.location.name),
      positions: rest.positions.map((p) => p.position.name),
    },
    // The PIN hash is a credential, not personal data: only whether one is set.
    profile: profile ? { ...profileFields, pinSet: !!pinHmac } : null,
    wages,
    shifts: shifts.map((s) => ({ ...s, location: s.location.name, position: s.position?.name ?? null })),
    requests: { timeOff, availability, shiftTrades: trades, timeCorrections: corrections },
    timeEntries: entries.map((e) => ({ ...e, location: e.location.name })),
    timesheets,
    holidayEntitlements,
    vacationAccruals,
    audit: { general: auditLog, timeEntries: timeEntryAudit },
    ...(await exportMessages(businessId, membershipId)),
  };
}

async function exportMessages(businessId: string, membershipId: string) {
  const db = tenantDb(businessId);
  const convs = await db.conversationMember.findMany({ where: { membershipId }, select: { conversationId: true } });
  const conversationIds = convs.map((c) => c.conversationId);

  const [sent, received, conversations, announcementsSent, announcementReads] = await Promise.all([
    db.message.findMany({
      where: { senderMembershipId: membershipId },
      select: { id: true, conversationId: true, body: true, attachmentUrl: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    // Metadata only: never select `body` or `attachmentUrl` here.
    db.message.findMany({
      where: { conversationId: { in: conversationIds }, senderMembershipId: { not: membershipId } },
      select: { id: true, conversationId: true, senderMembershipId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    db.conversation.findMany({ where: { id: { in: conversationIds } }, select: { id: true, kind: true, name: true } }),
    db.announcement.findMany({
      where: { senderMembershipId: membershipId },
      select: { id: true, audience: true, title: true, body: true, requireReadConfirmation: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    db.announcementRead.findMany({
      where: { membershipId },
      select: { readAt: true, confirmedAt: true, announcement: { select: { id: true, senderMembershipId: true, createdAt: true } } },
      orderBy: { readAt: "asc" },
    }),
  ]);

  const senderIds = [...new Set([...received.map((m) => m.senderMembershipId), ...announcementReads.map((r) => r.announcement.senderMembershipId)])];
  const senders = await db.membership.findMany({ where: { id: { in: senderIds } }, select: { id: true, displayName: true, user: { select: { name: true } } } });
  const nameOf = new Map(senders.map((s) => [s.id, s.displayName ?? s.user.name]));

  return {
    conversations,
    messagesSent: sent,
    messagesReceived: received.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      sentAt: m.createdAt,
      sender: nameOf.get(m.senderMembershipId) ?? null,
    })),
    announcementsSent,
    announcementsReceived: announcementReads
      .filter((r) => r.announcement.senderMembershipId !== membershipId)
      .map((r) => ({
        id: r.announcement.id,
        sentAt: r.announcement.createdAt,
        sender: nameOf.get(r.announcement.senderMembershipId) ?? null,
        readAt: r.readAt,
        confirmedAt: r.confirmedAt,
      })),
  };
}

/** Writes one DATA_EXPORTED audit record per business in the export. */
export async function auditUserExport(userId: string, businesses: { business: { id: string }; membership: { id: string } }[]) {
  await Promise.all(
    businesses.map((b) =>
      audit({ businessId: b.business.id, actorUserId: userId, action: "DATA_EXPORTED", targetType: "Membership", targetId: b.membership.id }),
    ),
  );
  if (businesses.length === 0) await audit({ businessId: null, actorUserId: userId, action: "DATA_EXPORTED", targetType: "User", targetId: userId });
}
