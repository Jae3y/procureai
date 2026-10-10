"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { CheckRow, RequestView } from "@/lib/views/request-view";
import { useAction, useLive } from "./hooks";
import { Header, type Step, Spinner } from "./ui";

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const countWord = (n: number) => WORDS[n] ?? String(n);

function stepFor(v: RequestView): Step {
  if (v.status === "DRAFT" || v.status === "CANCELLED") return "Request";
  if (v.status === "COLLECTING") return "Quotes";
  return "Decision";
}
const STEP_INDEX: Record<string, number> = { Request: 0, Quotes: 1, Decision: 2 };

export function RequestFlow({ initial, initials }: { initial: RequestView; initials: string }) {
  const router = useRouter();
  const { data: v, connection } = useLive<RequestView>(`/api/requests/${initial.id}/stream`, initial);
  const auto = stepFor(v);
  const [viewing, setViewing] = useState<Step | null>(null);
  const step = viewing && STEP_INDEX[viewing]! <= STEP_INDEX[auto]! ? viewing : auto;

  useEffect(() => {
    if (v.orderId) router.push(`/orders/${v.orderId}`);
  }, [v.orderId, router]);
  useEffect(() => setViewing(null), [auto]);

  return (
    <main className="page">
      <Header current={step} reached={STEP_INDEX[auto] ?? 0} onStep={(s) => setViewing(s)} refLabel={v.orderRef} initials={initials} />
      {connection === "reconnecting" ? (
        <p className="sr-only" role="status">
          Reconnecting to live updates
        </p>
      ) : null}
      {step === "Request" ? <SubmittedRequest v={v} /> : step === "Quotes" ? <Quotes v={v} /> : <Decision v={v} />}
    </main>
  );
}

function SubmittedRequest({ v }: { v: RequestView }) {
  const invite = useAction(`/api/requests/${v.id}/invite`);
  const chips = [
    { label: "Item", value: v.spec.item, mono: false },
    { label: "Quantity", value: v.spec.quantity, mono: true },
    { label: "Budget", value: v.spec.budget, mono: true },
    { label: "Deadline", value: v.spec.deadline, mono: false },
  ];
  const canInvite = v.status === "DRAFT";
  return (
    <section className="request" aria-labelledby="your-request">
      <div id="your-request" className="eyebrow rise">
        Your request
      </div>
      <div className="quote-of-request rise">“{v.rawText}”</div>
      <div className="chips">
        {chips.map((c, i) => (
          <div key={c.label} className="chip" style={{ animationDelay: `${150 * (i + 1)}ms` }}>
            <div className="label">{c.label}</div>
            <div className={`chip-value${c.mono ? " mono" : ""}`}>{c.value}</div>
          </div>
        ))}
      </div>
      <div className="request-foot rise" style={{ borderTop: 0, animationDelay: "900ms" }}>
        <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
          <span className="body-lg muted" style={{ fontSize: 18 }}>
            {v.status === "CANCELLED"
              ? "This request was closed."
              : `ProcureAI searched ${v.directoryTotal} vendors and will ask the ${v.directoryCount} that match this order.`}
            <span className="parsed-by">read by {v.specParsedBy === "AI" ? "AI" : "rules"}</span>
          </span>
          <Link className="btn-text" href={`/buy?text=${encodeURIComponent(v.rawText)}`}>
            Edit
          </Link>
        </div>
        {canInvite ? (
          <button type="button" className="btn" disabled={invite.pending || v.directoryCount === 0} onClick={() => void invite.run()}>
            {invite.pending ? <Spinner label="Asking vendors" /> : <>Ask vendors <span className="arrow">→</span></>}
          </button>
        ) : null}
      </div>
      <div aria-live="polite">{invite.error ? <p className="form-error">{invite.error.message}</p> : null}</div>
    </section>
  );
}

function Quotes({ v }: { v: RequestView }) {
  const verify = useAction(`/api/requests/${v.id}/verify`);
  const recommend = useAction(`/api/requests/${v.id}/recommend`);
  const [phase, setPhase] = useState<"idle" | "checking" | "ranking">("idle");
  const waiting = v.quotes.length === 0;
  const busy = phase !== "idle";
  const error = verify.error ?? recommend.error;

  const check = async () => {
    setPhase("checking");
    const a = await verify.run();
    if (a.ok) {
      setPhase("ranking");
      await recommend.run();
    }
    setPhase("idle");
  };

  return (
    <section className="section" aria-labelledby="quotes-title">
      <div className="quotes-head">
        <div>
          <div className="eyebrow">Quotes · {v.itemLine}</div>
          <h1 id="quotes-title" className="headline">
            {waiting ? "Waiting for vendors to reply." : `${countWord(v.quotes.length)} repl${v.quotes.length === 1 ? "y" : "ies"}. One format.`}
          </h1>
        </div>
        <div className="quotes-meta">
          Invited {v.invitedCount} vendor{v.invitedCount === 1 ? "" : "s"}
          {v.invitedAt ? ` · ${v.invitedAt}` : ""}
          <br />
          {v.repliedCount} of {v.invitedCount} replied
        </div>
      </div>

      {waiting ? (
        <div className="waiting">
          <div>
            <p className="body-lg" style={{ margin: 0, maxWidth: "30ch" }}>
              Most vendors reply within an hour. Their replies appear here as they arrive.
            </p>
            <p className="note" style={{ marginTop: 24, maxWidth: "36ch" }}>
              You can close this page. Nothing is paid until you approve a vendor.
            </p>
          </div>
          <div role="status">
            <div className="wait-row">
              <span className="dot breathe" aria-hidden="true" />
              <span className="mono muted" style={{ fontSize: 16 }}>
                Waiting · {v.invitedCount} invitation{v.invitedCount === 1 ? "" : "s"} out
              </span>
            </div>
            <div className="wait-row" />
            <div className="wait-row" />
          </div>
        </div>
      ) : (
        <>
          <div className="qgrid" style={{ paddingBottom: 16 }}>
            <div className="label">As they wrote it</div>
            <div className="qhead-gap" />
            <div className="qcols label">
              <span>As ProcureAI reads it</span>
              <span>Each</span>
              <span>Total</span>
              <span>Upfront</span>
              <span>Ready</span>
            </div>
          </div>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {v.quotes.map((q, i) => (
              <li key={q.id} className="qgrid qrow">
                <div style={{ padding: "32px 0" }}>
                  <div className="qraw-meta">
                    <span>{q.phone}</span>
                    <span>{q.time}</span>
                  </div>
                  <div className="qraw">{q.raw}</div>
                </div>
                <div className="conn" aria-hidden="true">
                  <span className="a" />
                  <span className="l" style={{ animationDelay: `${i * 380}ms` }} />
                  <span className="r" style={{ animationDelay: `${i * 380 + 500}ms` }} />
                </div>
                <div className="qcols qclean" style={{ animationDelay: `${i * 380 + 500}ms` }}>
                  <div>
                    <div className="qtag">
                      {q.label}
                      <span className="parsed-by">{q.parsedBy === "AI" ? "AI" : "rules"}</span>
                    </div>
                    <div className="qname">{q.name}</div>
                    {q.note ? <div className="qnote">{q.note}</div> : null}
                  </div>
                  <span className="qnum">{q.each}</span>
                  <span className="qnum">{q.total}</span>
                  <span className="qnum">{q.upfront}</span>
                  <span className="qready">{q.ready}</span>
                </div>
              </li>
            ))}
          </ol>
          <div className="qfoot">
            <p className="note" style={{ margin: 0, maxWidth: "62ch" }}>
              Prices are for {v.spec.quantity} pieces. Whatever a vendor asks upfront, ProcureAI pays 30% once your money is held and 70% on delivery.
              {v.repliedCount < v.invitedCount
                ? ` ${v.invitedCount - v.repliedCount} vendor${v.invitedCount - v.repliedCount === 1 ? " hasn't" : "s haven't"} replied yet: you can check these ${v.repliedCount} now and add later replies.`
                : ""}
            </p>
            <button type="button" className="btn" disabled={busy} onClick={() => void check()}>
              {phase === "checking" ? (
                <Spinner label="Checking with Kora" />
              ) : phase === "ranking" ? (
                <Spinner label="Comparing quotes" />
              ) : (
                <>Check {v.repliedCount === 1 ? "this vendor" : `these ${v.repliedCount} vendors`} with Kora <span className="arrow">→</span></>
              )}
            </button>
          </div>
          <div aria-live="polite">{error ? <p className="form-error">{error.message}</p> : null}</div>
        </>
      )}
    </section>
  );
}

function VendorRow({ c, index, simulated }: { c: CheckRow; index: number; simulated: boolean }) {
  const failed = c.verdict === "FAILED";
  const num = String(index + 1).padStart(2, "0");
  return (
    <li className={`vrow${failed ? " failed" : ""}${c.chosen ? " chosen" : ""}`}>
      <div className="vrow-grid">
        <span className="vrow-num">{num}</span>
        <div>
          <div className="qtag" style={{ color: c.chosen ? "var(--green)" : undefined, marginBottom: 10 }}>
            {c.label}
            {c.chosen ? " · Recommended" : ""}
          </div>
          <div className="vrow-name" style={{ color: !c.chosen && !failed ? "var(--muted)" : undefined }}>
            {c.name}
          </div>
        </div>
        <div>
          <div className="vrow-each">{c.each}</div>
          <div className="vrow-total">{c.total}</div>
        </div>
      </div>
      {failed ? (
        <>
          <span className="strike" aria-hidden="true" />
          <div style={{ margin: "28px 0 0 64px", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            <span className="fail-stamp">✕ {c.failureReason}</span>
            <span className="mono red" style={{ fontSize: 13, animation: "riseIn 500ms 900ms both" }}>
              KORA · {c.cacReference ?? c.rcNumber} · {c.registeredName ? "Not matched" : "Not found"}
            </span>
          </div>
        </>
      ) : c.chosen ? (
        <div className="vfacts">
          <div className="vfact" style={{ animationDelay: "700ms" }}>
            <span className="green" aria-hidden="true">✓</span>
            <span>
              Registered as {c.registeredName}{" "}
              <span className="mono muted" style={{ fontSize: 14 }}>
                {c.rcNumber}
              </span>
            </span>
          </div>
          <div className="vfact" style={{ animationDelay: "820ms" }}>
            <span className="green" aria-hidden="true">✓</span>
            <span>
              Status: <span className="green">{c.companyStatus}</span>
            </span>
          </div>
          <div className="vfact" style={{ animationDelay: "940ms" }}>
            <span className="green" aria-hidden="true">✓</span>
            <span>{c.ownerLine}</span>
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <span className="stamp press green" style={{ animationDelay: "1100ms" }}>
              KORA · {c.cacReference} · Verified
            </span>
            {simulated || c.simulated ? <span className="sim-badge">SIMULATED IDENTITY</span> : null}
          </div>
        </div>
      ) : c.verdict === "VERIFIED" ? (
        <div style={{ margin: "24px 0 0 64px", display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", animation: "riseIn 500ms 1300ms both" }}>
          <span className="green" style={{ font: "500 15px var(--font-body)" }}>
            ✓ Verified
          </span>
          <span className="muted" style={{ font: "400 15px var(--font-body)" }}>
            Not chosen.{c.differenceFromChosen ? ` ${c.differenceFromChosen} more for the same order.` : ""}
          </span>
          <span className="mono muted" style={{ fontSize: 13 }}>
            {c.cacReference}
          </span>
        </div>
      ) : (
        <div style={{ margin: "24px 0 0 64px" }} className="mono muted breathe">
          Checking with Kora…
        </div>
      )}
    </li>
  );
}

function LateReplies({ v }: { v: RequestView }) {
  const verify = useAction(`/api/requests/${v.id}/verify`);
  const recommend = useAction(`/api/requests/${v.id}/recommend`);
  const busy = verify.pending || recommend.pending;
  return (
    <div className="alert" style={{ marginBottom: 20, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ flex: 1, minWidth: "24ch" }}>
        {v.lateReplies} more repl{v.lateReplies === 1 ? "y" : "ies"} arrived after the check. The ranking below doesn&apos;t include {v.lateReplies === 1 ? "it" : "them"} yet.
      </span>
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        onClick={async () => {
          const a = await verify.run();
          if (a.ok) await recommend.run();
        }}
      >
        {busy ? <Spinner label="Checking with Kora" /> : `Check ${v.lateReplies === 1 ? "it" : "them"} too`}
      </button>
    </div>
  );
}

function Decision({ v }: { v: RequestView }) {
  const router = useRouter();
  const approve = useAction<Record<string, never>, { orderId: string }>(`/api/requests/${v.id}/approve`);
  const rec = v.recommendation;
  const checking = v.status === "VERIFYING" || !rec;

  const onApprove = async () => {
    const r = await approve.run({});
    if (r.ok) router.push(`/orders/${r.data.orderId}`);
  };

  return (
    <section className="decision" aria-labelledby="rec-title">
      <div className="decision-left">
        <div className="eyebrow">Recommendation</div>
        {checking ? (
          <>
            <h1 id="rec-title" className="display muted breathe">
              Checking.
            </h1>
            <p className="body-lg" style={{ marginTop: 48, maxWidth: "46ch" }}>
              Kora is confirming each vendor’s company registration and who owns their payout account.
            </p>
          </>
        ) : rec?.chosenLabel ? (
          <>
            <h1 id="rec-title" className="display">
              {rec.chosenLabel}.
            </h1>
            <div style={{ marginTop: 28, display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
              <span className="title">{rec.chosenName}</span>
              <span className="mono" style={{ font: "500 clamp(20px,1.6vw,26px)/1 var(--font-mono)", letterSpacing: "-0.02em" }}>
                {rec.chosenTotal}
              </span>
            </div>
            <div style={{ marginTop: 48, display: "grid", gap: 20, maxWidth: "46ch" }}>
              {rec.reasoning.map((s) => (
                <p key={s} className="body-lg" style={{ margin: 0 }}>
                  {s}
                </p>
              ))}
            </div>
            <button type="button" className="btn btn-lg" style={{ marginTop: 56 }} disabled={approve.pending} onClick={() => void onApprove()}>
              {approve.pending ? <Spinner label="Opening your account" /> : `Approve ${rec.chosenLabel}`}
            </button>
            <div className="note" style={{ marginTop: 20, fontSize: 15 }}>
              You approve once. Your money is held until delivery.
            </div>
            <div className="parsed-by" style={{ marginLeft: 0, marginTop: 16, display: "block" }}>
              {rec.parsedBy === "AI" ? `Ranked by AI (${rec.model ?? "model"}); every vendor checked by Kora.` : "Ranked by ProcureAI’s rules; every vendor checked by Kora."}
            </div>
            <div aria-live="polite">{approve.error ? <p className="form-error">{approve.error.message}</p> : null}</div>
          </>
        ) : (
          <>
            <h1 id="rec-title" className="display">
              No one yet.
            </h1>
            {rec?.reasoning.map((s) => (
              <p key={s} className="body-lg" style={{ marginTop: 48, maxWidth: "46ch" }}>
                {s}
              </p>
            ))}
          </>
        )}
        {v.checkErrors.length ? (
          <div className="alert alert-red">
            {v.checkErrors.map((e) => (
              <p key={e} className="error-line" style={{ margin: 0 }}>
                {e}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: 20 }} className="label">
          <span>Sorted by price</span>
          <span>{v.checkedAt ? `Checked by Kora · ${v.checkedAt}` : "Checking with Kora…"}</span>
        </div>
        {v.lateReplies > 0 ? <LateReplies v={v} /> : null}
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {v.checks.map((c, i) => (
            <VendorRow key={c.vendorId} c={c} index={i} simulated={v.simulatedIdentity} />
          ))}
        </ol>
      </div>
    </section>
  );
}
