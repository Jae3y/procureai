import type { Kobo } from "@/lib/money";

/**
 * A stage (30% or 70% of an order) larger than the payment provider's per-transfer maximum is paid as several
 * transfers, called parts. Parts are decided from the stage amount alone, so a retry or a second look always
 * produces exactly the same split.
 */

/** The largest order ProcureAI takes for now: NGN 100,000,000. Raise it deliberately, with the provider's written limits in hand. */
export const MAX_ORDER_KOBO: Kobo = 10_000_000_000n;
/** The database allows 1..50 parts; with a NGN 10,000,000 maximum that is far beyond NGN 100,000,000. */
export const MAX_PARTS = 50;

/**
 * Splits `stageKobo` into the fewest equal-as-possible parts that each fit `maxPartKobo`. The remainder goes
 * to the first parts one kobo at a time, so the parts always add up to exactly the stage amount.
 */
export function splitIntoParts(stageKobo: Kobo, maxPartKobo: Kobo): Kobo[] {
  if (stageKobo <= 0n) return [];
  const n = (stageKobo + maxPartKobo - 1n) / maxPartKobo; // a count, not money
  const count = Number(n);
  if (count > MAX_PARTS) throw new Error(`stage of ${stageKobo} kobo needs ${count} parts, over the maximum of ${MAX_PARTS}`);
  const base = stageKobo / n;
  const extra = stageKobo - base * n; // how many parts get one more kobo (a count, kept as bigint)
  return Array.from({ length: count }, (_, i) => (BigInt(i) < extra ? base + 1n : base));
}

/** The reference for a payout. Part 1, attempt 1 keeps the original format, so nothing already written changes. */
export function payoutReference(orderId: string, stageTag: "S1" | "S2", part: number, attempt: number): string {
  return `PO-${orderId}-${stageTag}${part > 1 ? `-P${part}` : ""}${attempt > 1 ? `-R${attempt}` : ""}`;
}

/** What has landed for a stage: the sum of its successful parts. */
export function paidForStage(payouts: ReadonlyArray<{ stage: string; status: string; amountKobo: Kobo }>, stage: "STAGE_1" | "STAGE_2"): Kobo {
  return payouts.filter((p) => p.stage === stage && p.status === "SUCCESS").reduce((a, p) => a + p.amountKobo, 0n);
}

/** The stage is paid only when every part has landed, never because one part has. */
export function stageIsPaid(payouts: ReadonlyArray<{ stage: string; status: string; amountKobo: Kobo }>, stage: "STAGE_1" | "STAGE_2", stageAmountKobo: Kobo): boolean {
  return paidForStage(payouts, stage) >= stageAmountKobo;
}
