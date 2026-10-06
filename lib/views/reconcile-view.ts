import { db } from "@/lib/db";
import { kora } from "@/lib/kora/client";
import { isKoraError } from "@/lib/kora/errors";
import type { BalanceHistoryEntry } from "@/lib/kora/schemas";
import { formatNaira, type Kobo } from "@/lib/money";
import { lagosDay, lagosTime, orderRef } from "./format";

/**
 * RECONCILIATION — Kora's own balance history next to ProcureAI's ledger. Each Kora movement is
 * matched to the PayIn / Payout / Refund that caused it (by reference — ours, or Kora's payment
 * reference, or a reference quoted in Kora's description). Anything Kora moved that we can't
 * explain, and anything we booked that Kora hasn't moved, is flagged.
 */

export type KoraLine = {
  pointer: string | null;
  when: string;
  direction: "credit" | "debit";
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  source: string;
  sourceReference: string;
  description: string;
  match: { kind: "PAYIN" | "PAYOUT" | "REFUND"; reference: string; order: string; ours: string; note: string | null } | null;
  status: "matched" | "matched-with-fee" | "amount-differs" | "preflight" | "unmatched";
};

export type OurLine = { order: string; orderId: string; kind: "PAYIN" | "PAYOUT" | "REFUND"; reference: string; amount: string; seenAtKora: boolean; status: string };

export type ReconcileView = {
  generatedAt: string;
  kora: { available: string | null; pending: string | null; error: string | null };
  ours: { heldForBuyers: string; ordersOpen: number };
  lines: KoraLine[];
  ourLines: OurLine[];
  counts: { matched: number; unmatched: number; notSeenAtKora: number };
};

type Ref = { kind: "PAYIN" | "PAYOUT" | "REFUND"; reference: string; aliases: string[]; orderId: string; orderNumber: number; amountKobo: Kobo; feeKobo: Kobo | null; status: string };

function aliasesFrom(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const data = (raw as { data?: unknown }).data;
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  return ["payment_reference", "refund_reference", "reference"].map((k) => d[k]).filter((v): v is string => typeof v === "string");
}

export async function buildReconcileView(): Promise<ReconcileView> {
  const [payIns, payouts, refunds, held] = await Promise.all([
    db().payIn.findMany({ include: { order: { select: { number: true } } } }),
    db().payout.findMany({ include: { order: { select: { number: true } } } }),
    db().refund.findMany({ include: { order: { select: { number: true } } } }),
    db().ledgerEntry.findMany({ where: { account: "HELD" } }),
  ]);
  const refs: Ref[] = [
    ...payIns.map((p) => ({ kind: "PAYIN" as const, reference: p.reference, aliases: aliasesFrom(p.koraResponse), orderId: p.orderId, orderNumber: p.order.number, amountKobo: p.amountAcceptedKobo, feeKobo: p.feeKobo, status: p.status })),
    ...payouts.map((p) => ({ kind: "PAYOUT" as const, reference: p.reference, aliases: aliasesFrom(p.koraResponse), orderId: p.orderId, orderNumber: p.order.number, amountKobo: p.amountKobo, feeKobo: p.feeKobo, status: p.status })),
    ...refunds.map((r) => ({ kind: "REFUND" as const, reference: r.reference, aliases: aliasesFrom(r.koraResponse), orderId: r.orderId, orderNumber: r.order.number, amountKobo: r.amountKobo, feeKobo: null, status: r.status })),
  ];
  const byRef = new Map<string, Ref>();
  for (const r of refs) for (const k of [r.reference, ...r.aliases]) byRef.set(k, r);

  let entries: BalanceHistoryEntry[] = [];
  let available: string | null = null;
  let pending: string | null = null;
  let error: string | null = null;
  try {
    const [hist, bal] = await Promise.all([kora().getBalanceHistory({ limit: 50 }), kora().getBalances()]);
    entries = hist.data.entries;
    const ngn = bal.data.NGN;
    available = ngn ? formatNaira(ngn.available_balance) : null;
    pending = ngn ? formatNaira(ngn.pending_balance) : null;
    if (hist.data.hasMore && entries.length) {
      const more = await kora().getBalanceHistory({ limit: 50, startingAfter: entries.at(-1)?.pointer ?? undefined });
      entries = [...entries, ...more.data.entries];
    }
  } catch (err) {
    if (!isKoraError(err)) throw err;
    error = err.userMessage;
  }

  const seen = new Set<string>();
  const lines: KoraLine[] = entries.map((e) => {
    const candidates = [e.source_reference ?? "", ...(e.description?.match(/[A-Z]{2,4}-[A-Za-z0-9-]{6,}/g) ?? [])];
    const ref = candidates.map((c) => byRef.get(c)).find(Boolean);
    const base = {
      pointer: e.pointer ?? null,
      when: e.date ? `${lagosDay(new Date(e.date.replace(" ", "T") + "Z"))} ${lagosTime(new Date(e.date.replace(" ", "T") + "Z"))}` : "",
      direction: e.direction,
      amount: formatNaira(e.amount),
      balanceBefore: formatNaira(e.balance_before),
      balanceAfter: formatNaira(e.balance_after),
      source: e.source ?? "",
      sourceReference: e.source_reference ?? "",
      description: e.description ?? "",
    };
    if (!ref) {
      const preflight = candidates.some((c) => c.startsWith("PF-"));
      return { ...base, match: null, status: preflight ? "preflight" : "unmatched" };
    }
    seen.add(ref.reference);
    const fee = ref.feeKobo ?? 0n;
    const exact = e.amount === ref.amountKobo;
    const withFee = !exact && fee > 0n && (e.amount === ref.amountKobo - fee || e.amount === ref.amountKobo + fee);
    return {
      ...base,
      match: {
        kind: ref.kind,
        reference: ref.reference,
        order: orderRef(ref.orderNumber),
        ours: formatNaira(ref.amountKobo),
        note: withFee ? `Kora fee ${formatNaira(fee)} (ProcureAI's cost)` : exact ? null : "Amounts differ",
      },
      status: exact ? "matched" : withFee ? "matched-with-fee" : "amount-differs",
    };
  });

  const ourLines: OurLine[] = refs
    .filter((r) => r.status === "SUCCESS")
    .map((r) => ({
      order: orderRef(r.orderNumber),
      orderId: r.orderId,
      kind: r.kind,
      reference: r.reference,
      amount: formatNaira(r.amountKobo),
      seenAtKora: seen.has(r.reference),
      status: r.status.toLowerCase(),
    }));

  const heldTotal = held.reduce((a, l) => a + (l.direction === "CREDIT" ? l.amountKobo : -l.amountKobo), 0n);
  const openOrders = await db().order.count({ where: { status: { notIn: ["COMPLETE", "REFUNDED"] } } });
  return {
    generatedAt: lagosTime(new Date()),
    kora: { available, pending, error },
    ours: { heldForBuyers: formatNaira(heldTotal), ordersOpen: openOrders },
    lines,
    ourLines,
    counts: {
      matched: lines.filter((l) => l.match).length,
      unmatched: lines.filter((l) => l.status === "unmatched").length,
      notSeenAtKora: ourLines.filter((l) => !l.seenAtKora).length,
    },
  };
}
