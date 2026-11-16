import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { CAC_REUSE_DAYS } from "@/lib/domain/verification";
import { resetEnvCache } from "@/lib/env";
import { FlowDriver } from "../helpers/flow-driver";
import { useKoraDouble } from "../helpers/kora";

/** A company found on CAC recently is not looked up again; its bank account still is, every time. */

const double = useKoraDouble();

beforeEach(() => {
  process.env.DEMO_MODE = "false";
  process.env.ADMIN_TOKEN = "integration-admin-token-0123456789";
  resetEnvCache();
});

async function verifiedPurchase(d: FlowDriver) {
  const requestId = await d.createAndQuote();
  const view = await d.verifyAndRecommend(requestId);
  return { requestId, view };
}

describe("reusing a recent CAC check", () => {
  it("skips the CAC lookup for a company found recently, but re-checks the bank account and any 'not found'", async () => {
    const d = new FlowDriver();
    await d.seedDirectory();
    const first = await verifiedPurchase(d);
    const cacAfterFirst = double.callsTo("POST /identities/ng/cac");
    const bankAfterFirst = double.callsTo("POST /identities/ng/bank-account-basic");
    // Vendors A (not found) and B. C shares B's registration number (Kora's sandbox test company), so it reuses B's fresh result.
    expect(cacAfterFirst).toBe(2);

    const second = await verifiedPurchase(d);
    // Only Vendor A, whose company wasn't found, is looked up again.
    expect(double.callsTo("POST /identities/ng/cac") - cacAfterFirst).toBe(1);
    // Bank accounts are always checked again (B and C).
    expect(double.callsTo("POST /identities/ng/bank-account-basic") - bankAfterFirst).toBe(2);
    // Same verdicts as the first time.
    const verdicts = (v: typeof first.view) => Object.fromEntries(v.checks.map((c) => [c.label, c.verdict]));
    expect(verdicts(second.view)).toEqual(verdicts(first.view));

    const reused = await db().vendorVerification.findMany({ where: { vendor: { requestId: second.requestId }, verdict: "VERIFIED" } });
    expect(reused.length).toBe(2);
    for (const r of reused) expect(r.rawCac).toMatchObject({ reusedFrom: expect.any(String) });
  });

  it(`looks the company up again once the last real check is over ${CAC_REUSE_DAYS} days old`, async () => {
    const d = new FlowDriver();
    await d.seedDirectory();
    await verifiedPurchase(d);
    await db().$executeRaw`ALTER TABLE "VendorVerification" DISABLE TRIGGER "I4_verification_append_only"`;
    await db().$executeRaw`UPDATE "VendorVerification" SET "checkedAt" = now() - make_interval(days => ${CAC_REUSE_DAYS + 1})`;
    await db().$executeRaw`ALTER TABLE "VendorVerification" ENABLE TRIGGER "I4_verification_append_only"`;
    const before = double.callsTo("POST /identities/ng/cac");
    await verifiedPurchase(d);
    expect(double.callsTo("POST /identities/ng/cac") - before).toBe(2); // A, and B again (C reuses B's new result)
  });
});
