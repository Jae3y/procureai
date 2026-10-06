import { RecordActions } from "@/components/record-actions";
import { PageMessage } from "@/components/states";
import { Logo } from "@/components/ui";
import { verifyRecordId } from "@/lib/crypto";
import { buildRecordView } from "@/lib/views/record-view";

export const dynamic = "force-dynamic";

/** 06 · Record — the shareable purchase record. Public behind a signed id. */
export default async function RecordPage({ params }: { params: Promise<{ signedId: string }> }) {
  const { signedId } = await params;
  const orderId = verifyRecordId(signedId);
  if (!orderId) return <PageMessage title="Record not found." body="This record link isn't valid. Ask whoever shared it for the full link." />;
  const r = await buildRecordView(orderId);
  const trailColor = r.complete ? "var(--green)" : "var(--pending)";

  return (
    <main className="page">
      <header className="header">
        <div className="header-in">
          <Logo />
        </div>
      </header>
      <section className="section" style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 72 }}>
        <div className="record-top">
          <span className="eyebrow" style={{ marginBottom: 0 }}>
            Purchase record
          </span>
          <RecordActions shareUrl={r.shareUrl} imagePath={`/r/${signedId}/image`} />
        </div>
        <article className="doc" aria-labelledby="record-title">
          <div className="doc-head">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="logo-mark" aria-hidden="true" style={{ display: "flex", alignItems: "center" }}>
                  <span className="d" style={{ width: 7, height: 7 }} />
                  <span className="b" style={{ width: 14 }} />
                  <span className="r" style={{ width: 7, height: 7 }} />
                </span>
                <span style={{ font: "700 17px/1 var(--font-display)", letterSpacing: "-0.03em" }}>ProcureAI</span>
              </div>
              <h2 id="record-title" style={{ margin: "28px 0 0", font: "600 clamp(36px,3.6vw,60px)/0.95 var(--font-display)", letterSpacing: "-0.045em" }}>
                {r.title}
              </h2>
            </div>
            <div className="doc-meta">
              {r.ref}
              <br />
              {r.dates}
              <br />
              Buyer: {r.buyer}
              <br />
              {r.statusLine}
            </div>
          </div>

          <div className="doc-sec">
            <span className="doc-label">1 · Request</span>
            <div style={{ font: "400 18px/1.5 var(--font-body)" }}>“{r.request}”</div>
          </div>

          <div className="doc-sec">
            <span className="doc-label">2 · Quotes</span>
            <div style={{ display: "grid", gap: 12, font: "500 15px/1.4 var(--font-mono)" }}>
              {r.quotes.map((q) => (
                <div key={q.label} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 110px 130px", gap: 12, color: q.status === "Chosen" ? undefined : "var(--muted)" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-body)",
                      fontWeight: q.status === "Chosen" ? 600 : 400,
                      textDecoration: q.struck ? "line-through" : undefined,
                      textDecorationColor: q.struck ? "var(--red)" : undefined,
                    }}
                  >
                    {q.label} · {q.name}
                  </span>
                  <span>{q.each}</span>
                  <span style={{ textAlign: "right", color: q.status === "Not verified" ? "var(--red)" : q.status === "Chosen" ? "var(--green)" : undefined }}>{q.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="doc-sec">
            <span className="doc-label">3 · Why {r.quotes.find((q) => q.status === "Chosen")?.label ?? "this vendor"}</span>
            <div style={{ display: "grid", gap: 10, font: "400 16px/1.55 var(--font-body)" }}>
              {r.why.length ? r.why.map((s) => <span key={s}>{s}</span>) : <span className="muted">No recommendation was recorded.</span>}
            </div>
          </div>

          <div className="doc-sec">
            <span className="doc-label">4 · Checks</span>
            <div style={{ display: "grid", gap: 10, font: "500 14px/1.4 var(--font-mono)" }}>
              {r.checks.map((c) => (
                <div key={`${c.text}${c.ref}`} style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 15 }}>
                    <span className={c.tone} aria-hidden="true">
                      {c.tone === "green" ? "✓ " : "✕ "}
                    </span>
                    {c.text}
                  </span>
                  <span className={c.tone}>{c.ref}</span>
                </div>
              ))}
              {r.simulatedIdentity ? (
                <span className="sim-badge" style={{ justifySelf: "start", marginTop: 6 }}>
                  SIMULATED IDENTITY
                </span>
              ) : null}
            </div>
          </div>

          <div className="doc-sec">
            <span className="doc-label">5 · Money</span>
            <div style={{ display: "grid", gap: 12 }}>
              {r.money.map((m) => (
                <div key={`${m.label}${m.ref}`} className="money-row">
                  <span style={{ fontFamily: "var(--font-body)" }}>{m.label}</span>
                  <span>{m.amount}</span>
                  <span className={m.tone === "ink" ? "" : m.tone}>{m.ref}</span>
                </div>
              ))}
              {r.heldForRefund ? (
                <div className="money-row">
                  <span style={{ fontFamily: "var(--font-body)" }}>Overpaid, held for refund to buyer</span>
                  <span>{r.heldForRefund}</span>
                  <span />
                </div>
              ) : null}
              <div className="money-row money-total">
                <span style={{ fontFamily: "var(--font-body)" }}>Left unaccounted</span>
                <span>{r.unaccounted}</span>
                <span />
              </div>
              {r.sandboxRoute ? (
                <p className="note" style={{ margin: 0, fontSize: 13 }}>
                  Sandbox: a payout was routed to Kora test account <span className="mono">{r.sandboxRoute}</span>.
                </p>
              ) : null}
            </div>
          </div>

          <div className="mini-trail">
            <div className="line" style={{ background: trailColor }} aria-hidden="true" />
            <div className="dots" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span key={i} style={{ background: trailColor }} />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 28, gap: 16, flexWrap: "wrap" }}>
              <span className="mono muted" style={{ fontSize: 13, overflowWrap: "anywhere" }}>
                Check this record at {r.shareUrl.replace(/^https?:\/\//, "")}
              </span>
              {r.stamp ? <span className="stamp green" style={{ fontSize: 12 }}>{r.stamp}</span> : <span className="mono muted" style={{ fontSize: 12 }}>IN PROGRESS</span>}
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}
