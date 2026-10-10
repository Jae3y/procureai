import type { Kobo } from "@/lib/money";

type Money = { amountKobo: bigint; status: string };
type Ledger = { account: string; direction: string; amountKobo: bigint };

export type MoneySummary = { paidIn: Kobo; paidOut: Kobo; refunded: Kobo; held: Kobo; unaccounted: Kobo };

/**
 * Every kobo Kora accepted is paid out, refunded, or still held; anything else is a defect.
 * One calculation, shared by the purchase record and the admin reconciliation, so they always agree.
 */
export function moneySummary(order: { amountAcceptedKobo: bigint; payouts: Money[]; refunds: Money[]; ledger: Ledger[] }): MoneySummary {
  const held = order.ledger.filter((l) => l.account === "HELD").reduce((a, l) => a + (l.direction === "CREDIT" ? l.amountKobo : -l.amountKobo), 0n);
  const paidOut = order.payouts.filter((p) => p.status === "SUCCESS").reduce((a, p) => a + p.amountKobo, 0n);
  const refunded = order.refunds.filter((r) => r.status === "SUCCESS").reduce((a, r) => a + r.amountKobo, 0n);
  return { paidIn: order.amountAcceptedKobo, paidOut, refunded, held, unaccounted: order.amountAcceptedKobo - paidOut - refunded - held };
}
