import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { moneySummary } from "@/lib/views/money-summary";
import { receiveKoraWebhook } from "@/lib/webhooks/receive";
import { processOutboxBatch } from "@/lib/worker/outbox";
import { FlowDriver } from "../helpers/flow-driver";
import { useKoraDouble } from "../helpers/kora";
import { expectMoneyInvariants, heldBalance, successfulPayouts } from "../helpers/ledger";

/**
 * ProcureAI's fees on a real purchase, end to end against the Kora double. For the ₦1,260,000 quote:
 *   buyer protection fee  4% of ₦100k + 2.5% of ₦900k + 1.5% of ₦260k = ₦30,400 → the buyer pays ₦1,290,400
 *   seller fee            2% of ₦1,260,000 = ₦25,200                       → the vendor receives ₦1,234,800
 * and at completion ₦55,600 moves from HELD to FEE, so nothing is held and nothing is unaccounted for.
 */

const double = useKoraDouble();

beforeEach(() => {
  process.env.DEMO_MODE = "false";
  process.env.ADMIN_TOKEN = "integration-admin-token-0123456789";
  process.env.FEES_ENABLED = "true";
  resetEnvCache();
});
afterEach(() => {
  process.env.FEES_ENABLED = "false";
  resetEnvCache();
});

async function deliver(w: { rawBody: string; signature: string }) {
  await receiveKoraWebhook({ rawBody: w.rawBody, signatureHeader: w.signature });
  await processOutboxBatch();
}

async function approvedOrder(d: FlowDriver) {
  await d.seedDirectory();
  const requestId = await d.createAndQuote();
  const view = await d.verifyAndRecommend(requestId);
  const { orderId } = await d.approveTwice(requestId);
  return { requestId, orderId, view };
}

async function payInFull(orderId: string) {
  for (let seq = 1; seq <= 5; seq++) {
    const p = await db().payIn.findFirst({ where: { orderId, sequence: seq } });
    if (!p) break;
    double.pay(p.reference, p.amountRequestedKobo);
    await deliver(double.chargeWebhook(p.reference));
  }
}

describe("ProcureAI's fees", () => {
  it("are shown before approval, charged on top, taken from the payout, and kept at completion", async () => {
    const d = new FlowDriver();
    const { requestId, orderId, view } = await approvedOrder(d);
    expect(view.recommendation?.fees).toEqual({ buyerFee: "₦30,400", youPay: "₦1,290,400", plus: false });

    const order = await db().order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order).toMatchObject({ amountKobo: 126_000_000n, buyerFeeKobo: 3_040_000n, sellerFeeKobo: 2_520_000n });
    // The two one-time accounts ask for the quote plus the fee: ₦1,000,000 then ₦290,400.
    expect((await db().payIn.findFirstOrThrow({ where: { orderId, sequence: 1 } })).amountRequestedKobo).toBe(100_000_000n);

    await payInFull(orderId);
    const s1 = await db().payout.findFirstOrThrow({ where: { orderId, stage: "STAGE_1" } });
    expect(s1.amountKobo).toBe(12_348_000n); // 10% of ₦1,234,800 for a seller new to ProcureAI
    await deliver(double.transferWebhook(s1.reference, "success"));

    expect((await d.enterCode(orderId, requestId, await d.buyerCode(orderId))).status).toBe(200);
    const s2 = await db().payout.findFirstOrThrow({ where: { orderId, stage: "STAGE_2" } });
    expect(s2.amountKobo).toBe(111_132_000n);
    await deliver(double.transferWebhook(s2.reference, "success"));

    const done = await db().order.findUniqueOrThrow({ where: { id: orderId }, include: { payouts: true, refunds: true, ledger: true } });
    expect(done.status).toBe("COMPLETE");
    expect(done.amountAcceptedKobo).toBe(129_040_000n);
    expect(await successfulPayouts(orderId)).toBe(123_480_000n);
    expect(await heldBalance(orderId)).toBe(0n);
    expect(moneySummary(done)).toMatchObject({ paidIn: 129_040_000n, paidOut: 123_480_000n, fees: 5_560_000n, held: 0n, unaccounted: 0n });
    await expectMoneyInvariants(orderId);

    const o = await d.order(orderId);
    expect(o.fees).toEqual({ buyerFee: "₦30,400", sellerFee: "₦25,200", buyerPays: "₦1,290,400", sellerGets: "₦1,234,800" });
  });

  it("keeps only the fees: a buyer's overpayment stays held for a refund", async () => {
    const d = new FlowDriver();
    const { requestId, orderId } = await approvedOrder(d);
    const extra = 1_234_500n; // ₦12,345 paid on top of the last transfer
    for (let seq = 1; seq <= 5; seq++) {
      const p = await db().payIn.findFirst({ where: { orderId, sequence: seq } });
      if (!p) break;
      // Every account is paid exactly, except the last one, which gets the extra on top.
      const isLast = p.amountRequestedKobo < 100_000_000n;
      double.pay(p.reference, p.amountRequestedKobo + (isLast ? extra : 0n));
      await deliver(double.chargeWebhook(p.reference));
    }
    expect((await db().order.findUniqueOrThrow({ where: { id: orderId } })).amountAcceptedKobo).toBe(129_040_000n + extra);
    const s1 = await db().payout.findFirstOrThrow({ where: { orderId, stage: "STAGE_1" } });
    await deliver(double.transferWebhook(s1.reference, "success"));
    await d.enterCode(orderId, requestId, await d.buyerCode(orderId));
    const s2 = await db().payout.findFirstOrThrow({ where: { orderId, stage: "STAGE_2" } });
    await deliver(double.transferWebhook(s2.reference, "success"));

    const done = await db().order.findUniqueOrThrow({ where: { id: orderId }, include: { payouts: true, refunds: true, ledger: true } });
    expect(done.status).toBe("COMPLETE");
    const m = moneySummary(done);
    expect(m.fees).toBe(5_560_000n);
    expect(m.held).toBe(extra); // the overpayment, still held for a refund
    expect(m.unaccounted).toBe(0n);
    await expectMoneyInvariants(orderId);
  });

  it("can't be changed once the order is approved", async () => {
    const d = new FlowDriver();
    const { orderId } = await approvedOrder(d);
    await expect(db().order.update({ where: { id: orderId }, data: { buyerFeeKobo: 0n } })).rejects.toThrow(/fees are fixed at approval/);
  });

  it("are off unless switched on: the buyer pays the quote and the vendor receives all of it", async () => {
    process.env.FEES_ENABLED = "false";
    resetEnvCache();
    const d = new FlowDriver();
    const { orderId, view } = await approvedOrder(d);
    expect(view.recommendation?.fees).toBeNull();
    expect(await db().order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ buyerFeeKobo: 0n, sellerFeeKobo: 0n });
  });

  it("a founding seller pays no seller fee in their first six months", async () => {
    const d = new FlowDriver();
    await d.seedDirectory();
    await db().vendorContact.updateMany({ where: { registeredAt: { not: null }, isDemo: false }, data: { registeredAt: new Date() } });
    const contacts = await db().vendorContact.findMany({ where: { registeredAt: { not: null }, isDemo: false }, orderBy: { createdAt: "asc" } });
    for (const [i, c] of contacts.entries()) await db().vendorContact.update({ where: { id: c.id }, data: { foundingNumber: 900 + i } });
    const requestId = await d.createAndQuote();
    await d.verifyAndRecommend(requestId);
    const { orderId } = await d.approveTwice(requestId);
    expect(await db().order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ buyerFeeKobo: 3_040_000n, sellerFeeKobo: 0n });
  });
});
