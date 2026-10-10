import { describe, expect, it } from "vitest";
import { extractRawDataSpan, hmacHex, signLikeKora, verifyKoraSignature } from "@/lib/kora/signature";

const SECRET = "sk_test_procureai_unit_tests_only";

/** Kora's documented "Pay-in (Cards, Bank Transfer, Mobile Money)" webhook (Kora webhook docs). */
const documented = {
  event: "charge.success",
  data: {
    fee: 10,
    amount: 1000,
    status: "success",
    currency: "KES",
    reference: "merchant-payment-referece-001",
    payment_method: "mobile_money",
    payment_reference: "merchant-payment-referece-001",
  },
};

describe("webhook signature — HMAC-SHA256 of the data object only", () => {
  it("accepts Kora's documented payload signed the way Kora's sample signs it", () => {
    const raw = JSON.stringify(documented);
    const sig = signLikeKora(documented.data, SECRET);
    expect(verifyKoraSignature(raw, sig, SECRET)).toEqual({ valid: true, method: "raw-span" });
  });

  it("rejects a tampered payload (amount changed after signing)", () => {
    const sig = signLikeKora(documented.data, SECRET);
    const tampered = JSON.stringify({ ...documented, data: { ...documented.data, amount: 1001 } });
    expect(verifyKoraSignature(tampered, sig, SECRET)).toEqual({ valid: false, reason: "mismatch" });
  });

  it("rejects a signature made with a different key", () => {
    const sig = signLikeKora(documented.data, "sk_test_someone_else");
    expect(verifyKoraSignature(JSON.stringify(documented), sig, SECRET).valid).toBe(false);
  });

  it("rejects a signature computed over the whole body instead of data", () => {
    const raw = JSON.stringify(documented);
    expect(verifyKoraSignature(raw, hmacHex(raw, SECRET), SECRET).valid).toBe(false);
  });

  it("does not let the event name be swapped under a valid data signature", () => {
    // The signature covers data only (Kora's design); the event type is cross-checked by re-querying
    // Kora before any money moves, so a swapped event name cannot move money on its own.
    const sig = signLikeKora(documented.data, SECRET);
    const swapped = JSON.stringify({ ...documented, event: "charge.failed" });
    expect(verifyKoraSignature(swapped, sig, SECRET).valid).toBe(true);
  });

  it("verifies the exact bytes when re-serialising would change them (150.00 → 150)", () => {
    const raw = '{"event":"transfer.success","data":{"fee":15,"amount":150.00,"status":"success","currency":"NGN","reference":"Z78EYMAUBQ5"}}';
    const span = '{"fee":15,"amount":150.00,"status":"success","currency":"NGN","reference":"Z78EYMAUBQ5"}';
    const sigOverBytes = hmacHex(span, SECRET);
    expect(verifyKoraSignature(raw, sigOverBytes, SECRET)).toEqual({ valid: true, method: "raw-span" });
    // ...and Kora's documented re-serialisation is still honoured when that is what was signed.
    const sigOverReserialized = hmacHex(JSON.stringify(JSON.parse(raw).data), SECRET);
    expect(verifyKoraSignature(raw, sigOverReserialized, SECRET)).toEqual({ valid: true, method: "reserialized" });
  });

  it("handles missing, malformed and upper-case headers", () => {
    const raw = JSON.stringify(documented);
    expect(verifyKoraSignature(raw, null, SECRET)).toEqual({ valid: false, reason: "missing-header" });
    expect(verifyKoraSignature(raw, "not-hex", SECRET)).toEqual({ valid: false, reason: "malformed-header" });
    expect(verifyKoraSignature(raw, signLikeKora(documented.data, SECRET).toUpperCase(), SECRET).valid).toBe(true);
  });

  it("rejects bodies with no data object", () => {
    expect(verifyKoraSignature('{"event":"x"}', "a".repeat(64), SECRET)).toEqual({ valid: false, reason: "no-data-object" });
    expect(verifyKoraSignature("not json", "a".repeat(64), SECRET)).toEqual({ valid: false, reason: "no-data-object" });
  });
});

describe("extractRawDataSpan", () => {
  it.each([
    ['{"event":"a","data":{"x":1}}', '{"x":1}'],
    ['{"data":{"x":1},"event":"a"}', '{"x":1}'],
    ['  {  "event" : "a" ,  "data" :  {"s":"}{\\"]","n":[1,{"d":2}]} }', '{"s":"}{\\"]","n":[1,{"d":2}]}'],
    ['{"meta":{"data":{"inner":1}},"data":{"outer":2}}', '{"outer":2}'],
    ['{"event":"a","data":null}', "null"],
  ])("%s → %s", (raw, span) => {
    expect(extractRawDataSpan(raw)).toBe(span);
  });

  it("returns null when there is no top-level data", () => {
    expect(extractRawDataSpan('{"event":"a"}')).toBeNull();
    expect(extractRawDataSpan("[1,2]")).toBeNull();
    expect(extractRawDataSpan('{"data":')).toBeNull();
  });
});
