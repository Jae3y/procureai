import type { Kobo } from "@/lib/money";

type Money = { amountKobo: bigint; status: string };
type Ledger = { account: string; direction: string; amountKobo: bigint };

export type MoneySummary = { paidIn: Kobo; paidOut: Kobo; refunded: Kobo; held: Kobo; fees: Kobo; unaccounted: Kobo };

/**
 * Every kobo Kora accepted is paid out, refunded, still held, or kept as ProcureAI's fee; anything else is a defect.
 * One calculation, shared by the purchase record and the admin reconciliation, so they always agree.
 */
export function moneySummary(order: { amountAcceptedKobo: bigint; payouts: Money[]; refunds: Money[]; ledger: Ledger[] }): MoneySummary {
  const held = order.ledger.filter((l) => l.account === "HELD").reduce((a, l) => a + (l.direction === "CREDIT" ? l.amountKobo : -l.amountKobo), 0n);
  const paidOut = order.payouts.filter((p) => p.status === "SUCCESS").reduce((a, p) => a + p.amountKobo, 0n);
  const refunded = order.refunds.filter((r) => r.status === "SUCCESS").reduce((a, r) => a + r.amountKobo, 0n);
  const fees = order.ledger.filter((l) => l.account === "FEE").reduce((a, l) => a + (l.direction === "CREDIT" ? l.amountKobo : -l.amountKobo), 0n);
  return { paidIn: order.amountAcceptedKobo, paidOut, refunded, held, fees, unaccounted: order.amountAcceptedKobo - paidOut - refunded - held - fees };
}
