import { describe, expect, it } from "vitest";
import { isEligibleFor, type EligibilityCandidate, type EligibilityShift } from "@/lib/eligibility";
import { shiftInstants } from "@/lib/time";

const TZ = "America/Toronto";
const shift: EligibilityShift = {
  id: "bar-shift",
  positionId: "bar",
  locationId: "king",
  ...shiftInstants("2026-10-20", "18:00", "23:00", TZ),
  tz: TZ,
  requiresMinimumAge: 18,
};
const cook: EligibilityCandidate = {
  membershipId: "cook",
  active: true,
  positionIds: ["kitchen"],
  locationIds: ["king"],
  scopeAll: false,
  dob: "1995-01-01",
  shifts: [],
  approvedTimeOff: [],
};
const bartender: EligibilityCandidate = { ...cook, membershipId: "bartender", positionIds: ["bar"] };

describe("isEligibleFor (§6.0)", () => {
  it("a bartender at the location is eligible", () => expect(isEligibleFor(bartender, shift)).toEqual({ eligible: true, reasons: [] }));
  it("a cook can't be swapped onto the bar (the v1 bug)", () => expect(isEligibleFor(cook, shift).reasons).toEqual(["POSITION"]));
  it("wrong location, unless scope_all", () => {
    expect(isEligibleFor({ ...bartender, locationIds: ["queen"] }, shift).reasons).toEqual(["LOCATION"]);
    expect(isEligibleFor({ ...bartender, locationIds: [], scopeAll: true }, shift).eligible).toBe(true);
  });
  it("minimum age, on the shift date; unknown DOB fails a minimum-age shift", () => {
    expect(isEligibleFor({ ...bartender, dob: "2008-10-21" }, shift).reasons).toEqual(["AGE"]);
    expect(isEligibleFor({ ...bartender, dob: "2008-10-20" }, shift).eligible).toBe(true);
    expect(isEligibleFor({ ...bartender, dob: null }, shift).reasons).toEqual(["AGE"]);
    expect(isEligibleFor({ ...bartender, dob: null }, { ...shift, requiresMinimumAge: null }).eligible).toBe(true);
  });
  it("an overlapping shift blocks, unless it's the one being swapped away", () => {
    const own = { id: "mine", ...shiftInstants("2026-10-20", "17:00", "20:00", TZ) };
    expect(isEligibleFor({ ...bartender, shifts: [own] }, shift).reasons).toEqual(["OVERLAP"]);
    expect(isEligibleFor({ ...bartender, shifts: [own] }, shift, ["mine"]).eligible).toBe(true);
  });
  it("the shift itself never counts as an overlap", () => {
    expect(isEligibleFor({ ...bartender, shifts: [{ id: shift.id, startsAt: shift.startsAt, endsAt: shift.endsAt }] }, shift).eligible).toBe(true);
  });
  it("approved time off blocks", () => {
    expect(isEligibleFor({ ...bartender, approvedTimeOff: [{ startsAt: new Date("2026-10-20T04:00:00Z"), endsAt: new Date("2026-10-21T04:00:00Z") }] }, shift).reasons).toEqual(["TIME_OFF"]);
  });
  it("inactive people are never eligible", () => expect(isEligibleFor({ ...bartender, active: false }, shift).reasons).toEqual(["INACTIVE"]));
  it("a shift without a position accepts any position", () => expect(isEligibleFor(cook, { ...shift, positionId: null, requiresMinimumAge: null }).eligible).toBe(true));
});
