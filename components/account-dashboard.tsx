"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AccountView, NotificationRow, VendorDashboardView } from "@/lib/views/account-view";
import { Field } from "./auth-forms";
import { useAction, type ActionError } from "./hooks";
import { Spinner } from "./ui";

function issueFor(error: ActionError | null, path: string): string | undefined {
  const issues = (error?.details as { issues?: Array<{ path: string; message: string }> } | undefined)?.issues ?? [];
  return issues.find((i) => i.path === path)?.message;
}

function hasIssues(error: ActionError | null): boolean {
  return Boolean((error?.details as { issues?: unknown[] } | undefined)?.issues?.length);
}

export function SignOutButton() {
  const out = useAction("/api/auth/logout");
  return (
    <button type="button" className="btn-text" disabled={out.pending} onClick={() => void out.run().then((r) => r.ok && window.location.assign("/"))}>
      Sign out
    </button>
  );
}

export function Notifications({ rows }: { rows: NotificationRow[] }) {
  const router = useRouter();
  const read = useAction("/api/account/notifications/read");
  const unread = rows.filter((n) => n.unread).length;
  return (
    <div className="account-block">
      <div className="account-block-head">
        <h2>Notifications{unread ? ` · ${unread} new` : ""}</h2>
        {unread ? (
          <button type="button" className="btn-text" disabled={read.pending} onClick={() => void read.run().then((r) => r.ok && router.refresh())}>
            Mark all read
          </button>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="note">Nothing yet. When a vendor replies or money moves, you&apos;ll see it here.</p>
      ) : (
        <ul className="account-list">
          {rows.map((n) => (
            <li key={n.id} className={n.unread ? "unread" : undefined}>
              <div>
                <strong>{n.href ? <Link href={n.href}>{n.title}</Link> : n.title}</strong>
                <div className="note" style={{ fontSize: 15 }}>{n.body}</div>
              </div>
              <span className="mono muted" style={{ fontSize: 13, whiteSpace: "nowrap" }}>{n.when}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Purchases({ rows }: { rows: AccountView["purchases"] }) {
  return (
    <div className="account-block">
      <div className="account-block-head">
        <h2>Your purchases</h2>
        <Link href="/buy" className="btn btn-sm">Start a purchase</Link>
      </div>
      {rows.length === 0 ? (
        <p className="note">No purchases yet. Say what you need in one sentence and ProcureAI asks the vendors.</p>
      ) : (
        <ul className="account-list">
          {rows.map((p) => (
            <li key={p.id}>
              <div>
                <strong><Link href={p.href}>{p.title}</Link></strong>
                <div className="note" style={{ fontSize: 15 }}>
                  {p.status} · {p.when}
                  {p.ref ? <> · <span className="mono">{p.ref}</span></> : null}
                </div>
                {p.receiptHref || p.recordHref ? (
                  <div className="note" style={{ fontSize: 15 }}>
                    {p.receiptHref ? <Link href={p.receiptHref}>Receipt</Link> : null}
                    {p.receiptHref && p.recordHref ? " · " : null}
                    {p.recordHref ? <Link href={p.recordHref}>Record</Link> : null}
                  </div>
                ) : null}
              </div>
              {p.amount ? <span className="mono" style={{ whiteSpace: "nowrap" }}>{p.amount}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AccountSettings({ v }: { v: AccountView }) {
  const router = useRouter();
  const [name, setName] = useState(v.name);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const profile = useAction<{ name: string }>("/api/account/profile");
  const password = useAction<{ current: string; next: string }>("/api/account/password");
  const remove = useAction("/api/account/delete");
  return (
    <div className="account-block">
      <div className="account-block-head">
        <h2>Settings</h2>
      </div>
      <p className="note" style={{ marginTop: 0 }}>
        Signed in as <span className="mono">{v.email}</span>
        {v.emailVerified ? "" : " · email not confirmed yet"}
      </p>
      <form
        noValidate
        className="account-form"
        onSubmit={(e) => {
          e.preventDefault();
          void profile.run({ name }).then((r) => {
            if (r.ok) {
              setSaved("Name saved.");
              router.refresh();
            }
          });
        }}
      >
        <Field id="set-name" label="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={issueFor(profile.error, "name")} />
        <div>
          <button type="submit" className="btn-2" disabled={profile.pending}>{profile.pending ? <Spinner label="Saving" /> : "Save name"}</button>
        </div>
      </form>
      <form
        noValidate
        className="account-form"
        style={{ marginTop: 28 }}
        onSubmit={(e) => {
          e.preventDefault();
          void password.run({ current, next }).then((r) => {
            if (r.ok) {
              setCurrent("");
              setNext("");
              setSaved("Password changed. Other devices have been signed out.");
            }
          });
        }}
      >
        <Field id="set-current" label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={issueFor(password.error, "current")} />
        <Field id="set-next" label="New password (at least 10 characters)" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={issueFor(password.error, "next")} />
        <div>
          <button type="submit" className="btn-2" disabled={password.pending}>{password.pending ? <Spinner label="Saving" /> : "Change password"}</button>
        </div>
        {password.error && !hasIssues(password.error) ? <p className="form-error">{password.error.message}</p> : null}
      </form>
      <div aria-live="polite">{saved ? <p className="note">{saved}</p> : null}</div>
      <div style={{ marginTop: 32, borderTop: "1px solid var(--hairline)", paddingTop: 20 }}>
        <p className="note" style={{ marginTop: 0 }}>
          <a href="/api/account/export" download="procureai-my-data.json">Download my data</a>
        </p>
        {v.deletionRequested ? (
          <p className="note">You&apos;ve asked us to delete your account. We&apos;ll confirm by email. Payment records are kept for as long as the law requires.</p>
        ) : confirmDelete ? (
          <p className="note">
            We&apos;ll delete your account and keep only the payment records the law requires.{" "}
            <button type="button" className="btn-text" disabled={remove.pending} onClick={() => void remove.run().then((r) => r.ok && router.refresh())}>
              Yes, ask for deletion
            </button>
          </p>
        ) : (
          <button type="button" className="btn-text" onClick={() => setConfirmDelete(true)}>Delete my account</button>
        )}
      </div>
    </div>
  );
}

export function VendorInvitations({ v }: { v: VendorDashboardView }) {
  return (
    <>
      <div className="account-block">
        <div className="account-block-head"><h2>Requests for you</h2></div>
        {v.invitations.length === 0 ? (
          <p className="note">No requests yet. When a buyer asks for what you sell, it appears here.</p>
        ) : (
          <ul className="account-list">
            {v.invitations.map((i) => (
              <li key={i.id}>
                <div>
                  <strong><Link href={i.href}>{i.title}</Link></strong>
                  <div className="note" style={{ fontSize: 15 }}>{i.status} · needed by {i.deadline}</div>
                </div>
                {i.total ? <span className="mono" style={{ whiteSpace: "nowrap" }}>{i.total}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="account-block">
        <div className="account-block-head"><h2>Your orders</h2></div>
        {v.orders.length === 0 ? (
          <p className="note">When a buyer chooses you, the order and its payments show here.</p>
        ) : (
          <ul className="account-list">
            {v.orders.map((o) => (
              <li key={o.id}>
                <div>
                  <strong><Link href={o.href}>{o.title}</Link></strong>
                  <div className="note" style={{ fontSize: 15 }}>{o.status} · <span className="mono">{o.ref}</span></div>
                </div>
                <span className="mono" style={{ whiteSpace: "nowrap" }}>{o.amount}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

export function VendorProfileForm({ profile, banks, banksError }: { profile: VendorDashboardView["profile"]; banks: Array<{ name: string; code: string }>; banksError: string | null }) {
  const router = useRouter();
  const [f, setF] = useState({ businessName: profile.businessName, sells: profile.sells, city: profile.city, rcNumber: profile.rcNumber, bankCode: profile.bankCode, accountNumber: profile.accountNumber, email: profile.email, password: "" });
  const [saved, setSaved] = useState(false);
  const send = useAction<typeof f>("/api/vendor/profile");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setSaved(false);
    setF((s) => ({ ...s, [k]: e.target.value }));
  };
  return (
    <div className="account-block">
      <div className="account-block-head"><h2>Your business</h2></div>
      <p className="note" style={{ marginTop: 0 }}>
        Phone <span className="mono">{profile.phone}</span>. Changes apply to new quotes. Kora still checks your business on every purchase, and an order already under way keeps the details Kora checked.
      </p>
      <form
        noValidate
        className="account-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send.run(f).then((r) => {
            if (r.ok) {
              setSaved(true);
              setF((s) => ({ ...s, password: "" }));
              router.refresh();
            }
          });
        }}
      >
        <Field id="vp-name" label="Business name" value={f.businessName} onChange={set("businessName")} error={issueFor(send.error, "businessName")} />
        <Field id="vp-sells" label="What you sell" value={f.sells} onChange={set("sells")} error={issueFor(send.error, "sells")} />
        <Field id="vp-city" label="City" value={f.city} onChange={set("city")} error={issueFor(send.error, "city")} />
        <Field id="vp-rc" label="CAC registration number" value={f.rcNumber} onChange={set("rcNumber")} error={issueFor(send.error, "rcNumber")} />
        <div className="field">
          <label htmlFor="vp-bank">Bank</label>
          <select id="vp-bank" className="input" value={f.bankCode} onChange={set("bankCode")} disabled={banks.length === 0}>
            <option value="">{banks.length ? "Choose your bank" : "Bank list unavailable"}</option>
            {banks.map((b) => (
              <option key={b.code} value={b.code}>{b.name}</option>
            ))}
          </select>
          {banksError ? <span className="form-error">{banksError}</span> : null}
          {issueFor(send.error, "bankCode") ? <span className="form-error">{issueFor(send.error, "bankCode")}</span> : null}
        </div>
        <Field id="vp-account" label="Business account number" inputMode="numeric" maxLength={10} autoComplete="off" value={f.accountNumber} onChange={set("accountNumber")} error={issueFor(send.error, "accountNumber")} />
        <Field id="vp-email" label="Business email" type="email" value={f.email} onChange={set("email")} error={issueFor(send.error, "email")} />
        <Field id="vp-password" label="Your password, to confirm" type="password" autoComplete="current-password" value={f.password} onChange={set("password")} error={issueFor(send.error, "password")} />
        <div>
          <button type="submit" className="btn-2" disabled={send.pending}>{send.pending ? <Spinner label="Saving" /> : "Save changes"}</button>
        </div>
        <div aria-live="polite">
          {saved ? <p className="note">Saved.</p> : null}
          {send.error && !hasIssues(send.error) ? <p className="form-error">{send.error.message}</p> : null}
        </div>
      </form>
    </div>
  );
}
