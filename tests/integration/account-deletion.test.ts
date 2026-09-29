import { describe, expect, it } from "vitest";
import { cancelAccountDeletion, listDeletionRequests, requestAccountDeletion } from "@/server/platform/account-deletion";
import { db, makeUser } from "../support/fixtures";

describe("request account deletion (§10 Account)", () => {
  it("records one request, audits it and tells the platform admins — deleting nothing", async () => {
    const admin = await makeUser("Platform Admin");
    await db.user.update({ where: { id: admin.id }, data: { isPlatformAdmin: true } });
    const user = await makeUser("Leaving Lee");

    const [a, b] = await Promise.all([requestAccountDeletion(user.id), requestAccountDeletion(user.id)]);
    expect(a.getTime()).toBe(b.getTime());
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).deletionRequestedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { targetId: user.id, action: "ACCOUNT_DELETION_REQUESTED" } })).toBe(1);
    const emails = await db.emailLog.findMany({ where: { to: admin.email, template: "account-deletion-requested" } });
    expect(emails).toHaveLength(1);
    expect(emails[0].text).toContain(user.email);

    expect((await listDeletionRequests()).map((r) => r.id)).toContain(user.id);
  });

  it("can be cancelled by the user, and cancelling twice changes nothing", async () => {
    const user = await makeUser("Changed Mind");
    await requestAccountDeletion(user.id);
    await cancelAccountDeletion(user.id);
    await cancelAccountDeletion(user.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).deletionRequestedAt).toBeNull();
    expect(await db.auditLog.count({ where: { targetId: user.id, action: "ACCOUNT_DELETION_CANCELLED" } })).toBe(1);
    expect((await listDeletionRequests()).map((r) => r.id)).not.toContain(user.id);
  });
});
