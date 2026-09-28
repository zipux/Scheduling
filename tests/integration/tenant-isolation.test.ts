import { beforeAll, describe, expect, it } from "vitest";
import { TENANT_MODELS, TenantViolationError, tenantDb } from "@/server/db/tenant";
import { makeBusiness } from "../support/fixtures";

// Spec §3.3: prove a user of business A cannot read or write anything of business B.

type Fx = Awaited<ReturnType<typeof makeBusiness>>;
let A: Fx;
let B: Fx;

beforeAll(async () => {
  A = await makeBusiness("A");
  B = await makeBusiness("B");
});

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

describe("tenant isolation — reads", () => {
  it("findMany on every tenant model returns only this business's rows, even when asked for B", async () => {
    const dbA = tenantDb(A.business.id) as unknown as Record<string, { findMany: (a: unknown) => Promise<{ businessId: string | null }[]> }>;
    for (const model of TENANT_MODELS) {
      const rows = await dbA[lowerFirst(model)].findMany({ where: { businessId: B.business.id } });
      // The caller's filter is ANDed with the tenant scope, never replaced by it.
      expect(rows, model).toEqual([]);
      const own = await dbA[lowerFirst(model)].findMany({});
      expect(own.every((r) => r.businessId === A.business.id), model).toBe(true);
    }
  });

  it("cannot fetch B's rows by id", async () => {
    const dbA = tenantDb(A.business.id);
    expect(await dbA.location.findUnique({ where: { id: B.location.id } })).toBeNull();
    expect(await dbA.shift.findFirst({ where: { id: B.shift.id } })).toBeNull();
    expect(await dbA.membership.findUnique({ where: { id: B.employee.id } })).toBeNull();
    expect(await dbA.timeEntry.findUnique({ where: { id: B.timeEntry.id } })).toBeNull();
    expect(await dbA.wage.count({ where: { membershipId: B.employee.id } })).toBe(0);
  });

  it("sees its own rows", async () => {
    const dbA = tenantDb(A.business.id);
    expect((await dbA.location.findUnique({ where: { id: A.location.id } }))?.id).toBe(A.location.id);
    expect(await dbA.membership.count()).toBe(2);
  });

  it("Business is restricted to itself — B cannot be discovered", async () => {
    const dbA = tenantDb(A.business.id);
    const all = await dbA.business.findMany();
    expect(all.map((b) => b.id)).toEqual([A.business.id]);
    expect(await dbA.business.findUnique({ where: { id: B.business.id } })).toBeNull();
    expect(await dbA.business.count({ where: { name: B.business.name } })).toBe(0);
  });

  it("User is visible only if they are a member of this business", async () => {
    const dbA = tenantDb(A.business.id);
    expect(await dbA.user.findUnique({ where: { id: B.employeeUser.id } })).toBeNull();
    expect(
      await dbA.user.findMany({ where: { memberships: { some: { businessId: B.business.id } } } }),
    ).toEqual([]);
    expect((await dbA.user.findUnique({ where: { id: A.employeeUser.id } }))?.id).toBe(A.employeeUser.id);
  });

  it("refuses to traverse from a user to their other memberships, sessions or accounts", async () => {
    const dbA = tenantDb(A.business.id);
    await expect(
      dbA.membership.findMany({ include: { user: { include: { memberships: true } } } }),
    ).rejects.toThrow(TenantViolationError);
    await expect(dbA.user.findMany({ include: { sessions: true } })).rejects.toThrow(TenantViolationError);
    await expect(dbA.user.findMany({ select: { accounts: true } })).rejects.toThrow(TenantViolationError);
  });

  it("auth tables are unreachable", async () => {
    const dbA = tenantDb(A.business.id);
    await expect(dbA.session.findMany()).rejects.toThrow(TenantViolationError);
    await expect(dbA.account.findMany()).rejects.toThrow(TenantViolationError);
    await expect(dbA.verification.findMany()).rejects.toThrow(TenantViolationError);
  });
});

describe("tenant isolation — writes", () => {
  it("cannot update or delete B's rows by id", async () => {
    const dbA = tenantDb(A.business.id);
    await expect(dbA.location.update({ where: { id: B.location.id }, data: { name: "pwned" } })).rejects.toThrow();
    await expect(dbA.shift.delete({ where: { id: B.shift.id } })).rejects.toThrow();
    expect((await dbA.shift.updateMany({ where: { id: B.shift.id }, data: { notes: "x" } })).count).toBe(0);
    expect((await dbA.timeEntry.deleteMany({ where: { id: B.timeEntry.id } })).count).toBe(0);
    await expect(dbA.business.update({ where: { id: B.business.id }, data: { name: "pwned" } })).rejects.toThrow();
  });

  it("B's data is unchanged afterwards", async () => {
    const dbB = tenantDb(B.business.id);
    expect((await dbB.location.findUnique({ where: { id: B.location.id } }))?.name).toBe("Main");
    expect(await dbB.shift.findUnique({ where: { id: B.shift.id } })).not.toBeNull();
    expect(await dbB.timeEntry.findUnique({ where: { id: B.timeEntry.id } })).not.toBeNull();
    expect((await dbB.business.findUnique({ where: { id: B.business.id } }))?.name).toBe(B.business.name);
  });

  it("creates are stamped with this business", async () => {
    const dbA = tenantDb(A.business.id);
    const p = await dbA.position.create({ data: { name: "Bar" } as never });
    expect(p.businessId).toBe(A.business.id);
  });

  it("cannot create a row claiming B's businessId", async () => {
    const dbA = tenantDb(A.business.id);
    await expect(dbA.position.create({ data: { name: "x", businessId: B.business.id } })).rejects.toThrow(
      TenantViolationError,
    );
  });

  it("cannot reference B's rows from A's rows", async () => {
    const dbA = tenantDb(A.business.id);
    const base = {
      startsAt: new Date("2026-10-06T14:00:00Z"),
      endsAt: new Date("2026-10-06T22:00:00Z"),
    };
    await expect(
      dbA.shift.create({ data: { ...base, locationId: B.location.id, positionId: A.position.id } as never }),
    ).rejects.toThrow(TenantViolationError);
    await expect(
      dbA.shift.create({ data: { ...base, locationId: A.location.id, membershipId: B.employee.id } as never }),
    ).rejects.toThrow(TenantViolationError);
    await expect(
      dbA.shift.update({ where: { id: A.shift.id }, data: { membershipId: B.employee.id } }),
    ).rejects.toThrow(TenantViolationError);
    await expect(
      dbA.membership.update({ where: { id: A.employee.id }, data: { roleId: B.roles.owner.id } }),
    ).rejects.toThrow(TenantViolationError);
    await expect(
      dbA.invitation.create({
        data: {
          email: "x@example.com",
          name: "X",
          roleId: A.roles.employee.id,
          locationIds: [B.location.id],
          tokenHash: "h-" + Date.now(),
          expiresAt: new Date(),
        } as never,
      }),
    ).rejects.toThrow(TenantViolationError);
  });

  it("refuses nested relation writes that would bypass the checks", async () => {
    const dbA = tenantDb(A.business.id);
    await expect(
      dbA.membership.update({
        where: { id: A.employee.id },
        data: { locations: { create: { businessId: B.business.id, locationId: B.location.id } } } as never,
      }),
    ).rejects.toThrow(TenantViolationError);
  });

  it("cannot create or delete businesses", async () => {
    const dbA = tenantDb(A.business.id);
    await expect(
      dbA.business.create({ data: { name: "x", country: "CA", region: "ON", timezone: "UTC" } }),
    ).rejects.toThrow(TenantViolationError);
    await expect(dbA.business.delete({ where: { id: A.business.id } })).rejects.toThrow(TenantViolationError);
  });

  it("interactive transactions stay scoped", async () => {
    const dbA = tenantDb(A.business.id);
    const res = await dbA.$transaction(async (tx) => tx.shift.findMany({ where: { id: B.shift.id } }));
    expect(res).toEqual([]);
  });

  it("requires a businessId", () => {
    expect(() => tenantDb("")).toThrow(TenantViolationError);
  });
});
