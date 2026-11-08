import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, normalizeRecoveryCode, totpCode, verifyTotp } from "@/lib/auth/totp";

// RFC 6238 Appendix B: SHA-1 secret "12345678901234567890", 30-second steps. The RFC lists 8-digit
// codes; the 6-digit code is the last six of each.
const SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));
const VECTORS: Array<[number, string]> = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
];

describe("authenticator codes (RFC 6238)", () => {
  it("base32 round-trips", () => {
    expect(base32Decode(SECRET).toString("ascii")).toBe("12345678901234567890");
  });

  it.each(VECTORS)("at t=%i the code is %s", (t, code) => {
    expect(totpCode(SECRET, Math.floor(t / 30))).toBe(code);
  });

  it("accepts the code for now and one step either side, and nothing older", () => {
    const now = 1234567890 * 1000;
    const step = Math.floor(1234567890 / 30);
    expect(verifyTotp(SECRET, totpCode(SECRET, step), null, now)).toBe(step);
    expect(verifyTotp(SECRET, totpCode(SECRET, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(SECRET, totpCode(SECRET, step + 1), null, now)).toBe(step + 1);
    expect(verifyTotp(SECRET, totpCode(SECRET, step - 2), null, now)).toBeNull();
  });

  it("refuses a code from a step already used (no replay)", () => {
    const now = 1234567890 * 1000;
    const step = Math.floor(1234567890 / 30);
    expect(verifyTotp(SECRET, totpCode(SECRET, step), step, now)).toBeNull();
  });

  it("refuses anything that isn't six digits", () => {
    expect(verifyTotp(SECRET, "12345", null)).toBeNull();
    expect(verifyTotp(SECRET, "abcdef", null)).toBeNull();
  });

  it("reads recovery codes however they are typed", () => {
    expect(normalizeRecoveryCode(" ABCDE fghij ")).toBe("abcde-fghij");
  });
});
