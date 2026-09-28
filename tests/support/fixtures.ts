import { rawDb } from "@/server/db/client";
import { createBusinessWithDefaults } from "@/server/platform/business";
import { randomToken } from "@/lib/crypto";

export const db = rawDb;

let n = 0;
export function uniq(prefix: string) {
  n += 1;
  return `${prefix}-${Date.now().toString(36)}-${n}-${randomToken(4)}`;
}

export async function makeUser(name = "Test User") {
  return db.user.create({ data: { name, email: `${uniq("u")}@test.example.com`, emailVerified: true } });
}

/** A business with one location, one position, an owner and one employee, and one shift. */
export async function makeBusiness(name = "Biz") {
  const { business, roles } = await db.$transaction((tx) =>
    createBusinessWithDefaults(tx, {
      name: uniq(name),
      country: "CA",
      region: "ON",
      timezone: "America/Toronto",
      currency: "CAD",
    }),
  );
  const location = await db.location.create({
    data: { businessId: business.id, name: "Main", timezone: "America/Toronto", lat: 43.65, lng: -79.38 },
  });
  const position = await db.position.create({ data: { businessId: business.id, name: "Server" } });
  const ownerUser = await makeUser(`${name} Owner`);
  const owner = await db.membership.create({
    data: { businessId: business.id, userId: ownerUser.id, roleId: roles.owner.id },
  });
  const employeeUser = await makeUser(`${name} Employee`);
  const employee = await db.membership.create({
    data: { businessId: business.id, userId: employeeUser.id, roleId: roles.employee.id },
  });
  const shift = await db.shift.create({
    data: {
      businessId: business.id,
      locationId: location.id,
      positionId: position.id,
      membershipId: employee.id,
      startsAt: new Date("2026-10-05T14:00:00Z"),
      endsAt: new Date("2026-10-05T22:00:00Z"),
    },
  });
  const timeEntry = await db.timeEntry.create({
    data: {
      businessId: business.id,
      membershipId: employee.id,
      locationId: location.id,
      clockIn: new Date("2026-10-05T14:00:00Z"),
      clockOut: new Date("2026-10-05T22:00:00Z"),
    },
  });
  await db.timeEntryFlag.create({ data: { businessId: business.id, timeEntryId: timeEntry.id, type: "LATE" } });
  await db.wage.create({
    data: { businessId: business.id, membershipId: employee.id, rateCents: 1800, effectiveFrom: new Date("2026-01-01") },
  });
  await db.auditLog.create({ data: { businessId: business.id, action: "TEST" } });
  return { business, roles, location, position, owner, ownerUser, employee, employeeUser, shift, timeEntry };
}
