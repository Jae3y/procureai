import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { revealHandoverCode, submitHandoverCode } from "@/lib/domain/handover";
import { openPayIn, reconcileCharge } from "@/lib/domain/payin";
import { dispatchStage, reconcilePayout, retryPayout } from "@/lib/domain/payouts";
import { setSetting } from "@/lib/domain/settings";
import { buildOrderView } from "@/lib/views/order-view";
import { receiveKoraWebhook } from "@/lib/webhooks/receive";
import { processOutboxBatch } from "@/lib/worker/outbox";
import { pollOnce } from "@/lib/worker/poller";
import { POST as webhookRoute } from "@/app/api/webhooks/kora/route";
import { makeOrderFixture } from "../helpers/factories";
import { useKoraDouble } from "../helpers/kora";
import { expectMoneyInvariants, heldBalance } from "../helpers/ledger";

const double = useKoraDouble();
const user = { type: "USER" as const, id: "buyer-test" };

/** ₦840,000 fits one Kora account (₦1,000,000 cap); larger orders are covered in "instalments". */
async function approvedOrder(amountKobo = 84_000_000n) {
  const f = await makeOrderFixture({ amountKobo });
  const payIn = await openPayIn(f.order.id, amountKobo, "initial", user);
  return { ...f, payIn };
}

async function deliver(rawBody: string, signature: string) {
  const r = await receiveKoraWebhook({ rawBody, signatureHeader: signature });
  await processOutboxBatch();
  return r;
}

async function status(orderId: string) {
  return (await db().order.findUniqueOrThrow({ where: { id: orderId } })).status;
}

describe("pay-in creation", () => {
  it("opens a one-time account and stores Kora's reference and raw response", async () => {
    const { order, payIn } = await approvedOrder();
    expect(payIn.reference).toBe(`PA-${order.id}`);
    expect(payIn.accountNumber).toMatch(/^\d{10}$/);
    expect(payIn.koraResponse).toMatchObject({ status: true, data: { reference: payIn.reference } });
    expect(await status(order.id)).toBe("AWAITING_PAYMENT");
    const sent = double.calls.find((c) => c.path === "/charges/bank-transfer")?.body as Record<string, unknown>;
    expect(sent).toMatchObject({ amount: 840000, currency: "NGN", merchant_bears_cost: true, metadata: { orderId: order.id } });
    expect(sent.notification_url).toBe("https://procureai.test/api/webhooks/kora");
  });

  it("re-opens with a fresh reference when Kora says the reference already exists", async () => {
    const f = await makeOrderFixture();
    double.next("POST /charges/bank-transfer", { status: 409, body: { status: false, code: "AA021", message: "duplicate payment reference", data: null } });
    const payIn = await openPayIn(f.order.id, f.order.amountKobo, "initial", user);
    expect(payIn.reference).toBe(`PA-${f.order.id}-R2`);
  });
});

describe("truthful amounts — the re-query beats the webhook", () => {
  it("credits Kora's queried amount_accepted, not the webhook amount (underpayment)", async () => {
    const { order, payIn } = await approvedOrder();
    double.pay(payIn.reference, 78_000_000n); // buyer sends ₦780,000 of ₦840,000
    const { rawBody, signature } = double.chargeWebhook(payIn.reference); // claims ₦840,000 (requested)
    expect(JSON.parse(rawBody).data.amount).toBe(840000);
    await deliver(rawBody, signature);

    const o = await db().order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("UNDERPAID");
    expect(o.amountAcceptedKobo).toBe(78_000_000n);
    expect(await heldBalance(order.id)).toBe(78_000_000n);
    const short = await db().orderEvent.findFirst({ where: { orderId: order.id, title: "₦60,000 short." } });
    expect(short?.detail).toBe("We received ₦780,000. Nothing goes to the vendor until the full amount is here.");
    // An account for the shortfall is opened automatically.
    const topUp = await db().payIn.findFirstOrThrow({ where: { orderId: order.id, sequence: 2 } });
    expect(topUp.amountRequestedKobo).toBe(6_000_000n);
    expect(await status(order.id)).toBe("UNDERPAID"); // still underpaid while the account for the rest is open
    await expectMoneyInvariants(order.id);

    // The buyer sends the rest; the order becomes HELD and Stage 1 goes out.
    double.pay(topUp.reference, 6_000_000n);
    const second = double.chargeWebhook(topUp.reference);
    await deliver(second.rawBody, second.signature);
    const after = await db().order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.amountAcceptedKobo).toBe(84_000_000n);
    expect(after.status).toBe("STAGE_1_PAID");
    await expectMoneyInvariants(order.id);
  });

  it("credits amount_paid when Kora omits amount_accepted", async () => {
    double.includeAccepted = false;
    const { order, payIn } = await approvedOrder();
    double.pay(payIn.reference, 84_000_000n);
    await reconcileCharge(payIn.reference, user);
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).amountAcceptedKobo).toBe(84_000_000n);
  });

  it("with Kora's 'return all' preference, an underpayment is returned and nothing is held", async () => {
    double.preference = "return_all";
    const { order, payIn } = await approvedOrder();
    double.pay(payIn.reference, 78_000_000n);
    await reconcileCharge(payIn.reference, user);
    expect(await status(order.id)).toBe("AWAITING_PAYMENT");
    expect(await heldBalance(order.id)).toBe(0n);
    expect(await db().orderEvent.count({ where: { orderId: order.id, title: "charge.underpaid" } })).toBe(1);
    // The poller asks again every few seconds; the buyer is told once.
    await reconcileCharge(payIn.reference, user);
    await reconcileCharge(payIn.reference, user);
    expect(await db().orderEvent.count({ where: { orderId: order.id, title: "charge.underpaid" } })).toBe(1);
  });

  it("accepts an overpayment, holds the excess and pays the vendor only the order total", async () => {
    const { order, payIn } = await approvedOrder();
    double.pay(payIn.reference, 90_000_000n);
    await reconcileCharge(payIn.reference, user);
    const o = await db().order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.amountAcceptedKobo).toBe(90_000_000n);
    expect(o.status).toBe("STAGE_1_PAID");
    const s1 = await db().payout.findFirstOrThrow({ where: { orderId: order.id, stage: "STAGE_1" } });
    expect(s1.amountKobo).toBe(25_200_000n);
    expect(await db().orderEvent.count({ where: { orderId: order.id, title: "Overpaid" } })).toBe(1);
  });
});

describe("instalments — Kora takes at most ₦1,000,000 per one-time account", () => {
  it("₦1,260,000: ₦1,000,000 then ₦260,000, never UNDERPAID, then HELD → Stage 1", async () => {
    const { order, payIn } = await approvedOrder(126_000_000n);
    expect(payIn).toMatchObject({ reference: `PA-${order.id}`, amountRequestedKobo: 100_000_000n, amountExpectedKobo: 100_000_000n });
    expect((double.calls.find((c) => c.path === "/charges/bank-transfer")?.body as { amount: number }).amount).toBe(1000000);

    double.pay(payIn.reference, 100_000_000n);
    const first = double.chargeWebhook(payIn.reference);
    await deliver(first.rawBody, first.signature);
    expect(await status(order.id)).toBe("AWAITING_PAYMENT");
    expect(await db().orderTransition.count({ where: { orderId: order.id, toState: "UNDERPAID" } })).toBe(0);
    const received = await db().orderEvent.findFirstOrThrow({ where: { orderId: order.id, title: "Transfer received" } });
    expect(received.detail).toBe("₦1,000,000 of ₦1,260,000 received. Kora takes up to ₦1,000,000 per account, so the next account is for ₦260,000.");
    expect(await db().payout.count({ where: { orderId: order.id } })).toBe(0);
    await expectMoneyInvariants(order.id);

    const second = await db().payIn.findFirstOrThrow({ where: { orderId: order.id, sequence: 2 } });
    expect(second).toMatchObject({ reference: `PA-${order.id}-P2`, amountRequestedKobo: 26_000_000n, status: "PROCESSING" });
    double.pay(second.reference, 26_000_000n);
    const w = double.chargeWebhook(second.reference);
    await deliver(w.rawBody, w.signature);

    const o = await db().order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.amountAcceptedKobo).toBe(126_000_000n);
    expect(o.status).toBe("STAGE_1_PAID");
    const credited = await db().ledgerEntry.aggregate({ where: { orderId: order.id, sourceType: "PAYIN", account: "HELD" }, _sum: { amountKobo: true } });
    expect(credited._sum.amountKobo).toBe(126_000_000n);
    expect((await db().payout.findFirstOrThrow({ where: { orderId: order.id, stage: "STAGE_1" } })).amountKobo).toBe(37_800_000n);
    await expectMoneyInvariants(order.id);
  });

  it("₦2,500,000 needs three accounts: ₦1,000,000, ₦1,000,000, ₦500,000", async () => {
    const { order, payIn } = await approvedOrder(250_000_000n);
    double.pay(payIn.reference, 100_000_000n);
    await reconcileCharge(payIn.reference, user);
    const p2 = await db().payIn.findFirstOrThrow({ where: { orderId: order.id, sequence: 2 } });
    expect(p2.amountRequestedKobo).toBe(100_000_000n);
    double.pay(p2.reference, 100_000_000n);
    await reconcileCharge(p2.reference, user);
    const p3 = await db().payIn.findFirstOrThrow({ where: { orderId: order.id, sequence: 3 } });
    expect(p3).toMatchObject({ reference: `PA-${order.id}-P3`, amountRequestedKobo: 50_000_000n });
    double.pay(p3.reference, 50_000_000n);
    await reconcileCharge(p3.reference, user);
    expect(await status(order.id)).toBe("STAGE_1_PAID");
    await expectMoneyInvariants(order.id);
  });

  it("an instalment account paid short is a real underpayment", async () => {
    const { order, payIn } = await approvedOrder(126_000_000n);
    double.pay(payIn.reference, 90_000_000n); // ₦900,000 into the ₦1,000,000 account (Accept All)
    await reconcileCharge(payIn.reference, user);
    expect(await status(order.id)).toBe("UNDERPAID");
    const topUp = await db().payIn.findFirstOrThrow({ where: { orderId: order.id, sequence: 2 } });
    expect(topUp).toMatchObject({ reference: `PA-${order.id}-T2`, amountRequestedKobo: 36_000_000n });
    await expectMoneyInvariants(order.id);
  });

  it("a short payment on a large order asks only for what each capped account takes", async () => {
    const { order, payIn } = await approvedOrder(250_000_000n);
    double.pay(payIn.reference, 50_000_000n); // ₦500,000 into the ₦1,000,000 account
    await reconcileCharge(payIn.reference, user);
    expect(await status(order.id)).toBe("UNDERPAID");
    let view = await buildOrderView(order.id, "buyer");
    expect(view.pay).toMatchObject({ state: "short", shortfall: "₦2,000,000", amountDue: "₦1,000,000" });

    const t2 = await db().payIn.findFirstOrThrow({ where: { orderId: order.id, sequence: 2 } });
    expect(t2.amountRequestedKobo).toBe(100_000_000n);
    double.pay(t2.reference, 100_000_000n);
    await reconcileCharge(t2.reference, user);
    expect(await db().orderEvent.count({ where: { orderId: order.id, kind: "error" } })).toBe(1); // only the first shortfall
    expect(await db().orderEvent.count({ where: { orderId: order.id, title: "Transfer received" } })).toBe(1);
    view = await buildOrderView(order.id, "buyer");
    expect(view.pay).toMatchObject({ state: "short", shortfall: "₦1,000,000", amountDue: "₦1,000,000" });

    const t3 = await db().payIn.findFirstOrThrow({ where: { orderId: order.id, sequence: 3 } });
    double.pay(t3.reference, 100_000_000n);
    await reconcileCharge(t3.reference, user);
    expect(await status(order.id)).toBe("STAGE_1_PAID");
    await expectMoneyInvariants(order.id);
  });

  it("the poller opens the next account when the follow-up was lost", async () => {
    const { order, payIn } = await approvedOrder(126_000_000n);
    for (let i = 0; i < 3; i++) double.next("POST /charges/bank-transfer", { status: 503 }); // every try of the follow-up fails
    double.pay(payIn.reference, 100_000_000n);
    await reconcileCharge(payIn.reference, user);
    expect(await status(order.id)).toBe("AWAITING_PAYMENT");
    expect(await db().payIn.count({ where: { orderId: order.id, status: "PROCESSING" } })).toBe(0);
    expect(await db().orderEvent.count({ where: { orderId: order.id, title: "Couldn't open an account for the rest" } })).toBe(1);

    await pollOnce(new Date(Date.now() + 2 * 60_000)); // past the self-heal gap
    const next = await db().payIn.findFirstOrThrow({ where: { orderId: order.id, status: "PROCESSING" } });
    expect(next.amountRequestedKobo).toBe(26_000_000n);
    expect(next.reference).toMatch(new RegExp(`^PA-${order.id}-P\\d+$`));
  });
});

describe("an approval whose Kora call failed", () => {
  it("is retried by the poller instead of leaving the buyer on 'opening' forever", async () => {
    const f = await makeOrderFixture({ amountKobo: 84_000_000n });
    for (let i = 0; i < 3; i++) double.next("POST /charges/bank-transfer", { status: 503 }); // every try fails, like a network blip
    await expect(openPayIn(f.order.id, f.order.amountKobo, "initial", user)).rejects.toBeDefined();
    expect(await status(f.order.id)).toBe("CREATED");
    expect(await db().payIn.count({ where: { orderId: f.order.id } })).toBe(0);

    await pollOnce(); // just approved: an approve may still be in flight, so leave it alone
    expect(await db().payIn.count({ where: { orderId: f.order.id } })).toBe(0);

    await pollOnce(new Date(Date.now() + 2 * 60_000));
    const opened = await db().payIn.findFirstOrThrow({ where: { orderId: f.order.id, status: "PROCESSING" } });
    expect(opened.amountRequestedKobo).toBe(84_000_000n);
    expect(await status(f.order.id)).toBe("AWAITING_PAYMENT");
    await expectMoneyInvariants(f.order.id);
  });
});

describe("Kora's 'return all' preference reverses an overpayment too", () => {
  it("nothing is held and the buyer is told", async () => {
    double.preference = "return_all";
    const { order, payIn } = await approvedOrder();
    double.pay(payIn.reference, 90_000_000n);
    await reconcileCharge(payIn.reference, user);
    expect(await status(order.id)).toBe("AWAITING_PAYMENT");
    expect(await heldBalance(order.id)).toBe(0n);
    await reconcileCharge(payIn.reference, user);
    expect(await db().orderEvent.count({ where: { orderId: order.id, title: "charge.overpaid" } })).toBe(1);
  });
});

describe("webhooks — signature, duplicates, ordering, never a 5xx", () => {
  it("valid webhook → stored → outbox → HELD → Stage 1 dispatched", async () => {
    const { order, payIn } = await approvedOrder();
    double.pay(payIn.reference, 84_000_000n);
    const { rawBody, signature } = double.chargeWebhook(payIn.reference);
    const r = await deliver(rawBody, signature);
    expect(r).toMatchObject({ signatureValid: true, duplicate: false, enqueued: true });
    const o = await db().order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("STAGE_1_PAID");
    expect(o.handoverCodeHash).not.toBeNull();
    const event = await db().koraEvent.findUniqueOrThrow({ where: { id: r.eventId ?? "" } });
    expect(event.processedAt).not.toBeNull();
    expect(event.rawBody).toBe(rawBody);
    await expectMoneyInvariants(order.id);
  });

  it("an invalid signature is stored (for admin, in red) and changes nothing", async () => {
    const { order, payIn } = await approvedOrder();
    double.pay(payIn.reference, 84_000_000n);
    const { rawBody, signature } = double.chargeWebhook(payIn.reference, { tamper: true });
    const r = await deliver(rawBody, signature);
    expect(r).toMatchObject({ signatureValid: false, enqueued: false });
    expect(await status(order.id)).toBe("AWAITING_PAYMENT");
    expect(await db().outbox.count()).toBe(0);
    const stored = await db().koraEvent.findUniqueOrThrow({ where: { id: r.eventId ?? "" } });
    expect(stored.signatureValid).toBe(false);
    expect(await db().orderEvent.count({ where: { orderId: order.id, signature: "INVALID" } })).toBe(1);
    expect(await db().ledgerEntry.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("a forged copy delivered first cannot shadow the genuine webhook", async () => {
    const { order, payIn } = await approvedOrder();
    double.pay(payIn.reference, 84_000_000n);
    const genuine = double.chargeWebhook(payIn.reference);
    await deliver(genuine.rawBody, "0".repeat(64)); // same bytes, bad signature
    const r = await deliver(genuine.rawBody, genuine.signature);
    expect(r).toMatchObject({ signatureValid: true, duplicate: false, enqueued: true });
    expect(await status(order.id)).toBe("STAGE_1_PAID");
  });

  it("duplicate deliveries are no-ops", async () => {
    const { order, payIn } = await approvedOrder();
    double.pay(payIn.reference, 84_000_000n);
    const { rawBody, signature } = double.chargeWebhook(payIn.reference);
    await deliver(rawBody, signature);
    const second = await deliver(rawBody, signature);
    const third = await deliver(rawBody, signature);
    expect(second.duplicate && third.duplicate).toBe(true);
    expect(await db().outbox.count()).toBe(1);
    expect(await db().ledgerEntry.count({ where: { orderId: order.id, sourceType: "PAYIN" } })).toBe(2);
    expect(await db().orderTransition.count({ where: { orderId: order.id, toState: "HELD" } })).toBe(1);
    expect(await db().payout.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("out-of-order: charge.failed after charge.success cannot undo the payment", async () => {
    const { order, payIn } = await approvedOrder();
    double.pay(payIn.reference, 84_000_000n);
    const ok = double.chargeWebhook(payIn.reference);
    const late = double.chargeWebhook(payIn.reference, { event: "charge.failed" });
    await deliver(late.rawBody, late.signature); // arrives first, but Kora's query says success
    await deliver(ok.rawBody, ok.signature);
    expect(await status(order.id)).toBe("STAGE_1_PAID");
    expect((await db().payIn.findUniqueOrThrow({ where: { reference: payIn.reference } })).status).toBe("SUCCESS");
    await expectMoneyInvariants(order.id);
  });

  it("out-of-order: a transfer webhook that beats our own disburse bookkeeping still settles once", async () => {
    const { order, payIn } = await approvedOrder();
    double.pay(payIn.reference, 84_000_000n);
    await reconcileCharge(payIn.reference, user);
    const s1 = await db().payout.findFirstOrThrow({ where: { orderId: order.id, stage: "STAGE_1" } });
    const w = double.transferWebhook(s1.reference, "success");
    await deliver(w.rawBody, w.signature);
    await deliver(w.rawBody, w.signature);
    await reconcilePayout(s1.reference, { type: "POLLER", id: "t" });
    expect((await db().payout.findUniqueOrThrow({ where: { id: s1.id } })).status).toBe("SUCCESS");
    expect(await db().ledgerEntry.count({ where: { orderId: order.id, sourceType: "PAYOUT" } })).toBe(2);
    await expectMoneyInvariants(order.id);
  });

  it("the route answers 200 for junk, missing headers, oversized bodies and a dead database", async () => {
    const post = (body: string, headers: Record<string, string> = {}) =>
      webhookRoute(new Request("http://localhost/api/webhooks/kora", { method: "POST", body, headers }));
    expect((await post("not json")).status).toBe(200);
    expect((await post("{}")).status).toBe(200);
    expect((await post('{"event":"charge.success","data":{"reference":"PA-x"}}', { "x-korapay-signature": "zz" })).status).toBe(200);
    expect((await post("x".repeat(600_000))).status).toBe(200);

    const realUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://nobody:nothing@127.0.0.1:1/none";
    try {
      expect((await post('{"event":"charge.success","data":{"reference":"PA-y"}}', { "x-korapay-signature": "a".repeat(64) })).status).toBe(200);
    } finally {
      process.env.DATABASE_URL = realUrl;
    }
  });
});

describe("payouts — two stages, failures, retries, unknown outcomes", () => {
  async function heldOrder() {
    const f = await approvedOrder();
    double.pay(f.payIn.reference, f.order.amountKobo);
    return f;
  }

  it("blocks Stage 1 with a precise message when the disbursement balance is short", async () => {
    const f = await heldOrder();
    double.availableKobo = 0n;
    await reconcileCharge(f.payIn.reference, user);
    expect(await status(f.order.id)).toBe("HELD");
    expect(await db().payout.count({ where: { orderId: f.order.id } })).toBe(0);
    const err = await db().orderEvent.findFirstOrThrow({ where: { orderId: f.order.id, kind: "error" } });
    expect(err.detail).toBe("Insufficient funds in disbursement wallet. Kora balance is ₦0; Stage 1 needs ₦252,000.");
    // Funded again: the next attempt goes through.
    double.availableKobo = 1_000_000_000n;
    const r = await dispatchStage(f.order.id, "STAGE_1", user);
    expect(r.kind).toBe("sent");
    expect(await status(f.order.id)).toBe("STAGE_1_PAID");
  });

  it("forced failure (035) → PAYOUT_FAILED → retry with a NEW reference linked by retryOfId", async () => {
    const f = await heldOrder();
    await setSetting("payoutRoute", "SANDBOX_FAIL_035");
    await reconcileCharge(f.payIn.reference, user);
    const first = await db().payout.findFirstOrThrow({ where: { orderId: f.order.id } });
    expect(first).toMatchObject({ route: "SANDBOX_TEST_ACCOUNT", destinationBankCode: "035", reference: `PO-${f.order.id}-S1` });
    await reconcilePayout(first.reference, { type: "POLLER", id: "t" });
    expect(await status(f.order.id)).toBe("PAYOUT_FAILED");
    expect((await db().payout.findUniqueOrThrow({ where: { id: first.id } })).failureReason).toBe("Declined by receiving bank");

    await setSetting("payoutRoute", "VERIFIED_ACCOUNT");
    const r = await retryPayout(f.order.id, user);
    expect(r.kind).toBe("sent");
    const retry = await db().payout.findFirstOrThrow({ where: { retryOfId: first.id } });
    expect(retry.reference).toBe(`PO-${f.order.id}-S1-R2`);
    expect(retry.route).toBe("VERIFIED_ACCOUNT");
    expect(await status(f.order.id)).toBe("STAGE_1_PAID");
    await reconcilePayout(retry.reference, { type: "POLLER", id: "t" });
    expect((await db().payout.findUniqueOrThrow({ where: { id: retry.id } })).status).toBe("SUCCESS");
    await expectMoneyInvariants(f.order.id);
  });

  it("a 5xx on disburse leaves the payout PENDING (never re-sent); Kora's 'no record' later fails it safely", async () => {
    const f = await heldOrder();
    double.next("POST /transactions/disburse", { status: 500 }); // the double did NOT create it
    await reconcileCharge(f.payIn.reference, user);
    const p = await db().payout.findFirstOrThrow({ where: { orderId: f.order.id } });
    expect(p.status).toBe("PENDING");
    expect(p.koraErrorKind).toBe("server");
    expect(double.callsTo("POST /transactions/disburse")).toBe(1);

    await pollOnce(); // too young: untouched
    expect((await db().payout.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PENDING");

    await db().$executeRaw`UPDATE "Payout" SET "createdAt" = now() - interval '2 minutes', "updatedAt" = now() - interval '2 minutes' WHERE "id" = ${p.id}`;
    await pollOnce();
    const resolved = await db().payout.findUniqueOrThrow({ where: { id: p.id } });
    expect(resolved.status).toBe("FAILED");
    expect(resolved.failureReason).toBe("Kora has no record of this payout, so it was never sent.");
    expect(await status(f.order.id)).toBe("PAYOUT_FAILED");
    expect(double.callsTo("POST /transactions/disburse")).toBe(1);
  });

  it("a timeout on disburse that Kora DID process resolves to SUCCESS via the poller, not a second payout", async () => {
    const f = await heldOrder();
    double.next("POST /transactions/disburse", { delayMs: 2_500 }); // client times out at 2s; the double still records it
    await reconcileCharge(f.payIn.reference, user);
    const p = await db().payout.findFirstOrThrow({ where: { orderId: f.order.id } });
    expect(p.status).toBe("PENDING");
    expect(p.koraErrorKind).toBe("timeout");
    await new Promise((r) => setTimeout(r, 700));
    await db().$executeRaw`UPDATE "Payout" SET "createdAt" = now() - interval '2 minutes', "updatedAt" = now() - interval '2 minutes' WHERE "id" = ${p.id}`;
    await pollOnce();
    expect((await db().payout.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("SUCCESS");
    expect(await db().payout.count({ where: { orderId: f.order.id } })).toBe(1);
    expect(double.payouts.size).toBe(1);
  });

  it("full two-stage flow with the handover code: wrong code → attempts left; right code → Stage 2 → COMPLETE", async () => {
    const f = await heldOrder();
    await reconcileCharge(f.payIn.reference, user);
    const s1 = await db().payout.findFirstOrThrow({ where: { orderId: f.order.id, stage: "STAGE_1" } });
    await reconcilePayout(s1.reference, { type: "POLLER", id: "t" });

    const o = await db().order.findUniqueOrThrow({ where: { id: f.order.id } });
    const code = revealHandoverCode(o);
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await submitHandoverCode(f.order.id, wrong, "vendor")).toEqual({ ok: false, reason: "wrong", attemptsLeft: 4 });
    expect(await submitHandoverCode(f.order.id, code ?? "", "vendor")).toEqual({ ok: true });
    expect(await status(f.order.id)).toBe("RELEASED");
    const s2 = await db().payout.findFirstOrThrow({ where: { orderId: f.order.id, stage: "STAGE_2" } });
    expect(s2.amountKobo).toBe(58_800_000n);
    const w = double.transferWebhook(s2.reference, "success");
    await deliver(w.rawBody, w.signature);
    expect(await status(f.order.id)).toBe("COMPLETE");
    expect(await heldBalance(f.order.id)).toBe(0n);
    await expectMoneyInvariants(f.order.id);
    // The code is single-use.
    expect(await submitHandoverCode(f.order.id, code ?? "", "vendor")).toEqual({ ok: false, reason: "used" });
  });

  it("locks the code after 5 wrong attempts", async () => {
    const f = await heldOrder();
    await reconcileCharge(f.payIn.reference, user);
    const s1 = await db().payout.findFirstOrThrow({ where: { orderId: f.order.id, stage: "STAGE_1" } });
    await reconcilePayout(s1.reference, { type: "POLLER", id: "t" });
    const code = revealHandoverCode(await db().order.findUniqueOrThrow({ where: { id: f.order.id } }));
    const wrong = code === "000000" ? "111111" : "000000";
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await submitHandoverCode(f.order.id, wrong, "vendor"));
    expect(results.at(-1)).toEqual({ ok: false, reason: "locked" });
    expect(await submitHandoverCode(f.order.id, code ?? "", "vendor")).toEqual({ ok: false, reason: "locked" });
    expect(await status(f.order.id)).toBe("STAGE_1_PAID");
  });
});

describe("the poller resolves a missing webhook", () => {
  it("finds a paid charge 20s+ after the account opened, with no webhook at all", async () => {
    const { order, payIn } = await approvedOrder();
    double.pay(payIn.reference, 84_000_000n);
    await pollOnce();
    expect(await status(order.id)).toBe("AWAITING_PAYMENT"); // too young
    await db().$executeRaw`UPDATE "PayIn" SET "createdAt" = now() - interval '1 minute' WHERE "id" = ${payIn.id}`;
    await pollOnce();
    expect(await status(order.id)).toBe("STAGE_1_PAID");
  });

  it("a suppressed webhook is stored but not acted on; the poller still gets there", async () => {
    const { order, payIn } = await approvedOrder();
    await setSetting("suppressNextWebhook", "true");
    double.pay(payIn.reference, 84_000_000n);
    const { rawBody, signature } = double.chargeWebhook(payIn.reference);
    const r = await deliver(rawBody, signature);
    expect(r.note).toBe("suppressed");
    expect(await status(order.id)).toBe("AWAITING_PAYMENT");
    await db().$executeRaw`UPDATE "PayIn" SET "createdAt" = now() - interval '1 minute' WHERE "id" = ${payIn.id}`;
    await pollOnce();
    expect(await status(order.id)).toBe("STAGE_1_PAID");
  });
});
