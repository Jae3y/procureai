import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { openPayIn } from "@/lib/domain/payin";
import { receiveKoraWebhook } from "@/lib/webhooks/receive";
import { MAX_ATTEMPTS, processOutboxBatch } from "@/lib/worker/outbox";
import { makeOrderFixture } from "../helpers/factories";
import { useKoraDouble } from "../helpers/kora";

const double = useKoraDouble();

async function makeDue() {
  await db().$executeRaw`UPDATE "Outbox" SET "nextAttemptAt" = now() WHERE "doneAt" IS NULL`;
}

describe("outbox worker", () => {
  it("backs off exponentially, then parks the event with processError after 5 attempts", async () => {
    // A charge webhook for a reference we never created: every attempt fails with UnknownReference.
    const { rawBody, signature } = double.webhook("charge.success", { reference: "PA-never-created", amount: 100, status: "success", currency: "NGN" });
    const r = await receiveKoraWebhook({ rawBody, signatureHeader: signature });
    const gaps: number[] = [];
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      await makeDue();
      const before = Date.now();
      const res = await processOutboxBatch();
      const row = await db().outbox.findFirstOrThrow({ where: { eventId: r.eventId ?? "" } });
      expect(row.attempts).toBe(i);
      if (i < MAX_ATTEMPTS) {
        expect(res.retried).toBe(1);
        expect(row.doneAt).toBeNull();
        gaps.push(row.nextAttemptAt.getTime() - before);
      } else {
        expect(res.parked).toBe(1);
        expect(row.doneAt).not.toBeNull();
      }
    }
    // 2s, 4s, 8s, 16s (+ jitter ≤ 1s)
    gaps.forEach((gap, idx) => {
      const base = 1000 * 2 ** (idx + 1);
      expect(gap).toBeGreaterThanOrEqual(base - 50);
      expect(gap).toBeLessThanOrEqual(base + 1200);
    });
    const event = await db().koraEvent.findUniqueOrThrow({ where: { id: r.eventId ?? "" } });
    expect(event.processError).toMatch(/gave up after 5 attempt\(s\)/);
  });

  it("an event that becomes processable on a later attempt succeeds then", async () => {
    const f = await makeOrderFixture();
    const payIn = await openPayIn(f.order.id, f.order.amountKobo, "initial", { type: "USER", id: "t" });
    double.pay(payIn.reference, f.order.amountKobo);
    for (let i = 0; i < 3; i++) double.next("GET /charges/", { status: 503 }); // all 3 tries of attempt 1 fail
    const { rawBody, signature } = double.chargeWebhook(payIn.reference);
    await receiveKoraWebhook({ rawBody, signatureHeader: signature });
    expect((await processOutboxBatch()).retried).toBe(1);
    await makeDue();
    expect((await processOutboxBatch()).processed).toBe(1);
    expect((await db().order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("STAGE_1_PAID");
  });

  it("parallel workers never process the same event twice (FOR UPDATE SKIP LOCKED)", async () => {
    for (let i = 0; i < 12; i++) {
      const { rawBody, signature } = double.webhook("refund.success", { reference: `RFD-${i}`, amount: 100, status: "success", currency: "NGN" });
      await receiveKoraWebhook({ rawBody, signatureHeader: signature });
    }
    const results = await Promise.all([1, 2, 3, 4].map(() => processOutboxBatch({ limit: 5 })));
    const processed = results.reduce((a, r) => a + r.processed, 0);
    const second = await processOutboxBatch();
    expect(processed + second.processed).toBe(12);
    expect(await db().outbox.count({ where: { attempts: { gt: 1 } } })).toBe(0);
  });
});
