import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { approve } from "@/lib/domain/approve";
import { makeQuote, makeRequest, makeVendor } from "../helpers/factories";

/** A seller verified through their bank account, with no CAC record: what verifyByAccountOwner writes. */
async function bankVerified(vendorId: string, overrides: Record<string, unknown> = {}) {
  return db().vendorVerification.create({
    data: {
      vendorId,
      rcNumber: "",
      directors: [],
      bankCode: "058",
      accountNumber: "0123456789",
      accountReference: "VR-ACC-OWNER",
      accountName: "NGOZI OKAFOR",
      matchMethod: "ACCOUNT_OWNER",
      matchScoreBp: 10000,
      verdict: "VERIFIED",
      simulated: false,
      rawCac: { skipped: "no CAC registration number" },
      rawAccount: { status: true, data: { reference: "VR-ACC-OWNER" } },
      ...overrides,
    },
  });
}

describe("sellers without a CAC registration", () => {
  it("the database accepts a bank-verified seller, but still needs the bank's own confirmation", async () => {
    const request = await makeRequest();
    const vendor = await makeVendor(request.id, { rc: "" });
    await expect(bankVerified(vendor.id)).resolves.toMatchObject({ verdict: "VERIFIED", matchMethod: "ACCOUNT_OWNER" });

    const other = await makeVendor(request.id, { rc: "" });
    await expect(bankVerified(other.id, { accountName: null })).rejects.toThrow(/I8_verified_has_refs/);
    await expect(bankVerified(other.id, { accountReference: null })).rejects.toThrow(/I8_verified_has_refs/);
  });

  it("a registered business still needs its CAC record to be VERIFIED", async () => {
    const request = await makeRequest();
    const vendor = await makeVendor(request.id);
    await expect(bankVerified(vendor.id, { matchMethod: "COMPANY", rcNumber: "RC1" })).rejects.toThrow(/I8_verified_has_refs/);
  });

  it("a buyer can't approve a bank-verified seller above the per-purchase limit, and is told why kindly", async () => {
    const request = await makeRequest();
    const vendor = await makeVendor(request.id, { rc: "" });
    await bankVerified(vendor.id);
    const quote = await makeQuote(request.id, vendor.id, 60_000_000n); // ₦600,000
    await expect(approve(request.id, quote.id, { type: "USER", id: "test" })).rejects.toMatchObject({ code: "over_seller_limit" });
    expect(await db().order.count({ where: { requestId: request.id } })).toBe(0);
  });
});
