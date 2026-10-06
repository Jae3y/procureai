"use client";

import { useRef, useState } from "react";
import type { VendorView } from "@/lib/views/vendor-view";
import { useAction, useLive } from "./hooks";
import { Spinner } from "./ui";

/** 07–09 · The vendor's phone at /v/<token>. Built for 390px wide, 44px+ tap targets, numeric keypad for the code. */
export function VendorPhone({ token, initial }: { token: string; initial: VendorView }) {
  const { data: v } = useLive<VendorView>(`/api/vendors/${token}/stream`, initial);
  const o = v.order;

  if (o?.vendor.screen === "paid") return <Paid v={v} />;
  return (
    <main className="phone">
      <div className="phone-logo">
        <span className="logo-mark" aria-hidden="true" style={{ display: "flex", alignItems: "center" }}>
          <span className="d" />
          <span className="b" />
          <span className="r" />
        </span>
        <span className="logo-word">ProcureAI</span>
      </div>
      {v.screen === "quote" ? (
        v.closed ? (
          <Note title="Quotes are closed." body="This request isn't taking quotes any more." />
        ) : (
          <QuoteForm token={token} v={v} />
        )
      ) : v.screen === "submitted" ? (
        <Note title="Quote sent." body={`${v.buyerName} will see it next to the others. If you're chosen, this page shows your payment.`} detail={v.quote ? `Read as ${v.quote.total} total.` : null} />
      ) : v.screen === "not-chosen" ? (
        <Note title="Another vendor was chosen." body="Thank you for quoting. Nothing more is needed from you." />
      ) : o ? (
        <OrderScreen token={token} v={v} />
      ) : null}
    </main>
  );
}

function Note({ title, body, detail }: { title: string; body: string; detail?: string | null }) {
  return (
    <div style={{ paddingTop: 36 }} className="rise" role="status">
      <h1>{title}</h1>
      <p className="note" style={{ marginTop: 20 }}>
        {body}
      </p>
      {detail ? <p className="mono muted" style={{ fontSize: 13 }}>{detail}</p> : null}
    </div>
  );
}

type Fields = { reply: string; businessName: string; rcNumber: string; bankCode: string; accountNumber: string; email: string; consent: boolean };

function QuoteForm({ token, v }: { token: string; v: VendorView }) {
  const [f, setF] = useState<Fields>({ reply: "", businessName: "", rcNumber: "", bankCode: "", accountNumber: "", email: "", consent: false });
  const send = useAction<Fields>(`/api/vendors/${token}/quote`);
  const issues = ((send.error?.details as { issues?: Array<{ path: string; message: string }> } | undefined)?.issues ?? []).reduce<Record<string, string>>(
    (acc, i) => ({ ...acc, [i.path]: i.message }),
    {},
  );
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((s) => ({ ...s, [k]: k === "consent" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const field = (k: keyof Fields, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="field">
      <label htmlFor={`v-${k}`}>{label}</label>
      <input id={`v-${k}`} className="input" value={String(f[k])} onChange={set(k)} aria-invalid={Boolean(issues[k])} aria-describedby={issues[k] ? `v-${k}-err` : undefined} {...props} />
      {issues[k] ? (
        <span id={`v-${k}-err`} className="form-error" style={{ marginTop: 0 }}>
          {issues[k]}
        </span>
      ) : null}
    </div>
  );

  return (
    <form
      noValidate
      style={{ paddingTop: 36, display: "flex", flexDirection: "column", flex: 1 }}
      onSubmit={(e) => {
        e.preventDefault();
        void send.run(f);
      }}
    >
      <div className="label">{v.buyerName} is asking for a quote</div>
      <h1>{v.itemLine}</h1>
      <div style={{ marginTop: 28, borderTop: "1px solid var(--hairline)" }}>
        {v.rows.map((r) => (
          <div key={r.label} className="prow">
            <span>{r.label}</span>
            <span>{r.value}</span>
          </div>
        ))}
      </div>
      <p className="note" style={{ fontSize: 14, marginTop: 20 }}>
        {v.terms}
      </p>

      <div className="field" style={{ marginTop: 24 }}>
        <label htmlFor="v-reply" className="sr-only">
          Your quote
        </label>
        <textarea
          id="v-reply"
          className="input"
          style={{ border: "1.5px solid var(--ink)", fontSize: 17 }}
          placeholder="I fit do am 4,200 each, delivery free, ready Thursday"
          value={f.reply}
          onChange={set("reply")}
          aria-invalid={Boolean(issues.reply)}
        />
        <span className="note" style={{ fontSize: 13, margin: 0 }}>
          Write it any way you like. Price, timing, terms.
        </span>
        {issues.reply ? <span className="form-error">{issues.reply}</span> : null}
      </div>

      <div style={{ display: "grid", gap: 14, marginTop: 28 }}>
        <div className="label" style={{ lineHeight: 1.4 }}>
          Your business. Kora checks these once, so ProcureAI can pay you.
        </div>
        {field("businessName", "Business name", { autoComplete: "organization" })}
        {field("rcNumber", "CAC registration number", { placeholder: "RC1482093", autoCapitalize: "characters" })}
        <div className="field">
          <label htmlFor="v-bankCode">Bank</label>
          <select id="v-bankCode" className="input" value={f.bankCode} onChange={set("bankCode")} aria-invalid={Boolean(issues.bankCode)} disabled={v.banks.length === 0}>
            <option value="">{v.banks.length ? "Choose your bank" : "Bank list unavailable"}</option>
            {v.banks.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </select>
          {v.banksError ? <span className="form-error">{v.banksError}</span> : null}
          {v.banksNote ? <p className="note" style={{ fontSize: 14, marginTop: 8 }}>{v.banksNote}</p> : null}
          {issues.bankCode ? <span className="form-error">{issues.bankCode}</span> : null}
        </div>
        {field("accountNumber", "Business account number", { inputMode: "numeric", pattern: "[0-9]*", maxLength: 10, autoComplete: "off" })}
        {field("email", "Business email", { type: "email", inputMode: "email", autoComplete: "email" })}
        <label className="check">
          <input type="checkbox" checked={f.consent} onChange={set("consent")} />
          <span>I agree that ProcureAI can check this business and bank account with Kora.</span>
        </label>
        {issues.consent ? <span className="form-error">{issues.consent}</span> : null}
      </div>

      <div style={{ marginTop: "auto", paddingTop: 24 }}>
        <button type="submit" className="btn" disabled={send.pending || f.reply.trim().length < 3}>
          {send.pending ? <Spinner label="Sending" /> : "Send quote"}
        </button>
        <div aria-live="polite">{send.error && !Object.keys(issues).length ? <p className="form-error">{send.error.message}</p> : null}</div>
      </div>
    </form>
  );
}

function CodeEntry({ orderId, token, enabled, attemptsLeft, locked }: { orderId: string; token: string; enabled: boolean; attemptsLeft: number; locked: boolean }) {
  const [code, setCode] = useState("");
  const submit = useAction<{ token: string; code: string }, { ok: boolean; message?: string }>(`/api/orders/${orderId}/handover`);
  const [answer, setAnswer] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const disabled = !enabled || locked || submit.pending;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setAnswer(null);
        void submit.run({ token, code }).then((r) => {
          if (!r.ok || !r.data.ok) setCode("");
          if (r.ok && !r.data.ok) setAnswer(r.data.message ?? "That code isn't right.");
        });
      }}
    >
      <div className="code-boxes" onClick={() => inputRef.current?.focus()}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={`code-box${code[i] ? " filled" : ""}${i === code.length && !disabled ? " cursor" : ""}`} aria-hidden="true">
            {code[i] ?? ""}
          </span>
        ))}
        <input
          ref={inputRef}
          className="code-input"
          aria-label="Delivery code, 6 digits"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          disabled={disabled}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />
      </div>
      <button type="submit" className="btn" style={{ marginTop: 20 }} disabled={disabled || code.length !== 6}>
        {submit.pending ? <Spinner label="Checking code" /> : "Confirm delivery"}
      </button>
      <div aria-live="polite">
        {locked ? (
          <p className="form-error">This code is locked after 5 wrong attempts. Ask the buyer to contact ProcureAI.</p>
        ) : submit.error || answer ? (
          <p className="form-error">{answer ?? submit.error?.message}</p>
        ) : attemptsLeft < 5 ? (
          <p className="note" style={{ fontSize: 13 }}>
            {attemptsLeft} attempt{attemptsLeft === 1 ? "" : "s"} left.
          </p>
        ) : null}
      </div>
    </form>
  );
}

function OrderScreen({ token, v }: { token: string; v: VendorView }) {
  const o = v.order!;
  const s = o.vendor;
  const stage1Paid = s.stage1.state === "paid";
  const progress = s.stage2.state === "paid" ? "100%" : stage1Paid ? "30%" : "0%";

  if (s.screen === "waiting") {
    return <Note title="You were chosen." body={`Waiting for ${v.buyerName}'s payment. Kora holds it, then sends you ${o.stage1Amount}.`} detail={`Order ${o.ref}`} />;
  }
  if (s.screen === "disputed") {
    return <Note title="This order is on hold." body="The buyer raised a problem, so payouts are paused while ProcureAI looks into it." detail={`Order ${o.ref}`} />;
  }

  const releasing = s.screen === "releasing";
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div className="label" style={{ paddingTop: 20 }}>
        Order {o.ref} · {v.itemLine}
      </div>
      <div style={{ paddingTop: 32 }}>
        <div style={{ font: "600 46px/0.95 var(--font-display)", letterSpacing: "-0.045em" }}>
          <span className="mono green" style={{ fontWeight: 500, letterSpacing: "-0.06em" }}>
            {releasing ? o.stage2Amount : o.stage1Amount}
          </span>
          <br />
          {releasing
            ? s.stage2.state === "failed"
              ? "didn't go through yet."
              : "is on its way."
            : s.stage1.state === "failed"
              ? "didn't go through yet."
              : stage1Paid
                ? "is in your account."
                : "is on its way."}
        </div>
        <div style={{ marginTop: 20 }}>
          {(releasing ? s.stage2.reference : s.stage1.reference) ? (
            <span className={`stamp sm press ${(releasing ? s.stage2.state : s.stage1.state) === "failed" ? "red" : "green"}`}>
              KORA · {releasing ? s.stage2.reference : s.stage1.reference}
              {(releasing ? s.stage2.state : s.stage1.state) === "failed" ? " · Failed" : ""}
            </span>
          ) : null}
        </div>
        {(releasing ? s.stage2.state : s.stage1.state) === "failed" ? (
          <p className="note" style={{ fontSize: 14 }}>
            Your bank declined the transfer. The money is still held for you, and the buyer can retry it.
          </p>
        ) : null}
        <div className="mini" aria-label={`${o.stage1Amount} paid, ${o.heldAmount} held`}>
          <div className="t" />
          <div className="p" style={{ width: progress }} />
          <div className="ds" aria-hidden="true">
            <span style={stage1Paid ? { background: "var(--green)", borderColor: "var(--green)" } : undefined} />
            <span style={{ borderColor: s.stage2.state === "paid" ? "var(--green)" : "var(--amber)" }} />
            <span />
          </div>
          <div className="ls">
            <span>{stage1Paid ? `${o.stage1Amount} paid` : `${o.stage1Amount} sending`}</span>
            <span className="amber">{o.heldAmount} held</span>
            <span className="muted">Done</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: "auto", paddingTop: 32 }}>
        {releasing ? (
          <p className="note">Code accepted. Kora is sending the rest.</p>
        ) : (
          <>
            <div style={{ font: "600 22px/1.1 var(--font-display)", letterSpacing: "-0.025em" }}>Delivery code</div>
            <p className="note" style={{ fontSize: 14, marginTop: 8 }}>
              {stage1Paid
                ? `The buyer gives you this code when you hand over the goods. Enter it to receive ${o.stage2Amount}.`
                : `You can enter the code once ${o.stage1Amount} has landed.`}
            </p>
            <CodeEntry orderId={o.id} token={token} enabled={stage1Paid && o.status === "STAGE_1_PAID"} attemptsLeft={s.codeAttemptsLeft} locked={s.codeLocked} />
          </>
        )}
      </div>
    </div>
  );
}

function Paid({ v }: { v: VendorView }) {
  const o = v.order!;
  return (
    <main className="phone phone-paid" style={{ justifyContent: "center" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }} role="status">
        <div style={{ font: "600 clamp(120px,40vw,168px)/0.82 var(--font-display)", letterSpacing: "-0.07em", marginLeft: -6 }}>Paid</div>
        <div className="mono" style={{ marginTop: 36, font: "500 40px/1 var(--font-mono)", letterSpacing: "-0.05em" }}>
          {o.stage2Amount}
        </div>
        <div style={{ marginTop: 12, font: "400 16px/1.5 var(--font-body)" }}>
          Stage 2 for order {o.ref}. You&apos;ve now received {o.vendor.totalReceived} in full.
        </div>
        {o.vendor.stage2.reference ? (
          <div style={{ marginTop: 28 }}>
            <span className="stamp sm press">KORA · {o.vendor.stage2.reference}</span>
          </div>
        ) : null}
      </div>
      {o.recordPath ? (
        <div style={{ paddingBottom: 16 }}>
          <a className="btn-2" href={o.recordPath} style={{ borderColor: "var(--paper)", color: "var(--paper)", justifyContent: "center" }}>
            View record
          </a>
        </div>
      ) : null}
    </main>
  );
}
