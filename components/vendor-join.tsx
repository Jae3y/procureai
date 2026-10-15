"use client";

import { useState } from "react";
import { useAction } from "./hooks";
import { Spinner } from "./ui";

type Fields = {
  businessName: string;
  phone: string;
  sells: string;
  city: string;
  rcNumber: string;
  bankCode: string;
  accountNumber: string;
  email: string;
  consent: boolean;
};

const EMPTY: Fields = { businessName: "", phone: "", sells: "", city: "", rcNumber: "", bankCode: "", accountNumber: "", email: "", consent: false };

/** Vendor registration: once, on a phone. Afterwards buyers' requests that match find them, and quoting is one message. */
export function VendorJoin({ banks, banksError }: { banks: Array<{ name: string; code: string }>; banksError: string | null }) {
  const [f, setF] = useState<Fields>(EMPTY);
  const send = useAction<Fields, { id: string; businessName: string }>("/api/vendors/register");
  const [done, setDone] = useState<string | null>(null);
  const issues = ((send.error?.details as { issues?: Array<{ path: string; message: string }> } | undefined)?.issues ?? []).reduce<Record<string, string>>(
    (acc, i) => ({ ...acc, [i.path]: i.message }),
    {},
  );
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((s) => ({ ...s, [k]: k === "consent" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const field = (k: keyof Fields, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="field">
      <label htmlFor={`j-${k}`}>{label}</label>
      <input id={`j-${k}`} className="input" value={String(f[k])} onChange={set(k)} aria-invalid={Boolean(issues[k])} {...props} />
      {issues[k] ? <span className="form-error" style={{ marginTop: 0 }}>{issues[k]}</span> : null}
    </div>
  );

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
      {done ? (
        <div style={{ paddingTop: 36 }} role="status">
          <h1>You&apos;re registered.</h1>
          <p className="note">
            {done} is now in ProcureAI&apos;s vendor directory. When a buyer asks for what you sell, you get a link: just write your price and terms, the way you would on
            WhatsApp.
          </p>
          <p className="note" style={{ fontSize: 14 }}>
            Kora checks your business and bank account each time a buyer considers your quote. You&apos;re paid 30% once the buyer&apos;s money is held and 70% on delivery.
          </p>
        </div>
      ) : (
        <form
          noValidate
          style={{ paddingTop: 36, display: "grid", gap: 14 }}
          onSubmit={(e) => {
            e.preventDefault();
            void send.run(f).then((r) => {
              if (r.ok) setDone(r.data.businessName);
            });
          }}
        >
          <div className="label">For vendors</div>
          <h1>Register once. Quote in one message.</h1>
          <p className="note" style={{ margin: "4px 0 8px" }}>
            Buyers type what they need; ProcureAI sends the request to registered vendors who sell it. You reply in your own words, and get paid through Kora: 30% when the
            buyer&apos;s money is held, 70% on delivery.
          </p>
          {field("businessName", "Business name", { autoComplete: "organization" })}
          {field("phone", "Phone (where buyers' requests reach you)", { type: "tel", inputMode: "tel", autoComplete: "tel", placeholder: "0803 412 7781" })}
          {field("sells", "What you sell", { placeholder: "e.g. T-shirts, printing, branded merch" })}
          {field("city", "City", { autoComplete: "address-level2", placeholder: "Owerri" })}
          {field("rcNumber", "CAC registration number", { placeholder: "RC1482093", autoCapitalize: "characters" })}
          <div className="field">
            <label htmlFor="j-bankCode">Bank</label>
            <select id="j-bankCode" className="input" value={f.bankCode} onChange={set("bankCode")} aria-invalid={Boolean(issues.bankCode)} disabled={banks.length === 0}>
              <option value="">{banks.length ? "Choose your bank" : "Bank list unavailable"}</option>
              {banks.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </select>
            {banksError ? <span className="form-error">{banksError}</span> : null}
            {issues.bankCode ? <span className="form-error">{issues.bankCode}</span> : null}
          </div>
          {field("accountNumber", "Business account number", { inputMode: "numeric", pattern: "[0-9]*", maxLength: 10, autoComplete: "off" })}
          {field("email", "Business email", { type: "email", inputMode: "email", autoComplete: "email" })}
          <label className="check">
            <input type="checkbox" checked={f.consent} onChange={set("consent")} />
            <span>I agree that ProcureAI can check this business and bank account with Kora whenever a buyer considers my quote.</span>
          </label>
          {issues.consent ? <span className="form-error">{issues.consent}</span> : null}
          <button type="submit" className="btn" style={{ marginTop: 8 }} disabled={send.pending}>
            {send.pending ? <Spinner label="Registering" /> : "Register my business"}
          </button>
          <div aria-live="polite">{send.error && !Object.keys(issues).length ? <p className="form-error">{send.error.message}</p> : null}</div>
        </form>
      )}
    </main>
  );
}
