import { describe, expect, it } from "vitest";
import { invitationDisplayStatus, needsAttention } from "@/server/services/invitations";
import { profileSchema, normalizePhone } from "@/server/services/profile";
import { payRulesSchema } from "@/server/services/pay-rules";
import { parseMoneyToCents } from "@/lib/money";

const now = new Date("2026-09-28T12:00:00Z");
const base = { status: "pending", deliveryStatus: "sent", expiresAt: new Date("2026-10-05T00:00:00Z"), sentAt: new Date("2026-09-28T00:00:00Z") };

describe("invitation status (§4.2)", () => {
  it("shows Invited while pending and delivered/sent", () => expect(invitationDisplayStatus(base, now)).toBe("invited"));
  it("never shows Invited when the email bounced", () =>
    expect(invitationDisplayStatus({ ...base, deliveryStatus: "bounced" }, now)).toBe("delivery_failed"));
  it("treats a complaint as delivery failed", () =>
    expect(invitationDisplayStatus({ ...base, deliveryStatus: "complained" }, now)).toBe("delivery_failed"));
  it("shows Expired past the expiry", () =>
    expect(invitationDisplayStatus({ ...base, expiresAt: new Date("2026-09-27T00:00:00Z") }, now)).toBe("expired"));
  it("accepted and revoked win", () => {
    expect(invitationDisplayStatus({ ...base, status: "accepted", deliveryStatus: "bounced" }, now)).toBe("accepted");
    expect(invitationDisplayStatus({ ...base, status: "revoked" }, now)).toBe("revoked");
  });
  it("needs attention when bounced, or unaccepted after 72 hours", () => {
    expect(needsAttention(base, now)).toBe(false);
    expect(needsAttention({ ...base, deliveryStatus: "bounced" }, now)).toBe(true);
    expect(needsAttention({ ...base, sentAt: new Date("2026-09-25T11:00:00Z") }, now)).toBe(true);
    expect(needsAttention({ ...base, sentAt: new Date("2026-09-25T13:00:00Z") }, now)).toBe(false);
  });
});

describe("profile validation", () => {
  const ok = {
    phone: "+1 (416) 555-0100",
    dateOfBirth: "1999-05-05",
    address: "1 Main St",
    emergencyContactName: "A",
    emergencyContactRelation: "B",
    emergencyContactPhone: "+44 20 7946 0958",
    pin: "1234",
    pinConfirm: "1234",
  };
  it("normalises phone numbers", () => {
    expect(normalizePhone("+1 (416) 555-0100")).toBe("+14165550100");
    expect(profileSchema.parse(ok).phone).toBe("+14165550100");
  });
  it("requires a country code", () => expect(profileSchema.safeParse({ ...ok, phone: "416 555 0100" }).success).toBe(false));
  it("requires matching 4–6 digit PINs", () => {
    expect(profileSchema.safeParse({ ...ok, pinConfirm: "1235" }).success).toBe(false);
    expect(profileSchema.safeParse({ ...ok, pin: "123", pinConfirm: "123" }).success).toBe(false);
    expect(profileSchema.safeParse({ ...ok, pin: "1234567", pinConfirm: "1234567" }).success).toBe(false);
    expect(profileSchema.safeParse({ ...ok, pin: "12a4", pinConfirm: "12a4" }).success).toBe(false);
    expect(profileSchema.safeParse({ ...ok, pin: "123456", pinConfirm: "123456" }).success).toBe(true);
  });
  it("rejects a future date of birth", () => expect(profileSchema.safeParse({ ...ok, dateOfBirth: "2999-01-01" }).success).toBe(false));
});

describe("pay rules validation", () => {
  const ok = {
    dailyThresholdHours: "8",
    dailyMultiplier: "1.5",
    dailySecondThresholdHours: "12",
    dailySecondMultiplier: "2",
    weeklyThresholdHours: "40",
    weeklyMultiplier: "1.5",
    minimumDailyPayHours: "",
    maxSplitShiftSpanHours: "",
    vacationPayPercent: "4",
    confirmed: true,
  };
  it("accepts a complete set and turns blanks into null", () => {
    const r = payRulesSchema.parse(ok);
    expect(r.dailyThresholdHours).toBe(8);
    expect(r.minimumDailyPayHours).toBeNull();
  });
  it("requires the owner's confirmation", () => expect(payRulesSchema.safeParse({ ...ok, confirmed: false }).success).toBe(false));
  it("requires thresholds and multipliers in pairs", () =>
    expect(payRulesSchema.safeParse({ ...ok, weeklyMultiplier: "" }).success).toBe(false));
  it("requires the second daily tier to be above the first", () =>
    expect(payRulesSchema.safeParse({ ...ok, dailySecondThresholdHours: "6" }).success).toBe(false));
});

describe("money parsing", () => {
  it.each([
    ["18.50", 1850],
    ["$1,234.5", 123450],
    ["20", 2000],
    ["", null],
  ])("%s → %s", (input, cents) => expect(parseMoneyToCents(input)).toBe(cents));
  it("rejects nonsense", () => {
    expect(parseMoneyToCents("abc")).toBeNaN();
    expect(parseMoneyToCents("1.234")).toBeNaN();
  });
});
