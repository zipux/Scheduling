/**
 * Development / test seed. DESTRUCTIVE: truncates every table in the target
 * database first. Run with `npm run db:seed` (dev DB) or `npm run db:test:seed`.
 *
 * Seed logins are printed at the end and listed in README.md.
 */
import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { rawDb as db } from "../src/server/db/client";
import { createBusinessWithDefaults } from "../src/server/platform/business";
import { pinDigest } from "../src/lib/crypto";
import { env } from "../src/lib/env";
import { addDaysKey, dateKeyInTz, shiftInstants, weekStartKey } from "../src/lib/time";

export const SEED_PASSWORD = "password1234";

type RoleKey = "owner" | "general_manager" | "manager" | "assistant_manager" | "shift_lead" | "employee";

interface Person {
  name: string;
  email: string;
  role: RoleKey;
  pin: string;
  wageCents: number;
  dob: string;
  positions: string[];
  locations: number[]; // indexes into the business's locations
}

async function truncateAll() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}

const userIds = new Map<string, string>();

async function ensureUser(name: string, email: string, opts: { isPlatformAdmin?: boolean } = {}) {
  const existing = userIds.get(email);
  if (existing) return existing;
  const user = await db.user.create({
    data: { name, email, emailVerified: true, isPlatformAdmin: opts.isPlatformAdmin ?? false },
  });
  await db.account.create({
    data: { userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(SEED_PASSWORD) },
  });
  userIds.set(email, user.id);
  return user.id;
}

async function seedBusiness(opts: {
  name: string;
  country: string;
  region: string;
  timezone: string;
  locations: { name: string; address: string; lat: number; lng: number }[];
  positions: { name: string; color: string; requiresMinimumAge?: number }[];
  people: Person[];
}) {
  const { business, roles } = await db.$transaction((tx) =>
    createBusinessWithDefaults(tx, {
      name: opts.name,
      country: opts.country,
      region: opts.region,
      timezone: opts.timezone,
      currency: "CAD",
    }),
  );
  await db.business.update({
    where: { id: business.id },
    data: { setupCompletedAt: new Date(), payPeriodAnchorDate: new Date("2026-09-14T00:00:00Z") },
  });
  await db.payRules.update({ where: { businessId: business.id }, data: { confirmedAt: new Date() } });

  const locations = [];
  for (const l of opts.locations) {
    locations.push(
      await db.location.create({
        data: { businessId: business.id, name: l.name, address: l.address, timezone: opts.timezone, lat: l.lat, lng: l.lng },
      }),
    );
  }
  const positions = new Map<string, string>();
  for (const p of opts.positions) {
    const row = await db.position.create({
      data: { businessId: business.id, name: p.name, color: p.color, requiresMinimumAge: p.requiresMinimumAge ?? null },
    });
    positions.set(p.name, row.id);
  }

  const memberships: Record<string, string> = {};
  for (const person of opts.people) {
    const userId = await ensureUser(person.name, person.email);
    const m = await db.membership.create({
      data: {
        businessId: business.id,
        userId,
        roleId: roles[person.role].id,
        status: "active",
        hireDate: new Date("2025-03-01T00:00:00Z"),
      },
    });
    memberships[person.email] = m.id;
    await db.employeeProfile.create({
      data: {
        businessId: business.id,
        membershipId: m.id,
        phone: "+1 416 555 0100",
        dateOfBirth: new Date(`${person.dob}T00:00:00Z`),
        address: "123 Example St",
        emergencyContactName: "Alex Contact",
        emergencyContactRelation: "Sibling",
        emergencyContactPhone: "+1 416 555 0199",
        pinHmac: await pinDigest(env().PIN_HMAC_SECRET, m.id, person.pin),
        completedAt: new Date(),
      },
    });
    for (const idx of person.locations) {
      await db.membershipLocation.create({
        data: { businessId: business.id, membershipId: m.id, locationId: locations[idx].id },
      });
    }
    for (const pos of person.positions) {
      await db.membershipPosition.create({
        data: { businessId: business.id, membershipId: m.id, positionId: positions.get(pos)! },
      });
    }
    await db.wage.create({
      data: {
        businessId: business.id,
        membershipId: m.id,
        rateCents: person.wageCents,
        type: "hourly",
        effectiveFrom: new Date("2025-03-01T00:00:00Z"),
      },
    });
  }
  return { business, locations, positions, memberships, roles };
}

type Seeded = Awaited<ReturnType<typeof seedBusiness>>;

/**
 * Two weeks of shifts: this week published, next week as drafts (with one
 * deliberate under-age assignment so the persistent warning is visible), plus
 * statutory holidays inside the period.
 */
async function seedSchedule(biz: Seeded, tz: string) {
  const businessId = biz.business.id;
  const week0 = weekStartKey(dateKeyInTz(new Date(), tz));
  const loc = biz.locations[0];
  const pos = (name: string) => biz.positions.get(name) ?? null;
  const people = Object.entries(biz.memberships);
  const plan: [number, string, string, number][] = [
    // [dayOffset, start, end, breakMinutes]
    [0, "09:00", "17:00", 30],
    [1, "11:00", "19:00", 30],
    [2, "16:00", "23:00", 0],
    [4, "17:00", "01:00", 30],
    [5, "10:00", "16:00", 0],
  ];
  const positionOf = new Map([
    ["emma@maple.example.com", "Server"],
    ["noah@maple.example.com", "Kitchen"],
    ["mia@maple.example.com", "Bar"],
    ["liam@maple.example.com", "Host"],
    ["lead@maple.example.com", "Kitchen"],
    ["assistant@maple.example.com", "Kitchen"],
    ["manager@maple.example.com", "Server"],
    ["ava@harbour.example.com", "Barista"],
    ["sam@example.com", tz === "America/Toronto" ? "Server" : "Cashier"],
  ]);
  let i = 0;
  for (const [email, membershipId] of people) {
    const position = positionOf.get(email);
    if (!position) continue;
    for (const week of [0, 1]) {
      for (const [k, [offset, start, end, br]] of plan.entries()) {
        if ((k + i) % 2 === 1) continue; // stagger so people don't all work the same days
        const date = addDaysKey(week0, week * 7 + offset);
        await db.shift.create({
          data: {
            businessId,
            locationId: (email === "sam@example.com" || email === "liam@maple.example.com") && biz.locations[1] ? biz.locations[1].id : loc.id,
            positionId: pos(position),
            membershipId,
            ...shiftInstants(date, start, end, tz),
            breakMinutes: br,
            status: week === 0 ? "published" : "draft",
            publishedAt: week === 0 ? new Date() : null,
          },
        });
      }
    }
    i++;
  }
  // An open shift next week, and a deliberate warning: a 17-year-old on the Bar (18+).
  await db.shift.create({
    data: { businessId, locationId: loc.id, positionId: pos(tz === "America/Toronto" ? "Server" : "Barista"), ...shiftInstants(addDaysKey(week0, 10), "17:00", "22:00", tz), status: "published", publishedAt: new Date() },
  });
  const liam = biz.memberships["liam@maple.example.com"];
  if (liam) {
    await db.shift.create({
      data: { businessId, locationId: loc.id, positionId: pos("Bar"), membershipId: liam, ...shiftInstants(addDaysKey(week0, 12), "18:00", "23:00", tz), status: "draft" },
    });
  }
  await db.holiday.createMany({
    data: [
      { businessId, date: new Date("2026-10-12T00:00:00Z"), name: "Thanksgiving", isStatutory: true, premiumMultiplier: 1.5 },
      { businessId, date: new Date("2026-12-25T00:00:00Z"), name: "Christmas Day", isStatutory: true, premiumMultiplier: 1.5 },
    ],
  });
  await db.shiftTemplate.createMany({
    data: [
      { businessId, name: "Lunch", startMinutes: 11 * 60, endMinutes: 15 * 60, breakMinutes: 0, locationId: loc.id },
      { businessId, name: "Dinner close", startMinutes: 17 * 60, endMinutes: 25 * 60, breakMinutes: 30, locationId: loc.id },
    ],
  });
}

/** Sample requests: pending and approved time off, a blackout, availability, a dropped shift. */
async function seedRequests(biz: Seeded, tz: string) {
  const businessId = biz.business.id;
  const today = dateKeyInTz(new Date(), tz);
  const m = biz.memberships;
  const allDay = (from: string, to: string) => ({ startsAt: localMidnight(from, tz), endsAt: localMidnight(addDaysKey(to, 1), tz), allDay: true });
  await db.timeOffRequest.create({ data: { businessId, membershipId: m["emma@maple.example.com"], type: "vacation", reason: "Family visit", ...allDay(addDaysKey(today, 20), addDaysKey(today, 22)) } });
  await db.timeOffRequest.create({
    data: { businessId, membershipId: m["noah@maple.example.com"], type: "personal", status: "approved", reviewerId: m["manager@maple.example.com"], reviewedAt: new Date(), ...allDay(addDaysKey(today, 25), addDaysKey(today, 25)) },
  });
  await db.blackoutPeriod.create({
    data: { businessId, startDate: new Date(`${addDaysKey(today, 60)}T00:00:00Z`), endDate: new Date(`${addDaysKey(today, 62)}T00:00:00Z`), reason: "Annual food festival" },
  });
  const requestId = "seed-availability-liam";
  for (let weekday = 0; weekday < 7; weekday++) {
    await db.availabilityRule.create({
      data: {
        businessId,
        membershipId: m["liam@maple.example.com"],
        weekday,
        kind: weekday === 0 || weekday === 6 ? "all_day" : "between",
        startMinutes: weekday === 0 || weekday === 6 ? null : 16 * 60,
        endMinutes: weekday === 0 || weekday === 6 ? null : 23 * 60,
        effectiveFrom: new Date(`${today}T00:00:00Z`),
        requestId,
        status: "approved",
        reviewedAt: new Date(),
      },
    });
  }
  const miaShift = await db.shift.findFirst({ where: { businessId, membershipId: m["mia@maple.example.com"], status: "published", startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } });
  if (miaShift) {
    await db.shift.update({ where: { id: miaShift.id }, data: { claimGeneration: { increment: 1 } } });
    await db.shiftTradeRequest.create({ data: { businessId, type: "drop", shiftId: miaShift.id, fromMembershipId: m["mia@maple.example.com"], status: "pending" } });
  }
}

/** Clock entries, including one carrying each punch-related flag (§7.7). */
async function seedClock(biz: Seeded) {
  const businessId = biz.business.id;
  const m = biz.memberships;
  const loc = biz.locations[0];
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
  const entry = async (email: string, data: object, flags: string[] = []) => {
    const e = await db.timeEntry.create({ data: { businessId, membershipId: m[email], locationId: loc.id, source: "personal", ...data } });
    for (const type of flags) await db.timeEntryFlag.create({ data: { businessId, timeEntryId: e.id, type: type as never } });
    return e;
  };
  const done = await entry("emma@maple.example.com", { clockIn: hoursAgo(30), clockOut: hoursAgo(22), inLat: loc.lat, inLng: loc.lng, inAccuracy: 12 });
  await db.breakEntry.create({ data: { businessId, timeEntryId: done.id, startsAt: hoursAgo(26), endsAt: hoursAgo(25.5) } });
  await entry("noah@maple.example.com", { clockIn: hoursAgo(20) }, ["MISSING_CLOCK_OUT"]);
  await entry("mia@maple.example.com", { clockIn: null, clockOut: hoursAgo(26) }, ["MISSING_CLOCK_IN"]);
  await entry("lead@maple.example.com", { clockIn: hoursAgo(50), clockOut: hoursAgo(42), source: "offline", inDeviceTime: hoursAgo(50), inServerTime: hoursAgo(49) }, ["OFFLINE_QUEUED"]);
  await entry("assistant@maple.example.com", { clockIn: hoursAgo(28), clockOut: hoursAgo(20), inLat: (loc.lat ?? 0) + 0.0003, inLng: loc.lng, inAccuracy: 140 }, ["GEO_UNCERTAIN", "LATE"]);
  await entry("liam@maple.example.com", { clockIn: hoursAgo(54), clockOut: hoursAgo(49), inLat: (loc.lat ?? 0) + 0.01, inLng: loc.lng, inAccuracy: 15 }, ["GEO_OUTSIDE", "UNSCHEDULED", "EARLY_LEAVE"]);
  await entry("manager@maple.example.com", { clockIn: hoursAgo(76), clockOut: hoursAgo(68) }, ["OFFSITE"]);
}

function localMidnight(dateKey: string, tz: string) {
  return shiftInstants(dateKey, "00:00", "00:01", tz).startsAt;
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");
  await truncateAll();

  await ensureUser("Platform Admin", "admin@example.com", { isPlatformAdmin: true });

  const maple = await seedBusiness({
    name: "Maple Bistro",
    country: "CA",
    region: "ON",
    timezone: "America/Toronto",
    locations: [
      { name: "King St", address: "100 King St W, Toronto, ON", lat: 43.6487, lng: -79.3817 },
      { name: "Queen St", address: "500 Queen St W, Toronto, ON", lat: 43.6477, lng: -79.4003 },
    ],
    positions: [
      { name: "Kitchen", color: "#ea580c" },
      { name: "Server", color: "#2563eb" },
      { name: "Bar", color: "#7c3aed", requiresMinimumAge: 18 },
      { name: "Host", color: "#16a34a" },
    ],
    people: [
      { name: "Olivia Owner", email: "owner@maple.example.com", role: "owner", pin: "1111", wageCents: 3500, dob: "1980-04-12", positions: ["Kitchen", "Server"], locations: [0, 1] },
      { name: "Gina General", email: "gm@maple.example.com", role: "general_manager", pin: "2222", wageCents: 3000, dob: "1985-06-02", positions: ["Server", "Bar"], locations: [0, 1] },
      { name: "Marco Manager", email: "manager@maple.example.com", role: "manager", pin: "3333", wageCents: 2600, dob: "1990-01-20", positions: ["Server", "Host"], locations: [0] },
      { name: "Aisha Assistant", email: "assistant@maple.example.com", role: "assistant_manager", pin: "4444", wageCents: 2300, dob: "1994-09-09", positions: ["Kitchen"], locations: [0] },
      { name: "Leo Lead", email: "lead@maple.example.com", role: "shift_lead", pin: "5555", wageCents: 2100, dob: "1997-11-30", positions: ["Kitchen"], locations: [0] },
      { name: "Emma Server", email: "emma@maple.example.com", role: "employee", pin: "1234", wageCents: 1800, dob: "2000-02-14", positions: ["Server"], locations: [0] },
      { name: "Noah Cook", email: "noah@maple.example.com", role: "employee", pin: "2345", wageCents: 1900, dob: "1999-07-04", positions: ["Kitchen"], locations: [0] },
      { name: "Mia Bartender", email: "mia@maple.example.com", role: "employee", pin: "3456", wageCents: 2000, dob: "1998-03-03", positions: ["Bar", "Server"], locations: [0, 1] },
      { name: "Liam Host", email: "liam@maple.example.com", role: "employee", pin: "4567", wageCents: 1750, dob: "2009-05-15", positions: ["Host"], locations: [1] },
      { name: "Sam Shared", email: "sam@example.com", role: "employee", pin: "9876", wageCents: 1850, dob: "2001-10-10", positions: ["Server"], locations: [1] },
      // No scheduled shifts: handy for trying the clock at any time of day.
      { name: "Clara Clock", email: "clara@maple.example.com", role: "employee", pin: "2580", wageCents: 1800, dob: "1996-02-02", positions: ["Server"], locations: [0] },
      { name: "Omar Offline", email: "omar@maple.example.com", role: "employee", pin: "1470", wageCents: 1800, dob: "1993-03-03", positions: ["Kitchen"], locations: [0] },
      { name: "Pat Kiosk", email: "pat@maple.example.com", role: "employee", pin: "3690", wageCents: 1800, dob: "1991-04-04", positions: ["Host"], locations: [0] },
    ],
  });

  const harbour = await seedBusiness({
    name: "Harbour Café",
    country: "CA",
    region: "BC",
    timezone: "America/Vancouver",
    locations: [{ name: "Waterfront", address: "200 Waterfront Rd, Vancouver, BC", lat: 49.2888, lng: -123.1111 }],
    positions: [
      { name: "Barista", color: "#92400e" },
      { name: "Cashier", color: "#0891b2" },
    ],
    people: [
      { name: "Henry Harbour", email: "owner@harbour.example.com", role: "owner", pin: "1111", wageCents: 3200, dob: "1978-08-08", positions: ["Barista"], locations: [0] },
      { name: "Ava Barista", email: "ava@harbour.example.com", role: "employee", pin: "1357", wageCents: 1800, dob: "2002-12-01", positions: ["Barista", "Cashier"], locations: [0] },
      { name: "Sam Shared", email: "sam@example.com", role: "employee", pin: "2468", wageCents: 1900, dob: "2001-10-10", positions: ["Cashier"], locations: [0] },
    ],
  });

  await seedSchedule(maple, "America/Toronto");
  await seedSchedule(harbour, "America/Vancouver");
  await seedRequests(maple, "America/Toronto");
  await seedClock(maple);

  console.log("\nSeed complete.");
  console.log(`Password for every seed account: ${SEED_PASSWORD}`);
  console.log(`  Platform admin:  admin@example.com`);
  console.log(`  ${maple.business.name}: owner@maple.example.com, gm@, manager@, assistant@, lead@, emma@, noah@, mia@, liam@maple.example.com`);
  console.log(`  ${harbour.business.name}: owner@harbour.example.com, ava@harbour.example.com`);
  console.log(`  In both businesses: sam@example.com`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
