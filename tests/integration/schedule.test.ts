import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/auth/context";
import { UserError } from "@/server/action";
import {
  copyPreviousWeek,
  createShift,
  deleteShift,
  loadWeek,
  moveShift,
  publishWeek,
  updateShift,
  type ShiftInput,
} from "@/server/services/schedule";
import { flushBusinessNotifications } from "@/server/services/schedule-notify";
import { resolveLocationScope, saveLocationPreference } from "@/server/services/location-scope";
import { calendarForToken, rotateCalendarFeed } from "@/server/platform/calendar";
import { addMember, ctxFor, db, makeBusiness } from "../support/fixtures";

type Fx = Awaited<ReturnType<typeof makeBusiness>>;
let A: Fx;
let B: Fx;
let mgr: string;
let emp1: string;
let emp2: string;
let teen: string;
let second: { id: string };
const WEEK = "2026-10-19"; // a Monday
const later = () => new Date(Date.now() + 11 * 60_000);

const input = (over: Partial<ShiftInput> = {}): ShiftInput => ({
  date: "2026-10-20",
  start: "17:00",
  end: "23:00",
  breakMinutes: 0,
  locationId: A.location.id,
  positionId: A.position.id,
  membershipId: emp1,
  notes: "",
  geofenceOverride: null,
  ...over,
});

beforeAll(async () => {
  A = await makeBusiness("SchA");
  B = await makeBusiness("SchB");
  second = await db.location.create({ data: { businessId: A.business.id, name: "Second", timezone: "America/Toronto" } });
  const m = await addMember(A.business.id, A.roles.manager.id, "Mgr");
  mgr = m.membership.id;
  await db.membershipLocation.create({ data: { businessId: A.business.id, membershipId: mgr, locationId: A.location.id } });
  emp1 = (await addMember(A.business.id, A.roles.employee.id, "Emp One")).membership.id;
  emp2 = (await addMember(A.business.id, A.roles.employee.id, "Emp Two")).membership.id;
  teen = (await addMember(A.business.id, A.roles.employee.id, "Teen")).membership.id;
  await db.employeeProfile.update({ where: { membershipId: teen }, data: { dateOfBirth: new Date("2009-06-01") } });
  for (const id of [emp1, emp2, teen]) {
    await db.membershipLocation.create({ data: { businessId: A.business.id, membershipId: id, locationId: A.location.id } });
  }
});

describe("creating shifts", () => {
  it("a manager creates a draft shift at their location", async () => {
    const r = await createShift(await ctxFor(mgr), input());
    const s = await db.shift.findUniqueOrThrow({ where: { id: r.id } });
    expect(s.status).toBe("draft");
    expect(s.startsAt.toISOString()).toBe("2026-10-20T21:00:00.000Z");
    expect(s.endsAt.toISOString()).toBe("2026-10-21T03:00:00.000Z");
  });

  it("returns warnings at the moment of assignment, and they are also computed when the week is shown", async () => {
    const bar = await db.position.create({ data: { businessId: A.business.id, name: "Bar", requiresMinimumAge: 18 } });
    const r = await createShift(await ctxFor(mgr), input({ membershipId: teen, positionId: bar.id, date: "2026-10-21" }));
    expect(r.warnings.map((w) => w.type)).toEqual(["UNDER_AGE"]);
    const week = await loadWeek(await ctxFor(mgr), WEEK, [A.location.id]);
    expect(week.warnings.get(r.id)?.map((w) => w.type)).toEqual(["UNDER_AGE"]);
  });

  it("an overlapping assignment warns but is not blocked (§5.1)", async () => {
    const r = await createShift(await ctxFor(mgr), input({ start: "20:00", end: "23:30" }));
    expect(r.warnings.map((w) => w.type)).toContain("OVERLAP");
    await deleteShift(await ctxFor(mgr), r.id);
  });

  it("denies an employee", async () => {
    await expect(createShift(await ctxFor(emp1), input())).rejects.toThrow(ForbiddenError);
  });

  it("a manager without locations.scope_all can't schedule at a location they aren't assigned to", async () => {
    await expect(createShift(await ctxFor(mgr), input({ locationId: second.id }))).rejects.toThrow(UserError);
  });

  it("the owner (scope_all) can", async () => {
    await expect(createShift(await ctxFor(A.owner.id), input({ locationId: second.id, membershipId: null }))).resolves.toHaveProperty("id");
  });

  it("can't assign another business's employee", async () => {
    await expect(createShift(await ctxFor(mgr), input({ membershipId: B.employee.id }))).rejects.toThrow();
  });
});

describe("publishing and notifications (§5, §9.1)", () => {
  it("publishes drafts and queues one message per affected person — nothing for others", async () => {
    const ctx = await ctxFor(mgr);
    const res = await publishWeek(ctx, { weekStart: WEEK, locationIds: [A.location.id] });
    expect(res.published).toBeGreaterThanOrEqual(2);
    const pending = await db.notification.findMany({ where: { businessId: A.business.id, flushAfter: { not: null } } });
    const who = new Set(pending.map((n) => n.membershipId));
    expect(who).toEqual(new Set([emp1, teen]));
    expect(who.has(emp2)).toBe(false);
    const flushed = await flushBusinessNotifications(A.business.id, later());
    const mine = flushed.find((f) => f.membershipId === emp1)!;
    expect(mine.body).toContain("Tue 20 Oct shift added: 17:00–23:00 at Main");
  });

  it("editing a published shift sends a before → after diff, collapsed into one message", async () => {
    const ctx = await ctxFor(mgr);
    const s = await db.shift.findFirstOrThrow({ where: { businessId: A.business.id, membershipId: emp1, status: "published" } });
    await updateShift(ctx, s.id, input({ start: "17:15" }));
    await updateShift(ctx, s.id, input({ start: "17:15", end: "23:30" }));
    const pending = await db.notification.findMany({ where: { businessId: A.business.id, membershipId: emp1, flushAfter: { not: null } } });
    expect(pending).toHaveLength(1);
    const [msg] = await flushBusinessNotifications(A.business.id, later());
    expect(msg.body).toBe("Your week of 19 Oct changed: Tue 20 Oct: start 17:00→17:15, end 23:00→23:30.");
  });

  it("a change that is undone before the batch flushes sends nothing", async () => {
    const ctx = await ctxFor(mgr);
    const s = await db.shift.findFirstOrThrow({ where: { businessId: A.business.id, membershipId: emp1, status: "published" } });
    await updateShift(ctx, s.id, input({ start: "18:00", end: "23:30" }));
    await updateShift(ctx, s.id, input({ start: "17:15", end: "23:30" }));
    expect(await flushBusinessNotifications(A.business.id, later())).toEqual([]);
  });

  it("reassigning tells the old person it was removed and the new person it was added", async () => {
    const ctx = await ctxFor(mgr);
    const s = await db.shift.findFirstOrThrow({ where: { businessId: A.business.id, membershipId: emp1, status: "published" } });
    await moveShift(ctx, s.id, { date: "2026-10-20", membershipId: emp2 });
    const out = await flushBusinessNotifications(A.business.id, later());
    expect(out.find((o) => o.membershipId === emp1)?.body).toContain("shift removed (was 17:15–23:30 at Main)");
    expect(out.find((o) => o.membershipId === emp2)?.body).toContain("shift added: 17:15–23:30 at Main");
  });

  it("deleting a published shift soft-deletes it and notifies", async () => {
    const ctx = await ctxFor(mgr);
    const s = await db.shift.findFirstOrThrow({ where: { businessId: A.business.id, membershipId: emp2, status: "published" } });
    await deleteShift(ctx, s.id);
    expect((await db.shift.findUniqueOrThrow({ where: { id: s.id } })).deletedAt).not.toBeNull();
    const out = await flushBusinessNotifications(A.business.id, later());
    expect(out.find((o) => o.membershipId === emp2)?.body).toContain("shift removed");
  });

  it("an employee can't publish", async () => {
    await expect(publishWeek(await ctxFor(emp1), { weekStart: WEEK, locationIds: [A.location.id] })).rejects.toThrow(ForbiddenError);
  });
});

describe("reading the week", () => {
  it("employees see only published shifts, no warnings and no wages", async () => {
    await createShift(await ctxFor(mgr), input({ date: "2026-10-23", membershipId: emp2 }));
    const asEmp = await loadWeek(await ctxFor(emp1), WEEK, [A.location.id]);
    expect(asEmp.shifts.every((s) => s.status === "published")).toBe(true);
    expect(asEmp.warnings.size).toBe(0);
    expect(asEmp.wages).toBeNull();
    const asMgr = await loadWeek(await ctxFor(mgr), WEEK, [A.location.id]);
    expect(asMgr.shifts.some((s) => s.status === "draft")).toBe(true);
    expect(asMgr.wages).not.toBeNull();
  });

  it("shows statutory holidays in the week", async () => {
    await db.holiday.create({ data: { businessId: A.business.id, date: new Date("2026-10-22"), name: "Test Holiday" } });
    const w = await loadWeek(await ctxFor(mgr), WEEK, [A.location.id]);
    expect(w.holidays.map((h) => h.name)).toEqual(["Test Holiday"]);
  });
});

describe("copy previous week", () => {
  it("copies shifts 7 days later as drafts, and running it twice doesn't duplicate", async () => {
    const ctx = await ctxFor(A.owner.id);
    const before = await db.shift.count({ where: { businessId: A.business.id, deletedAt: null, startsAt: { gte: new Date("2026-10-26"), lt: new Date("2026-11-03") } } });
    const r1 = await copyPreviousWeek(ctx, { weekStart: "2026-10-26", locationIds: [A.location.id] });
    expect(r1.created).toBeGreaterThan(0);
    const r2 = await copyPreviousWeek(ctx, { weekStart: "2026-10-26", locationIds: [A.location.id] });
    expect(r2.created).toBe(0);
    const copies = await db.shift.findMany({ where: { businessId: A.business.id, deletedAt: null, startsAt: { gte: new Date("2026-10-26"), lt: new Date("2026-11-03") } } });
    expect(copies.length - before).toBe(r1.created);
    expect(copies.every((c) => c.status === "draft")).toBe(true);
  });

  it("keeps local wall-clock times across the DST change (EDT → EST on 1 Nov)", async () => {
    const ctx = await ctxFor(A.owner.id);
    await createShift(ctx, input({ date: "2026-10-27", start: "09:00", end: "17:00", membershipId: emp2 }));
    await copyPreviousWeek(ctx, { weekStart: "2026-11-02", locationIds: [A.location.id] });
    const copy = await db.shift.findFirstOrThrow({ where: { businessId: A.business.id, membershipId: emp2, startsAt: { gte: new Date("2026-11-03"), lt: new Date("2026-11-04") } } });
    expect(copy.startsAt.toISOString()).toBe("2026-11-03T14:00:00.000Z"); // 09:00 EST
  });
});

describe("location switcher (§5.2)", () => {
  it("one location → no switcher; several → defaults to one, remembers the choice", async () => {
    const mgrScope = await resolveLocationScope(await ctxFor(mgr));
    expect(mgrScope.showSwitcher).toBe(false);
    const owner = await ctxFor(A.owner.id);
    const s1 = await resolveLocationScope(owner);
    expect(s1.showSwitcher).toBe(true);
    expect(s1.ids).toHaveLength(1);
    await saveLocationPreference(owner, "all");
    const s2 = await resolveLocationScope(await ctxFor(A.owner.id));
    expect(s2.selected).toBe("all");
    expect(s2.ids.sort()).toEqual([A.location.id, second.id].sort());
    await saveLocationPreference(await ctxFor(A.owner.id), second.id);
    expect((await resolveLocationScope(await ctxFor(A.owner.id))).selected).toBe(second.id);
  });

  it("can't save a preference for a location outside your access", async () => {
    await expect(saveLocationPreference(await ctxFor(mgr), second.id)).rejects.toThrow(UserError);
  });
});

describe(".ics feed", () => {
  it("contains only the user's own published shifts; rotating kills the old link", async () => {
    const user = await db.membership.findUniqueOrThrow({ where: { id: teen } });
    await db.shift.updateMany({ where: { membershipId: teen }, data: { status: "published" } });
    const url = await rotateCalendarFeed(user.userId);
    const token = url.split("/").pop()!;
    const ics = (await calendarForToken(token))!;
    expect(ics).toContain("BEGIN:VCALENDAR");
    const n = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
    expect(n).toBe(await db.shift.count({ where: { membershipId: teen, status: "published", deletedAt: null } }));
    expect(ics).not.toContain("Emp One");
    const url2 = await rotateCalendarFeed(user.userId);
    expect(await calendarForToken(token)).toBeNull();
    expect(await calendarForToken(url2.split("/").pop()!)).not.toBeNull();
    expect(await calendarForToken("nope")).toBeNull();
  });
});
