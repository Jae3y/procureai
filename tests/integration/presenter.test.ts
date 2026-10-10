import { beforeEach, describe, expect, it } from "vitest";
import { POST as demoControls } from "@/app/api/admin/demo/route";
import { db } from "@/lib/db";
import { openPayIn } from "@/lib/domain/payin";
import { getSetting } from "@/lib/domain/settings";
import { resetEnvCache } from "@/lib/env";
import { receiveKoraWebhook } from "@/lib/webhooks/receive";
import { processOutboxBatch } from "@/lib/worker/outbox";
import { makeOrderFixture } from "../helpers/factories";
import { useKoraDouble } from "../helpers/kora";

/** Every presenter / failure control, through the admin route exactly as the deployed button calls it. */

const double = useKoraDouble();
const TOKEN = "presenter-test-admin-token-0123456789";
const bearer = { authorization: `Bearer ${TOKEN}` };

beforeEach(() => {
  Object.assign(process.env, { DEMO_MODE: "true", ADMIN_TOKEN: TOKEN });
  resetEnvCache();
});

async function demo(body: unknown) {
  const res = await demoControls(
    new Request("http://localhost:3000/api/admin/demo", { method: "POST", headers: { "content-type": "application/json", ...bearer }, body: JSON.stringify(body) }),
    { params: Promise.resolve({}) },
  );
  return { status: res.status, body: (await res.json()) as { message?: string; error?: { message: string } } };
}

async function paidOrder(route?: "SANDBOX_FAIL_035") {
  const f = await makeOrderFixture({ amountKobo: 84_000_000n });
  if (route) expect((await demo({ action: "route", route })).status).toBe(200);
  const payIn = await openPayIn(f.order.id, f.order.amountKobo, "initial", { type: "USER", id: "t" });
  double.pay(payIn.reference, 84_000_000n);
  const w = double.chargeWebhook(payIn.reference);
  await receiveKoraWebhook({ rawBody: w.rawBody, signatureHeader: w.signature });
  await processOutboxBatch();
  return f.order;
}

describe("presenter controls", () => {
  it("one-click reset, in both sizes", async () => {
    const full = await demo({ action: "reset", scenario: "full" });
    expect(full.status).toBe(200);
    expect(full.body.message).toMatch(/300 branded T-shirts/);
    const short = await demo({ action: "reset", scenario: "short" });
    expect(short.body.message).toMatch(/200 branded T-shirts/);
    const current = await getSetting("currentDemoRequestId");
    const quotes = await db().quote.findMany({ where: { requestId: current } });
    expect(quotes.length).toBeGreaterThanOrEqual(3);
  });

  it("Kora health check answers with latency and balance", async () => {
    const r = await demo({ action: "health" });
    expect(r.status).toBe(200);
    expect(r.body.message).toMatch(/^Kora answered in \d+ ms · sandbox · available ₦/);
  });

  it("payout failure, then retry to a new reference that succeeds", async () => {
    const order = await paidOrder("SANDBOX_FAIL_035");
    const s1 = await db().payout.findFirstOrThrow({ where: { orderId: order.id, stage: "STAGE_1" } });
    const fail = double.transferWebhook(s1.reference, "failed");
    await receiveKoraWebhook({ rawBody: fail.rawBody, signatureHeader: fail.signature });
    await processOutboxBatch();
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAYOUT_FAILED");

    const retry = await demo({ action: "retry-stage", orderId: order.id });
    expect(retry.status).toBe(200);
    const retried = await db().payout.findFirstOrThrow({ where: { orderId: order.id, stage: "STAGE_1", retryOfId: s1.id } });
    expect(retried.reference).not.toBe(s1.reference);
    expect(retried.destinationBankCode ?? "033").toBe("033");
  });

  it("invalid signature and duplicate webhook use the newest real webhook and change nothing", async () => {
    const order = await paidOrder();
    const before = await db().order.findUniqueOrThrow({ where: { id: order.id } });

    const corrupt = await demo({ action: "corrupt-latest" });
    expect(corrupt.status).toBe(200);
    expect(corrupt.body.message).toMatch(/Invalid signature/);
    expect(await db().koraEvent.count({ where: { signatureValid: false } })).toBe(1);

    const dup = await demo({ action: "replay-latest" });
    expect(dup.status).toBe(200);
    expect(dup.body.message).toMatch(/Duplicate webhook|Replayed/);

    const after = await db().order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.amountAcceptedKobo).toBe(before.amountAcceptedKobo);
  });
});
