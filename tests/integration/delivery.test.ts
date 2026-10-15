import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { addDisputeEvidence, markDelivered, releaseDueDeliveries, resolveDispute, skipDeliveryWait } from "@/lib/domain/delivery";
import { revealHandoverCode, submitHandoverCode } from "@/lib/domain/handover";
import { openPayIn } from "@/lib/domain/payin";
import { reconcilePayout } from "@/lib/domain/payouts";
import { disputeOrder } from "@/lib/domain/refunds";
import { buyerSessionCookie } from "@/lib/http/session";
import { buildOrderView } from "@/lib/views/order-view";
import { receiveKoraWebhook } from "@/lib/webhooks/receive";
import { processOutboxBatch } from "@/lib/worker/outbox";
import { pollOnce } from "@/lib/worker/poller";
import { GET as photoGet } from "@/app/api/orders/[id]/evidence/[eid]/route";
import { POST as deliveredPost } from "@/app/api/vendors/[token]/delivered/route";
import { makeBuyer, makeOrderFixture } from "../helpers/factories";
import { useKoraDouble } from "../helpers/kora";
import { expectMoneyInvariants, heldBalance, successfulPayouts } from "../helpers/ledger";

const double = useKoraDouble();
const buyer = { type: "USER" as const, id: "buyer-test" };
const admin = { type: "ADMIN" as const, id: "admin" };
const HOUR = 60 * 60 * 1000;
// A 1×1 JPEG: enough to prove photos are stored, served and access-checked.
const TINY_JPEG = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

function setEnv(vars: Record<string, string>) {
  Object.assign(process.env, vars);
  resetEnvCache();
}
beforeEach(() => setEnv({ ADMIN_TOKEN: "delivery-test-admin-token-0123456789", DELIVERY_GRACE_HOURS: "72" }));
afterEach(() => setEnv({ ADMIN_TOKEN: "" }));

/** ₦840,000 order, paid, Stage 1 (₦252,000) confirmed by Kora: ₦588,000 held for Stage 2. */
async function stageOnePaidOrder() {
  const f = await makeOrderFixture({ amountKobo: 84_000_000n });
  const payIn = await openPayIn(f.order.id, 84_000_000n, "initial", buyer);
  double.pay(payIn.reference, 84_000_000n);
  const { rawBody, signature } = double.chargeWebhook(payIn.reference);
  await receiveKoraWebhook({ rawBody, signatureHeader: signature });
  await processOutboxBatch();
  await settlePayouts(f.order.id);
  expect((await db().order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("STAGE_1_PAID");
  return f;
}

async function settlePayouts(orderId: string) {
  for (const p of await db().payout.findMany({ where: { orderId, status: "PENDING" } })) await reconcilePayout(p.reference, admin);
}

async function status(orderId: string) {
  return (await db().order.findUniqueOrThrow({ where: { id: orderId } })).status;
}

describe("delivery without the code: proof, then automatic release", () => {
  it("releases Stage 2 only after the buyer's window passes without a problem", async () => {
    const f = await stageOnePaidOrder();
    const before = Date.now();
    const { autoReleaseAt } = await markDelivered(f.order.id, f.vendor.id, { note: "200 shirts to Ikeja, received by Tolu", photo: { type: "image/jpeg", base64: TINY_JPEG } });
    expect(autoReleaseAt.getTime()).toBeGreaterThanOrEqual(before + 72 * HOUR);

    // Still inside the window: nothing moves, even when the poller runs.
    expect(await releaseDueDeliveries(new Date(Date.now() + 71 * HOUR))).toBe(0);
    expect((await pollOnce()).released).toBe(0);
    expect(await status(f.order.id)).toBe("STAGE_1_PAID");

    // Window over: Stage 2 goes out through the normal path, once.
    expect(await releaseDueDeliveries(new Date(Date.now() + 73 * HOUR))).toBe(1);
    expect(await releaseDueDeliveries(new Date(Date.now() + 74 * HOUR))).toBe(0);
    expect(await status(f.order.id)).toBe("RELEASED");
    await settlePayouts(f.order.id);
    expect(await status(f.order.id)).toBe("COMPLETE");
    expect(await successfulPayouts(f.order.id)).toBe(84_000_000n);
    expect(await heldBalance(f.order.id)).toBe(0n);
    await expectMoneyInvariants(f.order.id);
    const transitions = await db().orderTransition.findMany({ where: { orderId: f.order.id, toState: "CODE_VERIFIED" } });
    expect(transitions).toEqual([expect.objectContaining({ causeType: "SYSTEM", causeId: "auto-release" })]);
  });

  it("can't be marked before Stage 1 lands, and only by the chosen vendor", async () => {
    const f = await makeOrderFixture({ amountKobo: 84_000_000n });
    await expect(markDelivered(f.order.id, f.vendor.id, { note: "done" })).rejects.toMatchObject({ code: "not_deliverable" });
    const g = await stageOnePaidOrder();
    await expect(markDelivered(g.order.id, f.vendor.id, { note: "done" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("keeps the code as the fast path: the code releases at once and the timer then does nothing", async () => {
    const f = await stageOnePaidOrder();
    await markDelivered(f.order.id, f.vendor.id, { note: "delivered" });
    const code = revealHandoverCode(await db().order.findUniqueOrThrow({ where: { id: f.order.id } }));
    expect(await submitHandoverCode(f.order.id, code ?? "", "vendor")).toEqual({ ok: true });
    expect(await status(f.order.id)).toBe("RELEASED");
    expect(await releaseDueDeliveries(new Date(Date.now() + 100 * HOUR))).toBe(0);
    expect(await db().payout.count({ where: { orderId: f.order.id, stage: "STAGE_2" } })).toBe(1);
  });

  it("stops the release when the buyer reports a problem in time, and refuses a report after the window", async () => {
    const f = await stageOnePaidOrder();
    await markDelivered(f.order.id, f.vendor.id, { note: "delivered" });
    await disputeOrder(f.order.id, "40 shirts are the wrong size", buyer, { type: "image/jpeg", base64: TINY_JPEG });
    expect(await releaseDueDeliveries(new Date(Date.now() + 100 * HOUR))).toBe(0);
    expect(await status(f.order.id)).toBe("DISPUTED");

    const late = await stageOnePaidOrder();
    await markDelivered(late.order.id, late.vendor.id, { note: "delivered" });
    await db().order.update({ where: { id: late.order.id }, data: { autoReleaseAt: new Date(Date.now() - 1000) } });
    await expect(disputeOrder(late.order.id, "too late now", buyer)).rejects.toMatchObject({ code: "dispute_window_closed" });
  });

  it("the presenter can skip the wait in a demo", async () => {
    const f = await stageOnePaidOrder();
    await expect(skipDeliveryWait(f.order.id)).rejects.toMatchObject({ code: "not_delivered" });
    await markDelivered(f.order.id, f.vendor.id, { note: "delivered" });
    expect(await skipDeliveryWait(f.order.id)).toBe(1);
    expect(await status(f.order.id)).toBe("RELEASED");
  });
});

describe("disputes: evidence from both sides, then a ruling", () => {
  it("rules for the vendor: Stage 2 is released as if the code was entered", async () => {
    const f = await stageOnePaidOrder();
    await markDelivered(f.order.id, f.vendor.id, { note: "delivered, signed for" });
    await disputeOrder(f.order.id, "Never arrived", buyer);
    await addDisputeEvidence(f.order.id, "VENDOR", { note: "Signed delivery note attached", photo: { type: "image/jpeg", base64: TINY_JPEG } });
    await addDisputeEvidence(f.order.id, "BUYER", { note: "Nobody came to the office" });

    const view = await buildOrderView(f.order.id, "admin");
    expect(view.track.evidence.map((e) => [e.party, e.kind, Boolean(e.photoUrl)])).toEqual([
      ["vendor", "delivery", false],
      ["buyer", "dispute", false],
      ["vendor", "dispute", true],
      ["buyer", "dispute", false],
    ]);

    const r = await resolveDispute(f.order.id, "vendor", admin);
    expect(r.message).toMatch(/^Ruled for the vendor: Stage 2 \(₦588,000\) sent to Kora\.$/);
    await settlePayouts(f.order.id);
    expect(await status(f.order.id)).toBe("COMPLETE");
    expect(await heldBalance(f.order.id)).toBe(0n);
    await expectMoneyInvariants(f.order.id);
  });

  it("rules for the buyer: what is still held is refunded through Kora", async () => {
    const f = await stageOnePaidOrder();
    await disputeOrder(f.order.id, "Wrong colour", buyer);
    const r = await resolveDispute(f.order.id, "buyer", admin);
    expect(r.refund?.reference).toBe(`RF-${f.order.id}-1`);
    expect(double.callsTo("POST /refunds/initiate")).toBe(1);
    // While Kora is still processing that refund, the held money can't also be paid to the vendor.
    await expect(resolveDispute(f.order.id, "vendor", admin)).rejects.toMatchObject({ code: "refund_in_progress" });
    expect(await db().payout.count({ where: { orderId: f.order.id, stage: "STAGE_2" } })).toBe(0);
  });

  it("a dispute raised before Stage 1 landed can only end in a refund", async () => {
    const f = await makeOrderFixture({ amountKobo: 84_000_000n });
    const payIn = await openPayIn(f.order.id, 84_000_000n, "initial", buyer);
    double.pay(payIn.reference, 84_000_000n);
    double.next("POST /transactions/disburse", { status: 503, body: { status: false, message: "down" }, times: 3 });
    const { rawBody, signature } = double.chargeWebhook(payIn.reference);
    await receiveKoraWebhook({ rawBody, signatureHeader: signature });
    await processOutboxBatch();
    const s = await status(f.order.id);
    expect(["HELD", "STAGE_1_PAID"]).toContain(s);
    await disputeOrder(f.order.id, "Changed my mind", buyer);
    await expect(resolveDispute(f.order.id, "vendor", admin)).rejects.toMatchObject({ code: "stage1_not_paid" });
  });

  it("checks notes and photos before storing anything", async () => {
    const f = await stageOnePaidOrder();
    const big = Buffer.alloc(701 * 1024, 1).toString("base64");
    await expect(markDelivered(f.order.id, f.vendor.id, { note: "x", photo: { type: "image/jpeg", base64: big } })).rejects.toMatchObject({ code: "photo_too_big" });
    await expect(markDelivered(f.order.id, f.vendor.id, { note: "x", photo: { type: "image/gif", base64: TINY_JPEG } })).rejects.toMatchObject({ code: "photo_type" });
    await expect(markDelivered(f.order.id, f.vendor.id, { note: "   " })).rejects.toMatchObject({ code: "note_empty" });
    await expect(disputeOrder(f.order.id, "bad photo", buyer, { type: "image/jpeg", base64: big })).rejects.toMatchObject({ code: "photo_too_big" });
    expect(await status(f.order.id)).toBe("STAGE_1_PAID"); // the failed dispute froze nothing
    expect(await db().orderEvidence.count()).toBe(0);
  });
});

describe("evidence photos are private to the order's two parties (and admin)", () => {
  it("serves the photo to the buyer and the chosen vendor only", async () => {
    const f = await stageOnePaidOrder();
    const token = "deliveryVendorTokenForTests0001";
    await db().vendor.update({ where: { id: f.vendor.id }, data: { inviteTokenHash: createHash("sha256").update(token).digest("hex") } });

    // Through the vendor's route, by their link.
    const res = await deliveredPost(
      new Request(`http://localhost:3000/api/vendors/${token}/delivered`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: "Delivered to reception", photo: { type: "image/jpeg", base64: TINY_JPEG } }),
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(res.status).toBe(200);
    const ev = await db().orderEvidence.findFirstOrThrow({ where: { orderId: f.order.id } });
    const url = `http://localhost:3000/api/orders/${f.order.id}/evidence/${ev.id}`;
    const get = (u: string, headers: Record<string, string> = {}) => photoGet(new Request(u, { headers }), { params: Promise.resolve({ id: f.order.id, eid: ev.id.toString() }) });

    const own = await get(url, { cookie: buyerSessionCookie(f.request.buyerId).split(";")[0] ?? "" });
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await own.arrayBuffer()).toString("base64")).toBe(Buffer.from(TINY_JPEG, "base64").toString("base64"));
    expect((await get(`${url}?t=${token}`)).status).toBe(200);

    const stranger = await makeBuyer();
    expect((await get(url, { cookie: buyerSessionCookie(stranger.id).split(";")[0] ?? "" })).status).toBe(403);
    expect((await get(url)).status).toBe(403);
    expect((await get(`${url}?t=someoneElsesTokenThatIsLongEnough01`)).status).toBe(404);
  });
});
