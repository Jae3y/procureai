"use client";

import { useEffect, useRef, useState } from "react";
import type { OrderView } from "@/lib/views/order-view";
import { useAction, useCountdown, useLive } from "./hooks";
import { Header, KoraPanel, MoneyTrail, type Step, Spinner } from "./ui";

/** 04 · Pay and 05 · Tracker for one order, driven entirely by Kora-confirmed state over SSE. */
export function OrderFlow({ initial, initials }: { initial: OrderView; initials: string }) {
  const { data: v, connection } = useLive<OrderView>(`/api/orders/${initial.id}/stream`, initial);
  const auto: Step = v.screen === "pay" ? "Pay" : "Track";
  const [viewing, setViewing] = useState<Step | null>(null);
  const prevScreen = useRef(v.screen);

  // When payment is confirmed, stay on Pay to show the stamp; the buyer moves on with "Open tracker".
  const [showPaidStamp, setShowPaidStamp] = useState(false);
  useEffect(() => {
    if (prevScreen.current === "pay" && v.screen === "track") setShowPaidStamp(true);
    prevScreen.current = v.screen;
  }, [v.screen]);

  const step: Step = viewing ?? (showPaidStamp ? "Pay" : auto);
  const reached = v.screen === "pay" ? 3 : v.track.complete ? 5 : 4;

  return (
    <main className="page">
      <Header
        current={step}
        reached={reached}
        refLabel={v.ref}
        initials={initials}
        onStep={(s) => {
          if (s === "Record") window.location.assign(v.track.recordPath ?? "#");
          else if (s === "Pay" || s === "Track") {
            setShowPaidStamp(false);
            setViewing(s === auto ? null : s);
          }
        }}
      />
      {connection === "reconnecting" ? (
        <p className="sr-only" role="status">
          Reconnecting to live updates
        </p>
      ) : null}
      {step === "Pay" ? (
        <Pay
          v={v}
          onTrack={() => {
            setShowPaidStamp(false);
            setViewing(null);
          }}
        />
      ) : (
        <Tracker v={v} connection={connection} />
      )}
      <DemoStrip v={v} />
    </main>
  );
}

function CopyButton({ text, label, done }: { text: string | null; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      className="btn-2"
      disabled={!text}
      onClick={() => {
        if (!text) return;
        navigator.clipboard.writeText(text.replace(/\s/g, "")).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          },
          () => setFailed(true),
        );
      }}
    >
      <span aria-live="polite">{failed ? "Copy blocked: select the number" : copied ? done : label}</span>
    </button>
  );
}

function Pay({ v, onTrack }: { v: OrderView; onTrack: () => void }) {
  const recheck = useAction(`/api/orders/${v.id}/recheck`);
  const countdown = useCountdown(v.pay.state === "open" || v.pay.state === "short" ? v.pay.expiresAt : null);
  const p = v.pay;

  if (p.state === "paid" && p.paidStamp) {
    return (
      <section className="pay" aria-labelledby="paid-title">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <div className="paid-stamp" role="status">
            <div id="paid-title" className="paid-title">
              Payment confirmed
            </div>
            <div className="paid-line">
              <span>{p.paidStamp.amount}</span>
              <span>KORA · {p.paidStamp.reference}</span>
              <span>{p.paidStamp.time}</span>
            </div>
          </div>
          <div style={{ marginTop: 72, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 32, flexWrap: "wrap", width: "100%" }} className="rise">
            <p className="body-lg" style={{ margin: 0, maxWidth: "48ch" }}>
              Held for you. {v.vendorName} receives {v.stage1Amount} now, and the rest when your delivery code is entered.
              {p.overpaid ? ` You paid ${p.overpaid} more than the order; that stays held for a refund.` : ""}
            </p>
            <button type="button" className="btn" onClick={onTrack}>
              Open tracker <span className="arrow">→</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (p.state === "opening") {
    return (
      <section className="pay" aria-busy="true">
        <div className="eyebrow">Pay into this account</div>
        <div className="acct muted breathe" aria-label="Opening your account">
          ··· ··· ····
        </div>
        <p className="note">Kora is opening a one-time account for this purchase.</p>
      </section>
    );
  }

  const short = p.state === "short";
  return (
    <section className="pay" aria-labelledby="pay-eyebrow">
      {short ? (
        <div className="short-head rise">
          <div>
            <div className="short-title">{p.shortfall} short.</div>
            <p className="body-lg" style={{ margin: "24px 0 0", maxWidth: "52ch" }}>
              We received {p.heldSoFar}. Send {p.amountDue} to this account
              {p.amountDue !== p.shortfall ? `, then the rest to the next one (Kora takes up to ₦1,000,000 per account)` : ""}. Nothing goes to
              the vendor until the full amount is here.
            </p>
          </div>
          <div className="held-pill">
            <span className="dot" aria-hidden="true" />
            {p.heldSoFar} held
          </div>
        </div>
      ) : null}
      {p.state === "expired" ? (
        <div className="alert alert-red" style={{ marginTop: 0, marginBottom: 40 }}>
          <div className="alert-title">This account closed before payment arrived.</div>
          <p className="note" style={{ margin: 0 }}>
            Nothing was taken. ProcureAI opens a fresh account automatically; it appears here.
          </p>
        </div>
      ) : null}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 24, flexWrap: "wrap" }}>
        <div id="pay-eyebrow" className="eyebrow" style={{ marginBottom: 0 }}>
          {short
            ? "Send the rest to this account"
            : p.instalment
              ? `Transfer ${p.instalment.part} of ${p.instalment.of} · Pay into this account`
              : "Pay into this account"}
        </div>
        <div className="mono" style={{ font: "500 clamp(22px,2vw,34px)/1 var(--font-mono)", letterSpacing: "-0.03em" }}>
          {p.amountDue}
        </div>
      </div>
      {p.checkoutUrl ? (
        <div style={{ margin: "40px 0 56px" }}>
          <a className="btn btn-lg" href={p.checkoutUrl}>
            Pay with Kora checkout <span className="arrow">→</span>
          </a>
        </div>
      ) : (
        <div className="acct" aria-label={`Account number ${p.accountNumber ?? ""}`}>
          {p.accountNumber ?? "—"}
        </div>
      )}
      <div className="pay-grid">
        <div>
          <div className="label">Bank</div>
          <div className="pay-val">{p.bankName ?? "—"}</div>
        </div>
        <div>
          <div className="label">Account name</div>
          <div className="pay-val">{p.accountName ?? "—"}</div>
        </div>
        <div>
          <div className="label">Closes in</div>
          <div className="pay-val mono" style={{ fontSize: 22 }} aria-live="off">
            {countdown ?? "—:—"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <CopyButton text={p.accountNumber} label="Copy number" done="Copied" />
          <button type="button" className="btn btn-sm" disabled={recheck.pending} onClick={() => void recheck.run()}>
            {recheck.pending ? <Spinner label="Asking Kora" /> : "I've sent it"}
          </button>
        </div>
      </div>
      <p className="note" style={{ marginTop: 40, maxWidth: "60ch" }}>
        This account exists for this purchase only and closes after one payment. Send from any Nigerian bank app.
      </p>
      {p.instalment ? (
        <p className="note" style={{ marginTop: 12, maxWidth: "60ch" }}>
          Kora accepts up to ₦1,000,000 per one-time account, so {v.amount} is paid in {p.instalment.of} transfers.
          {p.instalment.receivedSoFar ? ` Received so far: ${p.instalment.receivedSoFar}.` : ""} The next account appears here as soon as Kora confirms this one.
        </p>
      ) : null}
      <div aria-live="polite">
        {recheck.error ? <p className="form-error">{recheck.error.message}</p> : null}
      </div>
    </section>
  );
}

function Tracker({ v, connection }: { v: OrderView; connection: "live" | "reconnecting" }) {
  const retry = useAction(`/api/orders/${v.id}/payouts/retry`);
  const recheck = useAction(`/api/orders/${v.id}/recheck`);
  const dispute = useAction<{ reason: string }>(`/api/orders/${v.id}/dispute`);
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState("");
  const t = v.track;
  const canDispute = v.status === "HELD" || v.status === "STAGE_1_PAID";

  return (
    <section className="section" aria-labelledby="track-title">
      <div className="eyebrow">
        Tracker · {v.itemLine} · {v.vendorName}
      </div>
      <h1 id="track-title" className="headline" style={{ maxWidth: "16ch", color: t.titleTone === "red" ? "var(--red)" : undefined }}>
        {t.title}
      </h1>

      <MoneyTrail nodes={t.nodes} step={t.step} />

      <div className="track-body">
        <div>
          <div className="label" style={{ marginBottom: 16 }}>
            Still held
          </div>
          <div className="held-big" style={{ color: t.held.tone === "green" ? "var(--green)" : "var(--amber)" }}>
            <span className="dot" aria-hidden="true" style={{ background: "currentColor" }} />
            {t.held.amount}
          </div>
          {v.sandboxRoute ? (
            <p className="note" style={{ fontSize: 14, marginTop: 16 }}>
              Sandbox payout route used: Kora test account <span className="mono">{v.sandboxRoute}</span>.
            </p>
          ) : null}

          {t.code ? (
            <div className="block">
              <div className="label" style={{ marginBottom: 16 }}>
                Your delivery code
              </div>
              <div className="code-big">{t.code}</div>
              <p className="note" style={{ marginTop: 20, maxWidth: "52ch" }}>
                Give this code to {v.vendorName} only when all {v.itemLine} are in your hands. When they enter it,{" "}
                {v.stage2Amount} is released to them.
              </p>
            </div>
          ) : null}

          {t.pendingNote && !t.failure ? (
            <div className="block">
              <div className="label" style={{ marginBottom: 12 }}>
                Waiting on Kora
              </div>
              <p className="note" style={{ margin: 0 }}>
                {t.pendingNote}
              </p>
            </div>
          ) : null}

          {t.blocked && !t.failure ? (
            <div className="block">
              <div className="block-title red">{t.blocked.title}.</div>
              <p className="body-lg" style={{ marginTop: 20, maxWidth: "52ch", fontSize: 18 }}>
                {t.blocked.detail}
              </p>
              <p className="note">ProcureAI tries again automatically every minute.</p>
            </div>
          ) : null}

          {t.failure ? (
            <div className="block">
              <div className="block-title red">{t.failure.title}</div>
              <p className="body-lg" style={{ marginTop: 20, maxWidth: "52ch", fontSize: 18 }}>
                {t.failure.detail}
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 24, marginTop: 32, flexWrap: "wrap" }}>
                {t.failure.canRetry ? (
                  <button type="button" className="btn" disabled={retry.pending} onClick={() => void retry.run()}>
                    {retry.pending ? <Spinner label="Retrying" /> : "Retry payout"}
                  </button>
                ) : null}
                <span className="mono red" style={{ fontSize: 13 }}>
                  KORA · {t.failure.reference} · Failed
                </span>
              </div>
              <div aria-live="polite">{retry.error ? <p className="form-error">{retry.error.message}</p> : null}</div>
            </div>
          ) : null}

          {t.disputed ? (
            <div className="block">
              <div className="block-title red">{t.disputed.title}</div>
              <p className="body-lg" style={{ marginTop: 20, maxWidth: "52ch", fontSize: 18 }}>
                {t.disputed.detail}
              </p>
              {t.disputed.refund ? <p className="mono note">Refund: {t.disputed.refund}</p> : null}
            </div>
          ) : null}

          {t.complete ? (
            <div className="block" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
              <p className="body-lg" style={{ margin: 0, maxWidth: "44ch", fontSize: 18 }}>
                {v.vendorName} has been paid in full. The record is ready to share.
              </p>
              <a className="btn" href={t.recordPath ?? "#"}>
                Open record <span className="arrow">→</span>
              </a>
            </div>
          ) : null}

          <div style={{ marginTop: 48, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
            {!t.complete ? (
              <button type="button" className="btn-text" disabled={recheck.pending} onClick={() => void recheck.run()}>
                {recheck.pending ? "Asking Kora…" : "Re-check with Kora"}
              </button>
            ) : null}
            {canDispute && !disputing ? (
              <button type="button" className="btn-text" onClick={() => setDisputing(true)}>
                Something’s wrong
              </button>
            ) : null}
          </div>
          {recheck.error ? <p className="form-error">{recheck.error.message}</p> : null}
          {disputing && canDispute ? (
            <form
              className="block"
              onSubmit={(e) => {
                e.preventDefault();
                void dispute.run({ reason }).then((r) => {
                  if (r.ok) setDisputing(false);
                });
              }}
            >
              <div className="field">
                <label htmlFor="dispute-reason">What went wrong? Payouts freeze until ProcureAI resolves it.</label>
                <textarea id="dispute-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
                <button type="submit" className="btn btn-sm" disabled={dispute.pending || reason.trim().length < 5}>
                  {dispute.pending ? <Spinner label="Freezing" /> : "Freeze payouts"}
                </button>
                <button type="button" className="btn-text" onClick={() => setDisputing(false)}>
                  Cancel
                </button>
              </div>
              {dispute.error ? <p className="form-error">{dispute.error.message}</p> : null}
            </form>
          ) : null}
        </div>

        <KoraPanel rows={v.events} connection={connection} />
      </div>
    </section>
  );
}

/** Sandbox-only controls (DEMO_MODE + test key), in the prototype's demo-bar style. They call Kora's real sandbox APIs. */
function DemoStrip({ v }: { v: OrderView }) {
  const demo = useAction<{ action: string; orderId: string }, { message: string }>("/api/admin/demo");
  const [msg, setMsg] = useState<string | null>(null);
  if (!v.demoMode || !v.testMode) return null;
  const act = async (action: string) => {
    const r = await demo.run({ action, orderId: v.id });
    setMsg(r.ok ? r.data.message : r.error.message);
    setTimeout(() => setMsg(null), 5000);
  };
  const paying = v.status === "AWAITING_PAYMENT" || v.status === "UNDERPAID";
  return (
    <>
      <div className="demo-strip" aria-label="Sandbox demo controls">
        <span className="muted" style={{ marginRight: 4 }}>
          Sandbox
        </span>
        {paying ? (
          <>
            <button type="button" disabled={demo.pending} onClick={() => void act("pay")}>
              Transfer {v.pay.amountDue}
            </button>
            {v.status === "AWAITING_PAYMENT" ? (
              <button type="button" disabled={demo.pending} onClick={() => void act("underpay")}>
                Transfer ₦60,000 less
              </button>
            ) : null}
          </>
        ) : null}
        <button type="button" disabled={demo.pending} onClick={() => void act("recheck")}>
          Re-check now
        </button>
        {v.vendorPhoneLink ? (
          <a href={v.vendorPhoneLink} target="_blank" rel="noopener" style={{ font: "500 12px/1 var(--font-body)", padding: "8px 12px" }}>
            Open vendor&apos;s phone
          </a>
        ) : null}
        <a href="/admin" style={{ font: "500 12px/1 var(--font-body)", padding: "8px 12px" }}>
          Admin
        </a>
      </div>
      {msg ? (
        <div className={`toast${demo.error ? " err" : ""}`} role="status">
          {msg}
        </div>
      ) : null}
    </>
  );
}
