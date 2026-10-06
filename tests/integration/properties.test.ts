import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { revealHandoverCode, submitHandoverCode } from "@/lib/domain/handover";
import { openPayIn, reconcileCharge } from "@/lib/domain/payin";
import { reconcilePayout, retryPayout } from "@/lib/domain/payouts";
import { setSetting } from "@/lib/domain/settings";
import { splitStages } from "@/lib/money";
import { makeOrderFixture } from "../helpers/factories";
import { useKoraDouble } from "../helpers/kora";
import { expectMoneyInvariants, heldBalance, ledgerNet, successfulPayouts } from "../helpers/ledger";

/**
 * Property: for any purchase — any total (odd kobo included), exact / under / over payment, any
 * pattern of payout failures and retries — after EVERY step:
 *   ledger nets to zero, HELD ≥ 0, successful payouts ≤ accepted;
 * and at the end the vendor received exactly the order total, split floor(30%) / remainder.
 */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const double = useKoraDouble();
const user = { type: "USER" as const, id: "prop" };
const poller = { type: "POLLER" as const, id: "prop" };

describe("money invariants hold across random purchases", () => {
  it.each(Array.from({ length: 10 }, (_, i) => i + 1))("seed %i", async (seed) => {
    const rnd = mulberry32(seed);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
    const amountKobo = BigInt(1_000 + Math.floor(rnd() * 499_999_000)) + (rnd() < 0.5 ? 1n : 0n);
    const payment = pick(["exact", "under", "over"] as const);
    const failS1 = rnd() < 0.4;
    const failS2 = rnd() < 0.4;
    const wrongCodeFirst = rnd() < 0.5;

    const f = await makeOrderFixture({ amountKobo });
    const id = f.order.id;
    const check = () => expectMoneyInvariants(id);

    await setSetting("payoutRoute", failS1 ? "SANDBOX_FAIL_035" : "VERIFIED_ACCOUNT");
    const payIn = await openPayIn(id, amountKobo, "initial", user);
    await check();

    if (payment === "under") {
      const part = amountKobo / 2n > 0n ? amountKobo / 2n : 1n;
      double.pay(payIn.reference, part);
      await reconcileCharge(payIn.reference, user);
      await check();
      const topUp = await db().payIn.findFirstOrThrow({ where: { orderId: id, sequence: 2 } });
      double.pay(topUp.reference, amountKobo - part);
      await reconcileCharge(topUp.reference, user);
    } else {
      double.pay(payIn.reference, payment === "over" ? amountKobo + 12_345n : amountKobo);
      await reconcileCharge(payIn.reference, user);
    }
    await check();

    const s1 = await db().payout.findFirstOrThrow({ where: { orderId: id, stage: "STAGE_1" }, orderBy: { createdAt: "asc" } });
    await reconcilePayout(s1.reference, poller);
    await check();
    if (failS1) {
      expect((await db().order.findUniqueOrThrow({ where: { id } })).status).toBe("PAYOUT_FAILED");
      await setSetting("payoutRoute", "VERIFIED_ACCOUNT");
      await retryPayout(id, user);
      const retry = await db().payout.findFirstOrThrow({ where: { orderId: id, retryOfId: s1.id } });
      await reconcilePayout(retry.reference, poller);
      await check();
    }

    const code = revealHandoverCode(await db().order.findUniqueOrThrow({ where: { id } })) ?? "";
    if (wrongCodeFirst) await submitHandoverCode(id, code === "123456" ? "654321" : "123456", "vendor");
    await setSetting("payoutRoute", failS2 ? "SANDBOX_FAIL_035" : "VERIFIED_ACCOUNT");
    expect(await submitHandoverCode(id, code, "vendor")).toEqual({ ok: true });
    await check();

    const s2 = await db().payout.findFirstOrThrow({ where: { orderId: id, stage: "STAGE_2" }, orderBy: { createdAt: "asc" } });
    await reconcilePayout(s2.reference, poller);
    await check();
    if (failS2) {
      await setSetting("payoutRoute", "VERIFIED_ACCOUNT");
      await retryPayout(id, user);
      const retry = await db().payout.findFirstOrThrow({ where: { orderId: id, retryOfId: s2.id } });
      await reconcilePayout(retry.reference, poller);
      await check();
    }

    const o = await db().order.findUniqueOrThrow({ where: { id } });
    expect(o.status).toBe("COMPLETE");
    expect(await ledgerNet(id)).toBe(0n);
    expect(await successfulPayouts(id)).toBe(amountKobo);
    const { stage1, stage2 } = splitStages(amountKobo);
    const paid = await db().payout.findMany({ where: { orderId: id, status: "SUCCESS" } });
    expect(paid.find((p) => p.stage === "STAGE_1")?.amountKobo).toBe(stage1);
    expect(paid.find((p) => p.stage === "STAGE_2")?.amountKobo).toBe(stage2);
    expect(await heldBalance(id)).toBe(o.amountAcceptedKobo - amountKobo); // 0, or the overpaid excess
  });
});
