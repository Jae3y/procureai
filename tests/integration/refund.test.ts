import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { openPayIn } from "@/lib/domain/payin";
import { reconcilePayout } from "@/lib/domain/payouts";
import { revealHandoverCode, submitHandoverCode } from "@/lib/domain/handover";
import { disputeOrder, reconcileRefund, refundOrder } from "@/lib/domain/refunds";
import { receiveKoraWebhook } from "@/lib/webhooks/receive";
import { processOutboxBatch } from "@/lib/worker/outbox";
import { makeOrderFixture } from "../helpers/factories";
import { useKoraDouble } from "../helpers/kora";
import { expectMoneyInvariants, heldBalance } from "../helpers/ledger";

const double = useKoraDouble();
const buyer = { type: "USER" as const, id: "buyer-test" };
const admin = { type: "ADMIN" as const, id: "admin" };

/** ₦840,000 order, paid in full, Stage 1 (₦252,000) confirmed by Kora: ₦588,000 is still held. */
async function stageOnePaidOrder() {
  const f = await makeOrderFixture({ amountKobo: 84_000_000n });
  const payIn = await openPayIn(f.order.id, 84_000_000n, "initial", buyer);
  double.pay(payIn.reference, 84_000_000n);
  const { rawBody, signature } = double.chargeWebhook(payIn.reference);
  await receiveKoraWebhook({ rawBody, signatureHeader: signature });
  await processOutboxBatch();
  for (const p of await db().payout.findMany({ where: { orderId: f.order.id, status: "PENDING" } })) await reconcilePayout(p.reference, admin);
  return { ...f, payIn };
}

describe("refund of a disputed order", () => {
  it("returns only what is still held, through Kora, and ends REFUNDED with every naira accounted for", async () => {
    const { order, payIn } = await stageOnePaidOrder();
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("STAGE_1_PAID");
    expect(await heldBalance(order.id)).toBe(58_800_000n);

    await disputeOrder(order.id, "Wrong colour delivered", buyer);
    const r = await refundOrder(order.id, admin);
    expect(r).toEqual({ reference: `RF-${order.id}-1`, status: "processing" });
    const sent = double.calls.find((c) => c.path === "/refunds/initiate")?.body as Record<string, unknown>;
    expect(sent).toMatchObject({ reference: r.reference, payment_reference: payIn.reference, amount: 588000 });

    // Kora answered "processing"; the re-query settles it.
    await reconcileRefund(r.reference, admin);
    const after = await db().order.findUniqueOrThrow({ where: { id: order.id }, include: { refunds: true } });
    expect(after.status).toBe("REFUNDED");
    expect(after.refunds[0]).toMatchObject({ status: "SUCCESS", amountKobo: 58_800_000n });
    expect(await heldBalance(order.id)).toBe(0n);
    await expectMoneyInvariants(order.id);
  });

  it("refuses an order that is not disputed, without calling Kora", async () => {
    const { order } = await stageOnePaidOrder();
    await expect(refundOrder(order.id, admin)).rejects.toMatchObject({ code: "not_disputed" });
    expect(double.callsTo("POST /refunds/initiate")).toBe(0);
  });

  it("never sends a second refund while the first is still on its way", async () => {
    const { order } = await stageOnePaidOrder();
    await disputeOrder(order.id, "Never arrived", buyer);
    await refundOrder(order.id, admin); // Kora answers "processing"
    await expect(refundOrder(order.id, admin)).rejects.toMatchObject({ code: "refund_in_progress" });
    expect(double.callsTo("POST /refunds/initiate")).toBe(1);
  });

  it("refunds an order paid in several transfers in parts, each against its own payment", async () => {
    // ₦1,260,000: one-time accounts take ₦1,000,000 at most, so it's paid as ₦1,000,000 + ₦260,000.
    const f = await makeOrderFixture({ amountKobo: 126_000_000n, stage1Bp: 1000 }); // a new seller: 10% first, so ₦1,134,000 stays held
    await openPayIn(f.order.id, 126_000_000n, "initial", buyer);
    for (let seq = 1; seq <= 3; seq++) {
      const p = await db().payIn.findFirst({ where: { orderId: f.order.id, sequence: seq } });
      if (!p) break;
      double.pay(p.reference, p.amountRequestedKobo);
      const { rawBody, signature } = double.chargeWebhook(p.reference);
      await receiveKoraWebhook({ rawBody, signatureHeader: signature });
      await processOutboxBatch();
    }
    for (const p of await db().payout.findMany({ where: { orderId: f.order.id, status: "PENDING" } })) await reconcilePayout(p.reference, admin);
    const held = await heldBalance(f.order.id);
    expect(held > 100_000_000n).toBe(true); // more than the biggest single payment: one refund can't carry it

    await disputeOrder(f.order.id, "Wrong item", buyer);
    const r = await refundOrder(f.order.id, admin);
    const refunds = await db().refund.findMany({ where: { orderId: f.order.id }, orderBy: { reference: "asc" } });
    expect(refunds).toHaveLength(2);
    expect(r.reference).toBe(refunds.map((x) => x.reference).join(", "));
    expect(new Set(refunds.map((x) => x.paymentReference)).size).toBe(2);
    expect(refunds.reduce((a, x) => a + x.amountKobo, 0n)).toBe(held);

    // One part settles: still DISPUTED. Both settle: REFUNDED, nothing held.
    await reconcileRefund(refunds[0]?.reference ?? "", admin);
    expect((await db().order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("DISPUTED");
    await reconcileRefund(refunds[1]?.reference ?? "", admin);
    expect((await db().order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("REFUNDED");
    expect(await heldBalance(f.order.id)).toBe(0n);
    await expectMoneyInvariants(f.order.id);
  });

  it("the database refuses refunds that add up to more than a payment brought in, whatever the code does", async () => {
    const { order, payIn } = await stageOnePaidOrder();
    const row = (n: number, amountKobo: bigint) => ({ orderId: order.id, provider: "kora", paymentReference: payIn.reference, reference: `RF-${order.id}-x${n}`, amountKobo, reason: "test", status: "FAILED" as const, koraResponse: {} });
    await expect(db().refund.create({ data: { ...row(1, 84_000_001n), status: "PENDING", koraResponse: undefined } })).rejects.toThrow(/I7: refunds against/);
    await expect(db().refund.create({ data: { ...row(2, 1n), paymentReference: "PA-not-this-order", status: "PENDING", koraResponse: undefined } })).rejects.toThrow(/I7: refund .* names a payment/);
  });

  it("returns what a buyer overpaid on a completed order, and the order stays complete", async () => {
    const f = await makeOrderFixture({ amountKobo: 84_000_000n });
    const payIn = await openPayIn(f.order.id, 84_000_000n, "initial", buyer);
    double.pay(payIn.reference, 84_000_000n + 1_500_000n); // ₦15,000 too much
    const { rawBody, signature } = double.chargeWebhook(payIn.reference);
    await receiveKoraWebhook({ rawBody, signatureHeader: signature });
    await processOutboxBatch();
    await moveToComplete(f.order.id);
    expect(await heldBalance(f.order.id)).toBe(1_500_000n);

    await expect(refundOrder(f.order.id, admin)).rejects.toMatchObject({ code: "not_disputed" }); // a dispute refund needs a dispute
    const r = await refundOrder(f.order.id, admin, "overpayment");
    await reconcileRefund(r.reference, admin);
    const o = await db().order.findUniqueOrThrow({ where: { id: f.order.id }, include: { refunds: true } });
    expect(o.status).toBe("COMPLETE");
    expect(o.refunds[0]).toMatchObject({ status: "SUCCESS", amountKobo: 1_500_000n, reason: "Overpayment returned to the buyer" });
    expect(await heldBalance(f.order.id)).toBe(0n);
    await expectMoneyInvariants(f.order.id);
  });
});

/** Stage 1 and Stage 2 confirmed by Kora, through the delivery code. */
async function moveToComplete(orderId: string) {
  for (const p of await db().payout.findMany({ where: { orderId, status: "PENDING" } })) await reconcilePayout(p.reference, admin);
  const code = revealHandoverCode(await db().order.findUniqueOrThrow({ where: { id: orderId } })) ?? "";
  expect(await submitHandoverCode(orderId, code, "vendor")).toEqual({ ok: true });
  for (const p of await db().payout.findMany({ where: { orderId, status: "PENDING" } })) await reconcilePayout(p.reference, admin);
  expect((await db().order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("COMPLETE");
}

