import { beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/auth/context";
import { UserError } from "@/server/action";
import { addDaysKey, dateKeyInTz, shiftInstants } from "@/lib/time";
import { cancelTimeOff, createBlackout, requestTimeOff, reviewTimeOff, timeOffToReview } from "@/server/services/requests/timeoff";
import { reviewAvailability, submitAvailability } from "@/server/services/requests/availability";
import { openConflicts, resolveConflict } from "@/server/services/requests/conflicts";
import {
  ALREADY_TAKEN,
  availableShifts,
  claimShift,
  dropShift,
  proposeSwap,
  respondToSwap,
  reviewTrade,
  swapCandidates,
} from "@/server/services/requests/trades";
import { addMember, ctxFor, db, makeBusiness } from "../support/fixtures";

const TZ = "America/Toronto";
const today = () => dateKeyInTz(new Date(), TZ);
const day = (n: number) => addDaysKey(today(), n);

type Fx = Awaited<ReturnType<typeof makeBusiness>>;
let A: Fx;
let kitchen: string;
let bar: string;
let mgr: string;
let cook: string;
let cook2: string;
let bartender: string;
const claimers: string[] = [];

async function person(roleKey: keyof Fx["roles"], name: string, positions: string[]) {
  const m = (await addMember(A.business.id, A.roles[roleKey].id, name)).membership.id;
  await db.membershipLocation.create({ data: { businessId: A.business.id, membershipId: m, locationId: A.location.id } });
  for (const p of positions) await db.membershipPosition.create({ data: { businessId: A.business.id, membershipId: m, positionId: p } });
  await db.employeeProfile.update({ where: { membershipId: m }, data: { dateOfBirth: new Date("1995-01-01") } });
  return m;
}

async function publishedShift(membershipId: string | null, positionId: string, dayOffset: number, start = "17:00", end = "22:00") {
  return db.shift.create({
    data: {
      businessId: A.business.id,
      locationId: A.location.id,
      positionId,
      membershipId,
      status: "published",
      ...shiftInstants(day(dayOffset), start, end, TZ),
    },
  });
}

async function setRules(data: Partial<{ dropNeedsApproval: boolean; pickupNeedsApproval: boolean; swapNeedsApproval: boolean; allowSelfTimeOffApproval: boolean; availabilityNeedsApproval: boolean; timeOffMinNoticeDays: number }>) {
  await db.business.update({ where: { id: A.business.id }, data });
}

beforeAll(async () => {
  A = await makeBusiness("Req");
  kitchen = (await db.position.create({ data: { businessId: A.business.id, name: "Kitchen" } })).id;
  bar = (await db.position.create({ data: { businessId: A.business.id, name: "Bar", requiresMinimumAge: 18 } })).id;
  mgr = await person("manager", "Mgr", [kitchen, bar]);
  cook = await person("employee", "Cook", [kitchen]);
  cook2 = await person("employee", "Cook Two", [kitchen]);
  bartender = await person("employee", "Bartender", [bar]);
  for (let i = 0; i < 10; i++) claimers.push(await person("employee", `Claimer ${i}`, [kitchen]));
}, 300_000);

describe("time off (§6.1)", () => {
  it("is blocked at submission by a blackout, with the reason", async () => {
    await createBlackout(await ctxFor(A.owner.id), { startDate: day(30), endDate: day(32), locationId: null, reason: "Wedding season rush" });
    await expect(
      requestTimeOff(await ctxFor(cook), { type: "vacation", allDay: true, startDate: day(31), endDate: day(33), reason: "" }),
    ).rejects.toThrow("Wedding season rush");
  });

  it("enforces minimum notice, except for sick time", async () => {
    await setRules({ timeOffMinNoticeDays: 14 });
    await expect(requestTimeOff(await ctxFor(cook), { type: "vacation", allDay: true, startDate: day(3), endDate: day(3), reason: "" })).rejects.toThrow("14 days");
    const sick = await requestTimeOff(await ctxFor(cook), { type: "sick", allDay: true, startDate: day(1), endDate: day(1), reason: "" });
    await cancelTimeOff(await ctxFor(cook), sick.id);
    await setRules({ timeOffMinNoticeDays: 0 });
  });

  it("an employee can cancel while pending; approvers see it; employees can't approve", async () => {
    const r = await requestTimeOff(await ctxFor(cook), { type: "personal", allDay: false, startDate: day(40), endDate: day(40), startTime: "09:00", endTime: "12:00", reason: "Dentist" });
    expect((await timeOffToReview(await ctxFor(mgr))).map((x) => x.id)).toContain(r.id);
    await expect(reviewTimeOff(await ctxFor(cook2), { id: r.id, approve: true, note: "" })).rejects.toThrow(ForbiddenError);
    await cancelTimeOff(await ctxFor(cook), r.id);
    expect((await db.timeOffRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("cancelled");
  });

  it("approving re-checks published future shifts and raises a SCHEDULE_CONFLICT (§6.4)", async () => {
    const s = await publishedShift(cook, kitchen, 20);
    const r = await requestTimeOff(await ctxFor(cook), { type: "vacation", allDay: true, startDate: day(20), endDate: day(20), reason: "" });
    const res = await reviewTimeOff(await ctxFor(mgr), { id: r.id, approve: true, note: "" });
    expect(res.conflicts).toBe(1);
    const conflicts = await openConflicts(await ctxFor(mgr));
    const c = conflicts.find((x) => x.shift.id === s.id);
    expect(c?.conflict.reason).toBe("Approved time off covers this shift");
    await resolveConflict(await ctxFor(mgr), { id: c!.conflict.id, action: "make_open" });
    expect((await db.shift.findUniqueOrThrow({ where: { id: s.id } })).membershipId).toBeNull();
    expect((await openConflicts(await ctxFor(mgr))).some((x) => x.shift.id === s.id)).toBe(false);
  });

  it("self-approval: allowed by setting and audited; the rules still apply; off → refused", async () => {
    await setRules({ allowSelfTimeOffApproval: true });
    const own = await requestTimeOff(await ctxFor(mgr), { type: "vacation", allDay: true, startDate: day(50), endDate: day(50), reason: "" });
    await reviewTimeOff(await ctxFor(mgr), { id: own.id, approve: true, note: "" });
    expect(await db.auditLog.count({ where: { businessId: A.business.id, action: "SELF_APPROVED", targetId: own.id } })).toBe(1);

    // A blackout added after submission still blocks the (self-)approval.
    const later = await requestTimeOff(await ctxFor(mgr), { type: "vacation", allDay: true, startDate: day(60), endDate: day(60), reason: "" });
    await createBlackout(await ctxFor(A.owner.id), { startDate: day(60), endDate: day(60), locationId: null, reason: "Inventory day" });
    await expect(reviewTimeOff(await ctxFor(mgr), { id: later.id, approve: true, note: "" })).rejects.toThrow("Inventory day");

    await setRules({ allowSelfTimeOffApproval: false });
    const third = await requestTimeOff(await ctxFor(mgr), { type: "vacation", allDay: true, startDate: day(70), endDate: day(70), reason: "" });
    await expect(reviewTimeOff(await ctxFor(mgr), { id: third.id, approve: true, note: "" })).rejects.toThrow("Self-approval is turned off");
    // …and it's flagged Escalated once past escalateAfterHours.
    await db.timeOffRequest.update({ where: { id: third.id }, data: { createdAt: new Date(Date.now() - 73 * 3600_000) } });
    const queue = await timeOffToReview(await ctxFor(A.owner.id));
    expect(queue.find((q) => q.id === third.id)?.escalated).toBe(true);
    await setRules({ allowSelfTimeOffApproval: true });
  });
});

describe("availability (§6.2)", () => {
  it("auto-approves when no approval is needed and flags conflicts with published shifts", async () => {
    await setRules({ availabilityNeedsApproval: false });
    const s = await publishedShift(cook2, kitchen, 9);
    const weekday = new Date(`${day(9)}T12:00:00Z`).getUTCDay();
    const days = Array.from({ length: 7 }, (_, i) => (i === weekday ? { kind: "unavailable" as const } : { kind: "all_day" as const }));
    const r = await submitAvailability(await ctxFor(cook2), { effectiveFrom: today(), days });
    expect(r.approved).toBe(true);
    expect((await openConflicts(await ctxFor(mgr))).some((c) => c.shift.id === s.id)).toBe(true);
  });

  it("needs approval when the business says so", async () => {
    await setRules({ availabilityNeedsApproval: true });
    const days = Array.from({ length: 7 }, () => ({ kind: "between" as const, start: "09:00", end: "17:00" }));
    const r = await submitAvailability(await ctxFor(bartender), { effectiveFrom: day(1), days });
    expect(r.approved).toBe(false);
    await expect(reviewAvailability(await ctxFor(cook), { requestId: r.requestId, approve: true, note: "" })).rejects.toThrow(ForbiddenError);
    await reviewAvailability(await ctxFor(mgr), { requestId: r.requestId, approve: true, note: "" });
    expect(await db.availabilityRule.count({ where: { requestId: r.requestId, status: "approved" } })).toBe(7);
  });
});

describe("drop / pickup (§6.3)", () => {
  it("a cook can't pick up a bar shift — eligibility blocks trades", async () => {
    await setRules({ pickupNeedsApproval: false });
    const s = await publishedShift(null, bar, 5);
    await expect(claimShift(await ctxFor(cook), s.id)).rejects.toThrow("don't work that position");
    expect((await availableShifts(await ctxFor(cook))).some((a) => a.shift.id === s.id)).toBe(false);
    expect((await availableShifts(await ctxFor(bartender))).some((a) => a.shift.id === s.id)).toBe(true);
  });

  it("ten simultaneous claims on an open shift: exactly one winner (no approval needed)", async () => {
    await setRules({ pickupNeedsApproval: false });
    const s = await publishedShift(null, kitchen, 6);
    const ctxs = await Promise.all(claimers.map((c) => ctxFor(c)));
    const results = await Promise.allSettled(ctxs.map((c) => claimShift(c, s.id)));
    const winners = results.filter((r) => r.status === "fulfilled");
    const losers = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(9);
    for (const l of losers) expect((l.reason as Error).message).toBe(ALREADY_TAKEN);
    const after = await db.shift.findUniqueOrThrow({ where: { id: s.id } });
    expect(claimers).toContain(after.membershipId);
    expect(await db.shiftTradeRequest.count({ where: { shiftId: s.id, type: "pickup", status: { in: ["pending", "approved"] } } })).toBe(1);
  });

  it("ten simultaneous claims when approval is needed: exactly one pending claim (partial unique index)", async () => {
    await setRules({ pickupNeedsApproval: true });
    const s = await publishedShift(null, kitchen, 7);
    const ctxs = await Promise.all(claimers.map((c) => ctxFor(c)));
    const results = await Promise.allSettled(ctxs.map((c) => claimShift(c, s.id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const l of results.filter((r) => r.status === "rejected") as PromiseRejectedResult[]) expect((l.reason as Error).message).toBe(ALREADY_TAKEN);
    const claim = await db.shiftTradeRequest.findFirstOrThrow({ where: { shiftId: s.id, type: "pickup", status: "pending" } });
    // Still open until approved.
    expect((await db.shift.findUniqueOrThrow({ where: { id: s.id } })).membershipId).toBeNull();
    await reviewTrade(await ctxFor(mgr), { id: claim.id, approve: true, note: "" });
    expect((await db.shift.findUniqueOrThrow({ where: { id: s.id } })).membershipId).toBe(claim.toMembershipId);
  });

  it("drop needing approval: the dropper stays responsible; a claim hands over on approval", async () => {
    await setRules({ dropNeedsApproval: true, pickupNeedsApproval: true });
    const s = await publishedShift(cook, kitchen, 8);
    await dropShift(await ctxFor(cook), s.id);
    expect((await db.shift.findUniqueOrThrow({ where: { id: s.id } })).membershipId).toBe(cook);
    expect((await availableShifts(await ctxFor(cook2))).find((a) => a.shift.id === s.id)?.offered).toBe(true);
    const claim = await claimShift(await ctxFor(cook2), s.id);
    expect(claim.status).toBe("pending");
    expect((await db.shift.findUniqueOrThrow({ where: { id: s.id } })).membershipId).toBe(cook);
    await expect(reviewTrade(await ctxFor(cook), { id: claim.id, approve: true, note: "" })).rejects.toThrow(ForbiddenError);
    await reviewTrade(await ctxFor(mgr), { id: claim.id, approve: true, note: "" });
    expect((await db.shift.findUniqueOrThrow({ where: { id: s.id } })).membershipId).toBe(cook2);
    expect((await db.shiftTradeRequest.findFirstOrThrow({ where: { shiftId: s.id, type: "drop" } })).status).toBe("approved");
  });

  it("a shift can be claimed again in a later round (after it changes hands)", async () => {
    await setRules({ dropNeedsApproval: false, pickupNeedsApproval: false });
    const s = await publishedShift(null, kitchen, 11);
    await claimShift(await ctxFor(claimers[0]), s.id);
    await dropShift(await ctxFor(claimers[0]), s.id); // no approval → open again
    expect((await db.shift.findUniqueOrThrow({ where: { id: s.id } })).membershipId).toBeNull();
    await claimShift(await ctxFor(claimers[1]), s.id);
    expect((await db.shift.findUniqueOrThrow({ where: { id: s.id } })).membershipId).toBe(claimers[1]);
  });

  it("can't claim a shift that overlaps one you already have", async () => {
    await setRules({ pickupNeedsApproval: false });
    await publishedShift(claimers[2], kitchen, 12, "16:00", "20:00");
    const s = await publishedShift(null, kitchen, 12, "18:00", "23:00");
    await expect(claimShift(await ctxFor(claimers[2]), s.id)).rejects.toThrow("overlaps");
  });
});

describe("swap (§6.3)", () => {
  it("a cook and a bartender can't swap (eligibility, both ways)", async () => {
    const mine = await publishedShift(cook, kitchen, 13);
    const theirs = await publishedShift(bartender, bar, 14);
    await expect(proposeSwap(await ctxFor(cook), { shiftId: mine.id, swapShiftId: theirs.id })).rejects.toThrow(UserError);
    expect((await swapCandidates(await ctxFor(cook), mine.id)).some((s) => s.id === theirs.id)).toBe(false);
  });

  it("propose → coworker accepts → manager approves → shifts exchanged", async () => {
    await setRules({ swapNeedsApproval: true });
    const mine = await publishedShift(cook, kitchen, 15);
    const theirs = await publishedShift(cook2, kitchen, 16);
    expect((await swapCandidates(await ctxFor(cook), mine.id)).some((s) => s.id === theirs.id)).toBe(true);
    const req = await proposeSwap(await ctxFor(cook), { shiftId: mine.id, swapShiftId: theirs.id });
    await expect(reviewTrade(await ctxFor(mgr), { id: req.id, approve: true, note: "" })).rejects.toThrow("hasn't accepted");
    await respondToSwap(await ctxFor(cook2), { id: req.id, accept: true });
    expect((await db.shift.findUniqueOrThrow({ where: { id: mine.id } })).membershipId).toBe(cook); // still responsible
    await reviewTrade(await ctxFor(mgr), { id: req.id, approve: true, note: "" });
    expect((await db.shift.findUniqueOrThrow({ where: { id: mine.id } })).membershipId).toBe(cook2);
    expect((await db.shift.findUniqueOrThrow({ where: { id: theirs.id } })).membershipId).toBe(cook);
  });

  it("without approval, acceptance completes the swap", async () => {
    await setRules({ swapNeedsApproval: false });
    const mine = await publishedShift(cook, kitchen, 17);
    const theirs = await publishedShift(cook2, kitchen, 18);
    const req = await proposeSwap(await ctxFor(cook), { shiftId: mine.id, swapShiftId: theirs.id });
    const r = await respondToSwap(await ctxFor(cook2), { id: req.id, accept: true });
    expect(r.completed).toBe(true);
    expect((await db.shift.findUniqueOrThrow({ where: { id: theirs.id } })).membershipId).toBe(cook);
  });
});
