import { describe, expect, it } from "vitest";
import { hmacSha256Hex, pinDigest, randomToken, sha256Hex, timingSafeEqualHex } from "@/lib/crypto";

describe("crypto (Web Crypto, portable)", () => {
  it("HMAC-SHA256 matches RFC 4231 test case 2", async () => {
    expect(await hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });
  it("SHA-256 matches the known digest of 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("PIN digests are scoped per membership", async () => {
    const a = await pinDigest("secret", "membership-a", "1234");
    const b = await pinDigest("secret", "membership-b", "1234");
    expect(a).not.toBe(b);
    expect(await pinDigest("secret", "membership-a", "1234")).toBe(a);
    expect(a).not.toContain("1234");
  });
  it("random tokens are URL-safe and unique", () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(t);
  });
  it("timingSafeEqualHex", () => {
    expect(timingSafeEqualHex("abcd", "abcd")).toBe(true);
    expect(timingSafeEqualHex("abcd", "abce")).toBe(false);
    expect(timingSafeEqualHex("abcd", "abc")).toBe(false);
  });
});
