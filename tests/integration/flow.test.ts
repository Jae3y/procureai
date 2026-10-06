import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { receiveKoraWebhook } from "@/lib/webhooks/receive";
import { processOutboxBatch } from "@/lib/worker/outbox";
import { FlowDriver } from "../helpers/flow-driver";
import { useKoraDouble } from "../helpers/kora";
import { expectMoneyInvariants, heldBalance, ledgerNet } from "../helpers/ledger";

/**
 * P4: the whole purchase, headless, through the real route handlers:
 * request → invite → quotes → verify (Kora identity) → recommend → approve (double-submitted with one
 * Idempotency-Key) → pay → webhook → Stage 1 → delivery code → Stage 2 → done, ledger balanced.
 * tests/sandbox/flow.test.ts runs the same driver against the real Kora sandbox.
 */

const double = useKoraDouble();

beforeEach(() => {
  // Non-demo mode, so buyer ownership checks are enforced (demo mode treats everyone as admin).
  process.env.DEMO_MODE = "false";
  process.env.ADMIN_TOKEN = "integration-admin-token-0123456789";
  resetEnvCache();
});

async function deliver(w: { rawBody: string; signature: string }) {
  await receiveKoraWebhook({ rawBody: w.rawBody, signatureHeader: w.signature });
  await processOutboxBatch();
}

describe("P4 · the full flow, headless", () => {
  it("request → … → Stage 2, with Kora gating, holding and releasing the money", async () => {
    const d = new FlowDriver();
    await d.seedDirectory();
    const requestId = await d.createAndQuote();

    const view = await d.verifyAndRecommend(requestId);
    const byLabel = Object.fromEntries(view.checks.map((c) => [c.label, c]));
    expect(byLabel["Vendor A"]?.verdict).toBe("FAILED");
    expect(byLabel["Vendor A"]?.failureReason).toBe("Company registration could not be verified.");
    expect(byLabel["Vendor B"]?.verdict).toBe("VERIFIED");
    expect(byLabel["Vendor B"]?.ownerLine).toBe("Payout account belongs to a registered director.");
    expect(byLabel["Vendor C"]?.verdict).toBe("VERIFIED");
    expect(view.recommendation?.chosenLabel).toBe("Vendor B");
    expect(view.recommendation?.chosenTotal).toBe("₦1,260,000");
    expect(view.recommendation?.reasoning).toEqual([
      "Vendor A quoted the lowest price, but Kora could not find its company registration, so ProcureAI will not send it money.",
      "Vendor B is ₦90,000 cheaper than Vendor C, is registered and active, and its payout account belongs to one of its directors.",
    ]);

    // Approve, double-submitted with the same Idempotency-Key → one order, one account.
    const { orderId } = await d.approveTwice(requestId);
    expect(await db().order.count({ where: { requestId } })).toBe(1);
    expect(await db().payIn.count({ where: { orderId } })).toBe(1);
    expect(double.callsTo("POST /charges/bank-transfer")).toBe(1);

    let o = await d.order(orderId);
    expect(o.screen).toBe("pay");
    expect(o.pay.state).toBe("open");
    expect(o.pay.amountDue).toBe("₦1,260,000");
    expect(o.pay.accountNumber).toMatch(/^\d{3} \d{3} \d{4}$/);

    // The buyer pays; Kora's webhook arrives; Stage 1 is dispatched and confirmed.
    const payIn = await db().payIn.findFirstOrThrow({ where: { orderId } });
    double.pay(payIn.reference, 126_000_000n);
    await deliver(double.chargeWebhook(payIn.reference));
    const s1 = await db().payout.findFirstOrThrow({ where: { orderId, stage: "STAGE_1" } });
    expect(s1.amountKobo).toBe(37_800_000n);
    await deliver(double.transferWebhook(s1.reference, "success"));

    o = await d.order(orderId);
    expect(o.screen).toBe("track");
    expect(o.track.title).toBe("Stage 1 paid. Waiting for delivery.");
    expect(o.track.nodes.map((n) => n.state)).toEqual(["done", "held", "done", "pending", "pending", "pending"]);
    expect(o.track.held.amount).toBe("₦882,000");
    expect(o.track.code).toMatch(/^\d{3} \d{3}$/);
    expect(o.events.some((e) => e.name === "charge.success" && e.signature === "VERIFIED")).toBe(true);
    expect(o.events.some((e) => e.name === "identity.cac")).toBe(true);

    // A wrong code, then the buyer's code on the vendor's phone → Stage 2.
    const wrong = await d.enterCode(orderId, requestId, "000000" === (await d.buyerCode(orderId)) ? "111111" : "000000");
    expect(wrong.status).toBe(422);
    expect(wrong.body.attemptsLeft).toBe(4);
    const right = await d.enterCode(orderId, requestId, await d.buyerCode(orderId));
    expect(right.status).toBe(200);

    const s2 = await db().payout.findFirstOrThrow({ where: { orderId, stage: "STAGE_2" } });
    expect(s2.amountKobo).toBe(88_200_000n);
    await deliver(double.transferWebhook(s2.reference, "success"));

    o = await d.order(orderId);
    expect(o.status).toBe("COMPLETE");
    expect(o.track.title).toBe("Complete. Every naira accounted for.");
    expect(o.track.nodes.every((n) => n.state === "done")).toBe(true);
    expect(o.track.held).toEqual({ amount: "₦0", tone: "green" });
    expect(await ledgerNet(orderId)).toBe(0n);
    expect(await heldBalance(orderId)).toBe(0n);
    await expectMoneyInvariants(orderId);

    // Nobody else's session can see it.
    const stranger = new FlowDriver();
    expect((await stranger.call((await import("@/app/api/orders/[id]/route")).GET, `/api/orders/${orderId}`, { id: orderId }, { method: "GET" })).status).toBe(403);
  });

  it("an unverified vendor cannot be approved even if asked for directly", async () => {
    const d = new FlowDriver();
    await d.seedDirectory();
    const requestId = await d.createAndQuote();
    await d.verifyAndRecommend(requestId);
    const vendorA = await db().vendor.findFirstOrThrow({ where: { requestId, label: "Vendor A" }, include: { quote: true } });
    const { POST } = await import("@/app/api/requests/[id]/approve/route");
    const r = await d.call(POST, `/api/requests/${requestId}/approve`, { id: requestId }, { body: { quoteId: vendorA.quote?.id } });
    expect(r.status).toBe(409);
    expect((r.body.error as { message: string }).message).toBe("Vendor A is not verified by Kora, so ProcureAI won't send it money.");
    expect(await db().order.count()).toBe(0);
  });

  it("the Re-check button resolves a payment whose webhook never came", async () => {
    const d = new FlowDriver();
    await d.seedDirectory();
    const requestId = await d.createAndQuote();
    await d.verifyAndRecommend(requestId);
    const { orderId } = await d.approveTwice(requestId);
    const payIn = await db().payIn.findFirstOrThrow({ where: { orderId } });
    double.pay(payIn.reference, 126_000_000n);
    await d.recheck(orderId);
    expect((await d.order(orderId)).status).toBe("STAGE_1_PAID");
  });
});
