import { describe, expect, it } from "vitest";
import { scheduledWages } from "@/server/services/schedule";
import { buildIcs, escapeText, foldLine } from "@/lib/ics";
import { shiftInstants } from "@/lib/time";

const TZ = "America/Toronto";
const days = ["2026-10-19", "2026-10-20"];

describe("Scheduled wages (§5.3)", () => {
  it("hours after planned breaks × the wage in force on the day; salaried excluded; missing wages counted", () => {
    const shifts = [
      { membershipId: "a", ...shiftInstants("2026-10-19", "09:00", "17:30", TZ), breakMinutes: 30, positionId: null, tz: TZ }, // 8h
      { membershipId: "a", ...shiftInstants("2026-10-20", "09:00", "13:00", TZ), breakMinutes: 0, positionId: "bar", tz: TZ }, // 4h @ bar
      { membershipId: "s", ...shiftInstants("2026-10-20", "09:00", "17:00", TZ), breakMinutes: 0, positionId: null, tz: TZ }, // salaried
      { membershipId: "x", ...shiftInstants("2026-10-20", "09:00", "10:00", TZ), breakMinutes: 0, positionId: null, tz: TZ }, // no wage
      { membershipId: null, ...shiftInstants("2026-10-20", "09:00", "17:00", TZ), breakMinutes: 0, positionId: null, tz: TZ }, // open
    ];
    const wages = new Map([
      ["a", [
        { rateCents: 1800, type: "hourly" as const, positionId: null, effectiveFrom: "2026-01-01" },
        { rateCents: 2000, type: "hourly" as const, positionId: "bar", effectiveFrom: "2026-01-01" },
      ]],
      ["s", [{ rateCents: 5_000_000, type: "salary" as const, positionId: null, effectiveFrom: "2026-01-01" }]],
    ]);
    const r = scheduledWages(shifts, wages, days);
    expect(r.byDay).toEqual({ "2026-10-19": 14400, "2026-10-20": 8000 });
    expect(r.week).toBe(22400);
    expect(r.missingWage).toBe(1);
  });
});

describe("ics", () => {
  it("escapes text and folds long lines at 75 octets", () => {
    expect(escapeText("a,b;c\nd")).toBe(String.raw`a\,b\;c\nd`);
    const folded = foldLine("SUMMARY:" + "x".repeat(100));
    expect(folded.split("\r\n")[0]).toHaveLength(75);
    expect(folded.split("\r\n")[1].startsWith(" ")).toBe(true);
  });
  it("writes UTC events", () => {
    const ics = buildIcs("My shifts", [{ uid: "1@x", start: new Date("2026-10-20T21:00:00Z"), end: new Date("2026-10-21T03:00:00Z"), summary: "Server shift" }], new Date("2026-10-01T00:00:00Z"));
    expect(ics).toContain("DTSTART:20261020T210000Z");
    expect(ics).toContain("DTEND:20261021T030000Z");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
