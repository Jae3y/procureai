import { db } from "@/lib/db";
import { ensureOpenPayIn, reconcileCharge } from "@/lib/domain/payin";
import { dispatchStage, reconcilePayout } from "@/lib/domain/payouts";
import { reconcileRefund } from "@/lib/domain/refunds";
import { isKoraError } from "@/lib/kora/errors";
import { log } from "@/lib/log";

/**
 * Reconciliation poller — the safety net under webhooks. Uses the exact same entry points as the
 * webhook worker and the Re-check button, so a missing, late or duplicated webhook converges to the
 * same state.
 *
 *  • charges still PROCESSING 20s after the account was opened → GET /charges/:reference
 *  • payouts still PENDING 30s after they were created        → GET /transactions/:reference
 *  • self-heal: money HELD with no Stage 1 payout, a verified code with no Stage 2 payout, or an
 *    underpaid order with no open account → redo the follow-up that a crash may have skipped
 */

const CHARGE_AGE_MS = 20_000;
const PAYOUT_AGE_MS = 5_000; // ask Kora about a payout 5 s after sending it; the webhook usually beats us
const REQUERY_GAP_MS = 10_000;
const SELF_HEAL_GAP_MS = 60_000;
const APPROVE_GRACE_MS = 30_000;

export type PollReport = { charges: number; payouts: number; refunds: number; healed: number; errors: number };

function describe(err: unknown): string {
  return isKoraError(err) ? `${err.name}: ${err.message}` : err instanceof Error ? err.message : String(err);
}

export async function pollOnce(now = new Date()): Promise<PollReport> {
  const report: PollReport = { charges: 0, payouts: 0, refunds: 0, healed: 0, errors: 0 };
  const cause = { type: "POLLER" as const, id: `poll@${now.toISOString()}` };

  const staleCharges = await db().payIn.findMany({
    where: {
      status: "PROCESSING",
      createdAt: { lt: new Date(now.getTime() - CHARGE_AGE_MS) },
      OR: [{ lastQueriedAt: null }, { lastQueriedAt: { lt: new Date(now.getTime() - REQUERY_GAP_MS) } }],
      order: { status: { in: ["AWAITING_PAYMENT", "UNDERPAID"] } },
    },
    select: { reference: true, orderId: true },
    take: 25,
  });
  for (const c of staleCharges) {
    try {
      await reconcileCharge(c.reference, cause);
      report.charges++;
    } catch (err) {
      report.errors++;
      log.warn({ reference: c.reference, orderId: c.orderId, err: describe(err) }, "poller: charge re-query failed; will retry next tick");
    }
  }

  const stalePayouts = await db().payout.findMany({
    where: {
      status: "PENDING",
      createdAt: { lt: new Date(now.getTime() - PAYOUT_AGE_MS) },
      updatedAt: { lt: new Date(now.getTime() - REQUERY_GAP_MS) },
    },
    select: { reference: true, orderId: true, id: true },
    take: 25,
  });
  for (const p of stalePayouts) {
    try {
      await reconcilePayout(p.reference, cause);
      // Touch updatedAt so the next tick waits REQUERY_GAP_MS before asking again.
      await db().payout.update({ where: { id: p.id }, data: { updatedAt: new Date() } });
      report.payouts++;
    } catch (err) {
      report.errors++;
      log.warn({ reference: p.reference, orderId: p.orderId, err: describe(err) }, "poller: payout re-query failed; will retry next tick");
    }
  }

  const staleRefunds = await db().refund.findMany({
    where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - PAYOUT_AGE_MS) } },
    select: { reference: true, orderId: true },
    take: 10,
  });
  for (const r of staleRefunds) {
    try {
      await reconcileRefund(r.reference, cause);
      report.refunds++;
    } catch (err) {
      report.errors++;
      log.warn({ reference: r.reference, orderId: r.orderId, err: describe(err) }, "poller: refund re-query failed; will retry next tick");
    }
  }

  report.healed += await selfHeal(now);
  return report;
}

async function recentlyAttempted(orderId: string, now: Date): Promise<boolean> {
  const last = await db().orderEvent.findFirst({
    where: { orderId, kind: { in: ["error", "state"] }, createdAt: { gt: new Date(now.getTime() - SELF_HEAL_GAP_MS) } },
    select: { id: true },
  });
  return Boolean(last);
}

async function selfHeal(now: Date): Promise<number> {
  let healed = 0;
  const cause = { type: "SYSTEM" as const, id: "self-heal" };

  const heldNoStage1 = await db().order.findMany({
    where: { status: "HELD", payouts: { none: { stage: "STAGE_1", status: { not: "FAILED" } } } },
    select: { id: true },
    take: 10,
  });
  const codeNoStage2 = await db().order.findMany({
    where: { status: "CODE_VERIFIED", payouts: { none: { stage: "STAGE_2", status: { not: "FAILED" } } } },
    select: { id: true },
    take: 10,
  });
  // Approved, but Kora never gave us an account (a network blip during approve). The buyer would
  // wait on "opening" forever, so open it again. The age gap keeps this off an approve still in flight.
  const approvedNoAccount = await db().order.findMany({
    where: {
      status: "CREATED",
      createdAt: { lt: new Date(now.getTime() - APPROVE_GRACE_MS) },
      payIns: { none: { status: "PROCESSING" } },
    },
    select: { id: true, amountKobo: true },
    take: 10,
  });
  const instalmentNoAccount = await db().order.findMany({
    where: { status: "AWAITING_PAYMENT", amountAcceptedKobo: { gt: 0 }, payIns: { none: { status: "PROCESSING" } } },
    select: { id: true, amountKobo: true, amountAcceptedKobo: true },
    take: 10,
  });
  const underpaidNoAccount = await db().order.findMany({
    where: { status: "UNDERPAID", payIns: { none: { status: "PROCESSING" } } },
    select: { id: true, amountKobo: true, amountAcceptedKobo: true },
    take: 10,
  });

  const jobs: Array<{ orderId: string; run: () => Promise<unknown> }> = [
    ...approvedNoAccount.map((o) => ({
      orderId: o.id,
      run: () => ensureOpenPayIn(o.id, o.amountKobo, "initial", cause),
    })),
    ...heldNoStage1.map((o) => ({ orderId: o.id, run: () => dispatchStage(o.id, "STAGE_1", cause) })),
    ...codeNoStage2.map((o) => ({ orderId: o.id, run: () => dispatchStage(o.id, "STAGE_2", cause) })),
    ...instalmentNoAccount.map((o) => ({
      orderId: o.id,
      run: () => ensureOpenPayIn(o.id, o.amountKobo - o.amountAcceptedKobo, "instalment", cause),
    })),
    ...underpaidNoAccount.map((o) => ({
      orderId: o.id,
      run: () => ensureOpenPayIn(o.id, o.amountKobo - o.amountAcceptedKobo, "top-up", cause),
    })),
  ];
  for (const job of jobs) {
    if (await recentlyAttempted(job.orderId, now)) continue;
    try {
      await job.run();
      healed++;
    } catch (err) {
      log.warn({ orderId: job.orderId, err: describe(err) }, "self-heal step failed; will retry");
    }
  }
  return healed;
}
