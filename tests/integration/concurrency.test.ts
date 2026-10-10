import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { revealHandoverCode, submitHandoverCode } from "@/lib/domain/handover";
import { openPayIn, reconcileCharge } from "@/lib/domain/payin";
import { dispatchStage, reconcilePayout, retryPayout } from "@/lib/domain/payouts";
import { setSetting } from "@/lib/domain/settings";
import { receiveKoraWebhook } from "@/lib/webhooks/receive";
import { processOutboxBatch } from "@/lib/worker/outbox";
import { pollOnce } from "@/lib/worker/poller";
import { makeOrderFixture } from "../helpers/factories";
import { useKoraDouble } from "../helpers/kora";
import { expectMoneyInvariants } from "../helpers/ledger";

const double = useKoraDouble();
const user = { type: "USER" as const, id: "buyer" };

async function paidButUnapplied() {
  const f = await makeOrderFixture();
  const payIn = await openPayIn(f.order.id, f.order.amountKobo, "initial", user);
  double.pay(payIn.reference, f.order.amountKobo);
  // Old enough that the poller will also go after it.
  await db().$executeRaw`UPDATE "PayIn" SET "createdAt" = now() - interval '1 minute' WHERE "id" = ${payIn.id}`;
  return { ...f, payIn };
}

describe("webhook + poller + manual Re-check racing on one charge", () => {
  it.each([1, 2, 3, 4, 5])("round %i: one HELD transition, one credit, one Stage 1 payout", async () => {
    const { order, payIn } = await paidButUnapplied();
    const { rawBody, signature } = double.chargeWebhook(payIn.reference);
    await receiveKoraWebhook({ rawBody, signatureHeader: signature });

    const results = await Promise.allSettled([
      processOutboxBatch(),
      pollOnce(),
      reconcileCharge(payIn.reference, { type: "USER", id: "recheck-button" }),
      reconcileCharge(payIn.reference, { type: "USER", id: "recheck-button-double-click" }),
    ]);
    for (const r of results) expect(r.status).toBe("fulfilled");

    expect(await db().orderTransition.count({ where: { orderId: order.id, toState: "HELD" } })).toBe(1);
    expect(await db().orderTransition.count({ where: { orderId: order.id, toState: "STAGE_1_PAID" } })).toBe(1);
    expect(await db().ledgerEntry.count({ where: { orderId: order.id, sourceType: "PAYIN" } })).toBe(2);
    expect(await db().payout.count({ where: { orderId: order.id } })).toBe(1);
    expect(double.callsTo("POST /transactions/disburse")).toBe(1);
    const o = await db().order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.amountAcceptedKobo).toBe(order.amountKobo);
    expect(o.status).toBe("STAGE_1_PAID");
    await expectMoneyInvariants(order.id);
  });

  it("the same outcome whichever path arrives first", async () => {
    const orders = [];
    for (const first of ["webhook", "poller", "recheck"] as const) {
      const { order, payIn } = await paidButUnapplied();
      const { rawBody, signature } = double.chargeWebhook(payIn.reference);
      const run = {
        webhook: async () => {
          await receiveKoraWebhook({ rawBody, signatureHeader: signature });
          await processOutboxBatch();
        },
        poller: async () => {
          await pollOnce();
        },
        recheck: async () => {
          await reconcileCharge(payIn.reference, user);
        },
      };
      await run[first]();
      for (const other of (["webhook", "poller", "recheck"] as const).filter((x) => x !== first)) await run[other]();
      const o = await db().order.findUniqueOrThrow({ where: { id: order.id }, include: { payouts: true, ledger: true } });
      orders.push({ status: o.status, accepted: o.amountAcceptedKobo, payouts: o.payouts.length, ledger: o.ledger.length });
    }
    expect(orders[0]).toEqual(orders[1]);
    expect(orders[1]).toEqual(orders[2]);
  });
});

describe("racing money actions", () => {
  it("five simultaneous Stage 1 dispatches send exactly one payout", async () => {
    const { order, payIn } = await paidButUnapplied();
    double.availableKobo = 1_000_000_000n;
    await db().$executeRaw`UPDATE "PayIn" SET "createdAt" = now() WHERE "id" = ${payIn.id}`;
    // Apply the charge without the automatic follow-up, then race the dispatches.
    const { applyChargeSnapshot } = await import("@/lib/domain/payin");
    await applyChargeSnapshot(
      payIn.reference,
      { status: "success", amountKobo: order.amountKobo, paidKobo: order.amountKobo, acceptedKobo: order.amountKobo, feeKobo: null, paymentEvent: null, message: null },
      { test: true },
      user,
    );
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => dispatchStage(order.id, "STAGE_1", user)));
    expect(results.filter((r) => r.kind === "sent")).toHaveLength(1);
    expect(await db().payout.count({ where: { orderId: order.id } })).toBe(1);
    expect(double.callsTo("POST /transactions/disburse")).toBe(1);
  });

  it("the correct code entered three times at once releases Stage 2 once", async () => {
    const { order, payIn } = await paidButUnapplied();
    await reconcileCharge(payIn.reference, user);
    const s1 = await db().payout.findFirstOrThrow({ where: { orderId: order.id } });
    await reconcilePayout(s1.reference, { type: "POLLER", id: "t" });
    const code = revealHandoverCode(await db().order.findUniqueOrThrow({ where: { id: order.id } })) ?? "";
    const results = await Promise.allSettled([1, 2, 3].map(() => submitHandoverCode(order.id, code, "vendor")));
    // A double tap is the same success for the vendor, but only the first one sends money.
    const values = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    expect(values.filter((v) => v.ok)).toHaveLength(3);
    expect(values.filter((v) => v.ok && !("repeat" in v && v.repeat))).toHaveLength(1);
    expect(await db().payout.count({ where: { orderId: order.id, stage: "STAGE_2" } })).toBe(1);
    expect(await db().orderTransition.count({ where: { orderId: order.id, toState: "CODE_VERIFIED" } })).toBe(1);
  });

  it("three simultaneous retries create one new payout", async () => {
    const { order, payIn } = await paidButUnapplied();
    await setSetting("payoutRoute", "SANDBOX_FAIL_035");
    await reconcileCharge(payIn.reference, user);
    const s1 = await db().payout.findFirstOrThrow({ where: { orderId: order.id } });
    await reconcilePayout(s1.reference, { type: "POLLER", id: "t" });
    await setSetting("payoutRoute", "VERIFIED_ACCOUNT");
    const results = await Promise.allSettled([1, 2, 3].map(() => retryPayout(order.id, user)));
    const sent = results.filter((r) => r.status === "fulfilled" && r.value.kind === "sent");
    expect(sent).toHaveLength(1);
    expect(await db().payout.count({ where: { orderId: order.id, retryOfId: s1.id } })).toBe(1);
    await expectMoneyInvariants(order.id);
  });
});
