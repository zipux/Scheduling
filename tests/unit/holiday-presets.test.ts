import { describe, expect, it } from "vitest";
import { easterSunday, holidaysFor } from "@/lib/holiday-presets";

describe("holiday presets", () => {
  it("computes Easter", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
  });
  it("Ontario 2026", () => {
    const h = Object.fromEntries(holidaysFor("CA", "ON", 2026).map((x) => [x.name, x.date]));
    expect(h).toMatchObject({
      "New Year's Day": "2026-01-01",
      "Family Day": "2026-02-16",
      "Good Friday": "2026-04-03",
      "Victoria Day": "2026-05-18",
      "Canada Day": "2026-07-01",
      "Labour Day": "2026-09-07",
      Thanksgiving: "2026-10-12",
      "Christmas Day": "2026-12-25",
      "Boxing Day": "2026-12-26",
    });
    expect(Object.keys(h)).toHaveLength(9);
  });
  it("BC has BC Day, Truth and Reconciliation and Remembrance Day", () => {
    const h = Object.fromEntries(holidaysFor("CA", "BC", 2026).map((x) => [x.name, x.date]));
    expect(h["British Columbia Day"]).toBe("2026-08-03");
    expect(h["National Day for Truth and Reconciliation"]).toBe("2026-09-30");
    expect(h["Remembrance Day"]).toBe("2026-11-11");
  });
  it("Victoria Day is the Monday before May 25", () => {
    expect(holidaysFor("CA", "ON", 2027).find((x) => x.name === "Victoria Day")?.date).toBe("2027-05-24");
  });
  it("no preset outside Canada", () => expect(holidaysFor("US", "CA", 2026)).toEqual([]));
});
