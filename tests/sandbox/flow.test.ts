import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { payAccount, underpay } from "@/lib/demo/actions";
import { setSetting } from "@/lib/domain/settings";
import { retryPayout } from "@/lib/domain/payouts";
import { kora } from "@/lib/kora/client";
import { hasSandboxKey } from "../setup/sandbox-env";
import { FlowDriver } from "../helpers/flow-driver";
import { expectMoneyInvariants, heldBalance, ledgerNet } from "../helpers/ledger";

/**
 * P4 gate, against the REAL Kora sandbox with the owner's test key. No webhook tunnel is assumed:
 * after each Kora action the test presses "Re-check with Kora" (the same code path the webhook
 * worker uses) until Kora's answer arrives.
 */

const run = hasSandboxKey ? describe : describe.skip;

async function until<T>(label: string, fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 90_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last = await fn();
  while (!ok(last)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}; last: ${JSON.stringify(last)}`);
    await new Promise((r) => setTimeout(r, 3000));
    last = await fn();
  }
  return last;
}

run("P4 · full flow against the real Kora sandbox", () => {
  it("preflight parity: identity, banks, balance answer with the shapes we parse", async () => {
    const cac = await kora().verifyCac({ rcNumber: "RC00000011", consent: true });
    expect(cac.data.company_status?.toUpperCase()).toBe("ACTIVE");
    const banks = await kora().listIdentityBanks("basic");
    expect(banks.data.some((b) => b.code === "058")).toBe(true);
    const bal = await kora().getBalances();
    expect(bal.data.NGN).toBeDefined();
  });

  it("request → verify → recommend → approve → pay (sandbox credit) → Stage 1 → code → Stage 2", async () => {
    const d = new FlowDriver();
    await d.seedDirectory();
    const requestId = await d.createAndQuote();
    const view = await d.verifyAndRecommend(requestId);
    expect(view.checks.find((c) => c.label === "Vendor A")?.verdict).toBe("FAILED");
    expect(view.recommendation?.chosenLabel).toBe("Vendor B");

    const { orderId } = await d.approveTwice(requestId);
    await payAccount(orderId);
    await until("HELD", async () => (await d.recheck(orderId), (await d.order(orderId)).status), (s) => s !== "AWAITING_PAYMENT");

    const s1 = await until("Stage 1 landed", async () => (await d.recheck(orderId), db().payout.findFirst({ where: { orderId, stage: "STAGE_1" }, orderBy: { createdAt: "desc" } })), (p) => p?.status === "SUCCESS");
    expect(s1?.amountKobo).toBe(37_800_000n);

    const code = await d.buyerCode(orderId);
    expect((await d.enterCode(orderId, requestId, code)).status).toBe(200);
    await until("COMPLETE", async () => (await d.recheck(orderId), (await d.order(orderId)).status), (s) => s === "COMPLETE");

    expect(await ledgerNet(orderId)).toBe(0n);
    expect(await heldBalance(orderId)).toBe(0n);
    await expectMoneyInvariants(orderId);
  });

  it("underpayment: Kora's re-queried amount decides, and the shortfall is shown", async () => {
    const d = new FlowDriver();
    await d.seedDirectory();
    const requestId = await d.createAndQuote();
    await d.verifyAndRecommend(requestId);
    const { orderId } = await d.approveTwice(requestId);
    await underpay(orderId);
    const o = await until("Kora's answer on the short payment", async () => (await d.recheck(orderId), d.order(orderId)), (v) => v.status !== "AWAITING_PAYMENT" || v.events.some((e) => e.name === "charge.underpaid"));
    // Kora's merchant preference decides: "Accept all" → UNDERPAID with the shortfall; "Return all" → nothing held.
    if (o.status === "UNDERPAID") expect(o.pay.shortfall).toBe("₦60,000");
    else expect(await heldBalance(orderId)).toBe(0n);
  });

  it("forced payout failure (035) → PAYOUT_FAILED → retry with a new reference", async () => {
    const d = new FlowDriver();
    await d.seedDirectory();
    const requestId = await d.createAndQuote();
    await d.verifyAndRecommend(requestId);
    const { orderId } = await d.approveTwice(requestId);
    await setSetting("payoutRoute", "SANDBOX_FAIL_035");
    await payAccount(orderId);
    await until("PAYOUT_FAILED", async () => (await d.recheck(orderId), (await d.order(orderId)).status), (s) => s === "PAYOUT_FAILED");
    await setSetting("payoutRoute", "VERIFIED_ACCOUNT");
    const r = await retryPayout(orderId, { type: "USER", id: "sandbox-test" });
    expect(r.kind).toBe("sent");
    const retried = await db().payout.findFirstOrThrow({ where: { orderId, retryOfId: { not: null } } });
    expect(retried.reference).toMatch(/-S1-R2$/);
  });
});
