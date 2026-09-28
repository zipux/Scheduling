import { beforeAll, describe, expect, it } from "vitest";
import { loadWeek } from "@/server/services/schedule";
import { shiftInstants, addDaysKey } from "@/lib/time";
import { ctxFor, db, makeBusiness, makeUser } from "../support/fixtures";

// §11: the week view for 50 employees loads in under 2 s. This measures the
// server-side data load (queries + warnings + wages) against the real database.
const WEEK = "2026-11-09";
let A: Awaited<ReturnType<typeof makeBusiness>>;

beforeAll(async () => {
  A = await makeBusiness("Perf");
  const users = await Promise.all(Array.from({ length: 50 }, (_, i) => makeUser(`Perf ${i}`)));
  await db.membership.createMany({ data: users.map((u) => ({ businessId: A.business.id, userId: u.id, roleId: A.roles.employee.id })) });
  const members = await db.membership.findMany({ where: { businessId: A.business.id, roleId: A.roles.employee.id } });
  await db.membershipLocation.createMany({ data: members.map((m) => ({ businessId: A.business.id, membershipId: m.id, locationId: A.location.id })) });
  await db.wage.createMany({ data: members.map((m) => ({ businessId: A.business.id, membershipId: m.id, rateCents: 1800, effectiveFrom: new Date("2026-01-01") })) });
  const shifts = members.flatMap((m, i) =>
    [0, 1, 2, 3, 4].map((d) => ({
      businessId: A.business.id,
      locationId: A.location.id,
      positionId: A.position.id,
      membershipId: m.id,
      status: "published" as const,
      ...shiftInstants(addDaysKey(WEEK, (d + i) % 7), "09:00", "17:00", "America/Toronto"),
    })),
  );
  await db.shift.createMany({ data: shifts });
}, 300_000);

describe("schedule performance (§11)", () => {
  it("loads a 50-person week with warnings and wages in under 2 s", async () => {
    const ctx = await ctxFor(A.owner.id);
    await loadWeek(ctx, WEEK, [A.location.id]); // warm the connection pool
    const t0 = performance.now();
    const w = await loadWeek(ctx, WEEK, [A.location.id]);
    const ms = performance.now() - t0;
    expect(w.members.length).toBeGreaterThanOrEqual(50);
    expect(w.shifts.length).toBeGreaterThanOrEqual(250);
    console.info(`[perf] loadWeek 50 people / ${w.shifts.length} shifts: ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(2000);
  });
});
