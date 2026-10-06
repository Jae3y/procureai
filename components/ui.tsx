"use client";

import Link from "next/link";
import type { KoraRow } from "@/lib/views/request-view";
import type { TrailNode } from "@/lib/views/order-view";

/** Shared pieces of the handoff's visual language. */

export const STEPS = ["Request", "Quotes", "Decision", "Pay", "Track", "Record"] as const;
export type Step = (typeof STEPS)[number];

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="logo" aria-label="ProcureAI home">
      <span className="logo-mark" aria-hidden="true">
        <span className="d" />
        <span className="b" />
        <span className="r" />
      </span>
      <span className="logo-word">ProcureAI</span>
    </Link>
  );
}

/**
 * Header step nav: past steps filled ink, current outlined ink, future outlined #B9B3A5.
 * A step is clickable only when the purchase has reached it.
 */
export function Header({
  current,
  reached,
  onStep,
  refLabel,
  initials = "TA",
}: {
  current: Step;
  reached: number;
  onStep?: (s: Step) => void;
  refLabel?: string | null;
  initials?: string;
}) {
  const sc = STEPS.indexOf(current);
  return (
    <header className="header">
      <div className="header-in">
        <Logo />
        <nav className="steps" aria-label="Purchase steps">
          {STEPS.map((label, i) => {
            const past = i < sc;
            const here = i === sc;
            const enabled = Boolean(onStep) && i <= reached && !here;
            return (
              <div className="step" key={label}>
                {i > 0 && <span className="step-line" style={{ background: i <= sc ? "var(--ink)" : "var(--hairline)" }} aria-hidden="true" />}
                <button
                  type="button"
                  className="step-btn"
                  disabled={!enabled}
                  aria-current={here ? "step" : undefined}
                  onClick={() => onStep?.(label)}
                  style={{ color: here ? "var(--ink)" : "var(--muted)" }}
                >
                  <span
                    className="step-dot"
                    aria-hidden="true"
                    style={{ borderColor: i <= sc ? "var(--ink)" : "var(--future)", background: past ? "var(--ink)" : "transparent" }}
                  />
                  <span className="step-label">{label}</span>
                  <span className="sr-only">{past ? " (done)" : here ? " (current)" : " (not yet)"}</span>
                </button>
              </div>
            );
          })}
        </nav>
        <div className="header-right">
          {refLabel ? <span className="header-ref">{refLabel}</span> : null}
          <span className="avatar" aria-label="Buyer">
            {initials}
          </span>
        </div>
      </div>
    </header>
  );
}

function SigBadge({ signature }: { signature: KoraRow["signature"] }) {
  if (signature === "VERIFIED") return <span className="badge badge-sig">✓ Signature verified</span>;
  if (signature === "INVALID") return <span className="badge badge-bad">✕ Signature invalid</span>;
  if (signature === "SIMULATED") return <span className="badge badge-sim">Simulated identity</span>;
  if (signature === "API") return <span className="badge badge-api">Kora API</span>;
  return null;
}

/** The Kora events panel — the only dark surface. Newest at the bottom, rows rise in. */
export function KoraPanel({ rows, connection }: { rows: KoraRow[]; connection: "live" | "reconnecting" }) {
  return (
    <aside className="kora" aria-label="Kora events">
      <div className="kora-head">
        <span className="kora-title">Kora events</span>
        <span className={`kora-live${connection === "live" ? "" : " off"}`} role="status">
          <i aria-hidden="true" />
          {connection === "live" ? "Live" : "Reconnecting…"}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="kora-empty">Nothing from Kora yet. Events appear here as Kora reports them.</div>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((e) => (
            <li key={e.id} className={`krow${e.signature === "INVALID" ? " invalid" : ""}`}>
              <span className="krow-time">{e.time}</span>
              <div>
                <div className="krow-top">
                  <span>{e.name}</span>
                  <span style={{ whiteSpace: "nowrap" }}>{e.amount}</span>
                </div>
                {e.detail ? <div className="krow-detail">{e.detail}</div> : null}
                <div className="krow-foot">
                  <span className="krow-ref">{e.ref}</span>
                  <SigBadge signature={e.signature} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

const NODE_STATE_TEXT: Record<TrailNode["state"], string> = { done: "Done", held: "Held", failed: "Failed", pending: "Not yet" };

/** The Money Trail. The line only extends to nodes Kora has confirmed. */
export function MoneyTrail({ nodes, step }: { nodes: TrailNode[]; step: number }) {
  const frac = Math.max(0, Math.min(step, nodes.length - 1)) / (nodes.length - 1);
  return (
    <div className="trail">
      <div className="trail-track" aria-hidden="true" />
      <div className="trail-prog" aria-hidden="true" style={{ width: `calc((100% - 100% / 6) * ${frac})` }} />
      <ol className="trail-nodes" style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Money trail">
        {nodes.map((n) => {
          const tone = n.state === "failed" ? "red" : n.state === "held" ? "amber" : "green";
          return (
            <li key={n.key} className={`tnode ${n.state}`}>
              <span className="tdot" aria-hidden="true">
                <i />
              </span>
              <div className="tlabel">{n.label}</div>
              <div className="tamount">{n.amount}</div>
              <div className="tstate">{NODE_STATE_TEXT[n.state]}</div>
              <div className="tstamp">
                {n.stamp && n.state !== "pending" ? <span className={`stamp sm press ${tone}`}>{n.stamp}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function Toast({ message, tone = "ink", onDone }: { message: string | null; tone?: "ink" | "err"; onDone?: () => void }) {
  if (!message) return null;
  return (
    <div className={`toast${tone === "err" ? " err" : ""}`} role={tone === "err" ? "alert" : "status"} onAnimationEnd={() => setTimeout(() => onDone?.(), 4000)}>
      {message}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <span className="spin" aria-hidden="true" />
      {label}
    </span>
  );
}
