import { describe, expect, it } from "vitest";
import { signSvix, verifySvix } from "@/lib/svix";

const secret = "whsec_" + btoa("0123456789abcdef0123456789abcdef");
const now = 1_760_000_000_000;
const ts = String(now / 1000);

describe("Resend/Svix webhook signature", () => {
  it("accepts a correctly signed payload", async () => {
    const sig = await signSvix(secret, "msg_1", ts, '{"a":1}');
    expect(await verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, '{"a":1}', now)).toBe(true);
  });
  it("accepts when one of several signatures matches", async () => {
    const sig = await signSvix(secret, "msg_1", ts, "{}");
    expect(await verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,bogus v1,${sig}` }, "{}", now)).toBe(true);
  });
  it("rejects a tampered body", async () => {
    const sig = await signSvix(secret, "msg_1", ts, '{"a":1}');
    expect(await verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, '{"a":2}', now)).toBe(false);
  });
  it("rejects a stale timestamp", async () => {
    const sig = await signSvix(secret, "msg_1", ts, "{}");
    expect(await verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, "{}", now + 10 * 60_000)).toBe(false);
  });
  it("rejects missing headers", async () => {
    expect(await verifySvix(secret, { id: null, timestamp: ts, signature: "v1,x" }, "{}", now)).toBe(false);
  });
});
