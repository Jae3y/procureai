import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { openPayIn } from "@/lib/domain/payin";
import { reconcilePayout } from "@/lib/domain/payouts";
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
});
