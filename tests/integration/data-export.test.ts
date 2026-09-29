import { beforeAll, describe, expect, it } from "vitest";
import { createGroup, openDirect, sendAnnouncement, sendMessage } from "@/server/services/messaging";
import { auditUserExport, buildUserExport } from "@/server/platform/data-export";
import { addMember, ctxFor, db, makeBusiness } from "../support/fixtures";

type Fx = Awaited<ReturnType<typeof makeBusiness>>;
let A: Fx;
let B: Fx;
let mgr: string;
let me: string;
let meUserId: string;
let other: string;

beforeAll(async () => {
  A = await makeBusiness("ExpA");
  B = await makeBusiness("ExpB");
  mgr = (await addMember(A.business.id, A.roles.manager.id, "Manager Mo")).membership.id;
  other = (await addMember(A.business.id, A.roles.employee.id, "Colleague Cy")).membership.id;
  const mine = await addMember(A.business.id, A.roles.employee.id, "Exporter Ex");
  me = mine.membership.id;
  meUserId = mine.user.id;
  // Same person also works at business B.
  await db.membership.create({ data: { businessId: B.business.id, userId: meUserId, roleId: B.roles.employee.id } });
  await db.employeeProfile.update({ where: { membershipId: me }, data: { phone: "555-0100", pinHmac: "deadbeef" } });
  await db.wage.create({ data: { businessId: A.business.id, membershipId: me, rateCents: 2100, effectiveFrom: new Date("2026-01-01") } });
  const base = { businessId: A.business.id, locationId: A.location.id, membershipId: me };
  await db.shift.create({ data: { ...base, status: "published", notes: "published-shift", startsAt: new Date("2026-10-06T14:00:00Z"), endsAt: new Date("2026-10-06T20:00:00Z") } });
  await db.shift.create({ data: { ...base, status: "draft", notes: "draft-shift-not-yet-visible", startsAt: new Date("2026-10-07T14:00:00Z"), endsAt: new Date("2026-10-07T20:00:00Z") } });
  await db.timeEntry.create({ data: { ...base, clockIn: new Date("2026-10-06T14:00:00Z"), clockOut: new Date("2026-10-06T20:00:00Z") } });

  const dm = await openDirect(await ctxFor(me), mgr);
  await sendMessage(await ctxFor(me), { conversationId: dm.id, body: "my own words" });
  await sendMessage(await ctxFor(mgr), { conversationId: dm.id, body: "manager private reply" });
  const team = await createGroup(await ctxFor(mgr), { name: "Floor team", memberIds: [me, other] });
  await sendMessage(await ctxFor(other), { conversationId: team.id, body: "colleague gossip" });
  const mgmt = await createGroup(await ctxFor(mgr), { name: "Management", memberIds: [other] });
  await sendMessage(await ctxFor(mgr), { conversationId: mgmt.id, body: "management-only secret" });
  await sendAnnouncement(await ctxFor(mgr), { audience: { type: "all" }, title: "Heads up", body: "announcement body text", requireReadConfirmation: false });
  const ann = await db.announcement.findFirstOrThrow({ where: { businessId: A.business.id } });
  await db.announcementRead.create({ data: { businessId: A.business.id, announcementId: ann.id, membershipId: me } });
}, 300_000);

describe("export my data (§10.1)", () => {
  it("covers every business the user belongs to, with their own records", async () => {
    const x = await buildUserExport(meUserId);
    expect(x.businesses.map((b) => b.business.id).sort()).toEqual([A.business.id, B.business.id].sort());
    const a = x.businesses.find((b) => b.business.id === A.business.id)!;
    expect(a.membership.id).toBe(me);
    expect(a.profile?.phone).toBe("555-0100");
    expect(a.wages.map((w) => w.rateCents)).toEqual([2100]);
    expect(a.timeEntries).toHaveLength(1);
    expect(a.shifts.map((s) => s.notes)).toEqual(["published-shift"]);
  });

  it("contains only messages the user sent; received ones are metadata without body text", async () => {
    const x = await buildUserExport(meUserId);
    const a = x.businesses.find((b) => b.business.id === A.business.id)!;
    expect(a.messagesSent.map((m) => m.body)).toEqual(["my own words"]);
    expect(a.messagesReceived).toHaveLength(2);
    for (const m of a.messagesReceived) expect(Object.keys(m).sort()).toEqual(["conversationId", "id", "sender", "sentAt"]);
    expect(a.messagesReceived.map((m) => m.sender).sort()).toEqual(["Colleague Cy", "Manager Mo"]);
    expect(a.announcementsReceived).toHaveLength(1);
    expect(a.announcementsReceived[0].sender).toBe("Manager Mo");

    const json = JSON.stringify(x);
    for (const leaked of ["manager private reply", "colleague gossip", "management-only secret", "announcement body text", "Heads up", "Management", "deadbeef", "draft-shift-not-yet-visible"])
      expect(json).not.toContain(leaked);
  });

  it("colleagues' data isn't in it", async () => {
    const json = JSON.stringify(await buildUserExport(meUserId));
    expect(json).not.toContain(other);
    expect(json).not.toContain(A.employee.id);
  });

  it("is written to the audit log of each business", async () => {
    const x = await buildUserExport(meUserId);
    await auditUserExport(meUserId, x.businesses);
    const rows = await db.auditLog.findMany({ where: { actorUserId: meUserId, action: "DATA_EXPORTED" } });
    expect(rows.map((r) => r.businessId).sort()).toEqual([A.business.id, B.business.id].sort());
  });
});
