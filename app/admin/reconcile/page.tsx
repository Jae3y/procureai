import Link from "next/link";
import { AdminLogin } from "@/components/admin-console";
import { Logo } from "@/components/ui";
import { pageIsAdmin } from "@/lib/http/page-auth";
import { buildReconcileView } from "@/lib/views/reconcile-view";

export const dynamic = "force-dynamic";

const STATUS_COPY = {
  matched: { text: "✓ Matched", cls: "green" },
  "matched-with-fee": { text: "✓ Matched (fee)", cls: "green" },
  "amount-differs": { text: "✕ Amount differs", cls: "red" },
  preflight: { text: "Preflight test", cls: "muted" },
  unmatched: { text: "✕ Not ProcureAI's", cls: "red" },
} as const;

/** Reconciliation: Kora's balance history next to ProcureAI's ledger, unmatched rows flagged. */
export default async function ReconcilePage() {
  if (!(await pageIsAdmin())) return <AdminLogin />;
  const r = await buildReconcileView();
  return (
    <main className="page">
      <header className="header">
        <div className="header-in">
          <Logo />
          <nav style={{ display: "flex", gap: 20 }} aria-label="Admin">
            <Link href="/admin" className="btn-text">
              Overview
            </Link>
            <Link href="/admin/reconcile" className="btn-text" aria-current="page">
              Reconciliation
            </Link>
          </nav>
        </div>
      </header>
      <section className="admin">
        <h1>Reconciliation</h1>
        <p className="note">Kora&apos;s balance history, joined to ProcureAI&apos;s ledger by reference. Generated {r.generatedAt}.</p>
        <div className="grid-2" style={{ marginTop: 24 }}>
          <div className="panel">
            <div className="label">Kora balance (NGN)</div>
            {r.kora.error ? (
              <p className="error-line">{r.kora.error}</p>
            ) : (
              <div className="held-big" style={{ fontSize: 40, marginTop: 12 }}>
                {r.kora.available ?? "—"}
                <span className="note" style={{ fontSize: 14 }}>
                  available · {r.kora.pending ?? "—"} pending
                </span>
              </div>
            )}
          </div>
          <div className="panel">
            <div className="label">ProcureAI holds for buyers</div>
            <div className="held-big amber" style={{ fontSize: 40, marginTop: 12 }}>
              {r.ours.heldForBuyers}
              <span className="note" style={{ fontSize: 14 }}>
                across {r.ours.ordersOpen} open order{r.ours.ordersOpen === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          <div className="panel">
            <div className="label">Match</div>
            <p className="body-lg" style={{ margin: "12px 0 0", fontSize: 18 }}>
              <span className="green">{r.counts.matched} matched</span> · <span className={r.counts.unmatched ? "red" : ""}>{r.counts.unmatched} unexplained at Kora</span> ·{" "}
              <span className={r.counts.notSeenAtKora ? "amber" : ""}>{r.counts.notSeenAtKora} of ours not in Kora&apos;s history yet</span>
            </p>
          </div>
        </div>

        <h2>Kora balance history</h2>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>When</th>
                <th>Direction</th>
                <th>Amount</th>
                <th>Before → After</th>
                <th>Kora source</th>
                <th>ProcureAI</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    {r.kora.error ? "Kora's history couldn't be loaded." : "Kora reports no balance movements yet."}
                  </td>
                </tr>
              ) : (
                r.lines.map((l, i) => {
                  const s = STATUS_COPY[l.status];
                  return (
                    <tr key={l.pointer ?? `${l.sourceReference}-${i}`} className={l.status === "unmatched" || l.status === "amount-differs" ? "bad" : undefined}>
                      <td className="mono">{l.when}</td>
                      <td>{l.direction === "credit" ? "In" : "Out"}</td>
                      <td className="mono">{l.amount}</td>
                      <td className="mono">
                        {l.balanceBefore} → {l.balanceAfter}
                      </td>
                      <td className="mono">
                        {l.source} · {l.sourceReference}
                        <div className="muted" style={{ fontFamily: "var(--font-body)", fontSize: 12 }}>
                          {l.description}
                        </div>
                      </td>
                      <td className="mono">
                        {l.match ? (
                          <>
                            {l.match.order} · {l.match.kind.toLowerCase()} · {l.match.ours}
                            <div style={{ fontSize: 12 }}>{l.match.reference}</div>
                            {l.match.note ? <div className="muted" style={{ fontSize: 12 }}>{l.match.note}</div> : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <span className={`pill ${s.cls}`}>{s.text}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <h2>ProcureAI ledger (settled movements)</h2>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Order</th>
                <th>Kind</th>
                <th>Reference</th>
                <th>Amount</th>
                <th>Seen in Kora&apos;s history</th>
              </tr>
            </thead>
            <tbody>
              {r.ourLines.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No settled pay-ins, payouts or refunds yet.
                  </td>
                </tr>
              ) : (
                r.ourLines.map((l) => (
                  <tr key={l.reference}>
                    <td className="mono">{l.order}</td>
                    <td>{l.kind.toLowerCase()}</td>
                    <td className="mono">{l.reference}</td>
                    <td className="mono">{l.amount}</td>
                    <td>{l.seenAtKora ? <span className="green">✓ Yes</span> : <span className="amber">Not yet</span>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
