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

/** Shown until the email is confirmed, when emails can actually be sent. */
export function ConfirmEmailBanner({ v }: { v: AccountView }) {
  const resend = useAction<Record<string, never>, { sent: boolean }>("/api/account/verify-email");
  const [sent, setSent] = useState(false);
  if (v.emailVerified || !v.emailWorks) return null;
  return (
    <div className="callout-codes" role="status" style={{ marginTop: 24 }}>
      <p style={{ margin: "0 0 12px" }}>
        <strong>Confirm your email.</strong> We sent a link to <span className="mono">{v.email}</span>. You need it before paying for a purchase, so receipts and payment updates reach you.
      </p>
      {sent ? (
        <p className="note" style={{ margin: 0 }}>Sent. Check your inbox and spam folder.</p>
      ) : (
        <button type="button" className="btn-2 btn-sm" disabled={resend.pending} onClick={() => void resend.run({}).then((r) => r.ok && setSent(true))}>
          {resend.pending ? <Spinner label="Sending" /> : "Send the link again"}
        </button>
      )}
      {resend.error ? <p className="form-error">{resend.error.message}</p> : null}
    </div>
  );
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

/** Two-step sign-in and signing out everywhere. */
export function SecuritySettings({ v }: { v: AccountView }) {
  const router = useRouter();
  const setup = useAction<Record<string, never>, { secret: string; qrSvg: string }>("/api/account/2fa/setup");
  const confirm = useAction<{ code: string }, { recoveryCodes: string[] }>("/api/account/2fa/confirm");
  const disable = useAction<{ password: string; code: string }>("/api/account/2fa/disable");
  const everywhere = useAction("/api/account/signout-all");
  const [pending, setPending] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [turningOff, setTurningOff] = useState(false);
  return (
    <div className="account-block">
      <div className="account-block-head">
        <h2>Security</h2>
      </div>
      {codes ? (
        <div className="callout-codes" role="status">
          <p style={{ marginTop: 0 }}>
            <strong>Two-step sign-in is on.</strong> Save these recovery codes somewhere safe, away from your phone. Each one works once if you lose your phone. They won&apos;t be shown again.
          </p>
          <ul className="recovery-codes">
            {codes.map((c) => (
              <li key={c} className="mono">{c}</li>
            ))}
          </ul>
          <button type="button" className="btn-2" onClick={() => { setCodes(null); router.refresh(); }}>I&apos;ve saved them</button>
        </div>
      ) : v.twoStep.on ? (
        <>
          <p className="note" style={{ marginTop: 0 }}>
            Two-step sign-in is <strong>on</strong>. Signing in needs your password and a code from your authenticator app. {v.twoStep.recoveryCodesLeft} recovery code{v.twoStep.recoveryCodesLeft === 1 ? "" : "s"} left.
          </p>
          {turningOff ? (
            <form
              noValidate
              className="account-form"
              onSubmit={(e) => {
                e.preventDefault();
                void disable.run({ password, code }).then((r) => {
                  if (r.ok) {
                    setTurningOff(false);
                    setPassword("");
                    setCode("");
                    router.refresh();
                  }
                });
              }}
            >
              <Field id="off-password" label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={issueFor(disable.error, "password")} />
              <Field id="off-code" label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} error={issueFor(disable.error, "code")} />
              <div><button type="submit" className="btn-2" disabled={disable.pending}>{disable.pending ? <Spinner label="Turning off" /> : "Turn off two-step sign-in"}</button></div>
              {disable.error && !hasIssues(disable.error) ? <p className="form-error">{disable.error.message}</p> : null}
            </form>
          ) : (
            <button type="button" className="btn-text" onClick={() => setTurningOff(true)}>Turn off two-step sign-in</button>
          )}
        </>
      ) : pending ? (
        <form
          noValidate
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm.run({ code }).then((r) => {
              if (r.ok) {
                setPending(null);
                setCode("");
                setCodes(r.data.recoveryCodes);
              }
            });
          }}
        >
          <p className="note" style={{ margin: 0 }}>
            Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy or 1Password), then enter the 6-digit code it shows.
          </p>
          <div className="qr" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: pending.qrSvg }} />
          <p className="note" style={{ margin: 0, fontSize: 14 }}>
            Can&apos;t scan? Type this key into the app: <span className="mono" style={{ overflowWrap: "anywhere" }}>{pending.secret.replace(/(.{4})/g, "$1 ").trim()}</span>
          </p>
          <Field id="setup-code" label="Code from the app" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} error={issueFor(confirm.error, "code")} />
          <div><button type="submit" className="btn-2" disabled={confirm.pending}>{confirm.pending ? <Spinner label="Checking" /> : "Turn on two-step sign-in"}</button></div>
          {confirm.error && !hasIssues(confirm.error) ? <p className="form-error">{confirm.error.message}</p> : null}
        </form>
      ) : (
        <>
          <p className="note" style={{ marginTop: 0 }}>
            Two-step sign-in is <strong>off</strong>. Turn it on so a stolen password alone can&apos;t open your account.{v.isVendor ? " Vendors need it to change their payout bank account." : ""}
          </p>
          <button type="button" className="btn-2" disabled={setup.pending} onClick={() => void setup.run({}).then((r) => r.ok && setPending(r.data))}>
            {setup.pending ? <Spinner label="Preparing" /> : "Turn on two-step sign-in"}
          </button>
          {setup.error ? <p className="form-error">{setup.error.message}</p> : null}
        </>
      )}
      <div style={{ marginTop: 28, borderTop: "1px solid var(--hairline)", paddingTop: 20 }}>
        <p className="note" style={{ marginTop: 0 }}>Signed in somewhere you don&apos;t recognise? This signs out every device, including this one.</p>
        <button type="button" className="btn-text" disabled={everywhere.pending} onClick={() => void everywhere.run().then((r) => r.ok && window.location.assign("/login"))}>
          Sign out of all devices
        </button>
      </div>
    </div>
  );
}

export function AccountSettings({ v }: { v: AccountView }) {
  const router = useRouter();
  const [name, setName] = useState(v.name);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
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
      <div style={{ marginTop: 28 }}>
        <p className="note" style={{ margin: 0 }} role="status">
          {v.hasPassword ? (
            <>
              <span className="green">✓ Password set.</span> You can sign in with your email and password{v.signsInWithGoogle ? " or with Google" : ""}.
            </>
          ) : (
            <>You sign in with Google and have no password yet. Set one below so you can sign in either way and confirm sensitive changes.</>
          )}
        </p>
        {v.hasPassword && !changing ? (
          <p style={{ margin: "10px 0 0" }}>
            <button type="button" className="btn-text" onClick={() => setChanging(true)}>Change password</button>
          </p>
        ) : null}
      </div>
      {!v.hasPassword || changing ? (
        <form
          noValidate
          className="account-form"
          style={{ marginTop: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            const first = !v.hasPassword;
            void password.run({ current, next }).then((r) => {
              if (r.ok) {
                setCurrent("");
                setNext("");
                setChanging(false);
                setSaved(first ? "Password set. Your account is now protected with a password, and other devices have been signed out." : "Password changed. Other devices have been signed out.");
                router.refresh();
              }
            });
          }}
        >
          {v.hasPassword ? (
            <Field id="set-current" label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={issueFor(password.error, "current")} />
          ) : null}
          <Field id="set-next" label={v.hasPassword ? "New password (at least 10 characters)" : "Choose a password (at least 10 characters)"} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={issueFor(password.error, "next")} />
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button type="submit" className="btn-2" disabled={password.pending}>{password.pending ? <Spinner label="Saving" /> : v.hasPassword ? "Change password" : "Set password"}</button>
            {v.hasPassword ? <button type="button" className="btn-text" onClick={() => { setChanging(false); setCurrent(""); setNext(""); }}>Cancel</button> : null}
          </div>
          {password.error && !hasIssues(password.error) ? <p className="form-error">{password.error.message}</p> : null}
        </form>
      ) : null}
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

export function VendorProfileForm({
  profile,
  pendingBank,
  twoStepOn,
  banks,
  banksError,
}: {
  profile: VendorDashboardView["profile"];
  pendingBank: VendorDashboardView["pendingBank"];
  twoStepOn: boolean;
  banks: Array<{ name: string; code: string }>;
  banksError: string | null;
}) {
  const router = useRouter();
  const [f, setF] = useState({ businessName: profile.businessName, sells: profile.sells, city: profile.city, rcNumber: profile.rcNumber, bankCode: profile.bankCode, accountNumber: profile.accountNumber, email: profile.email, password: "", code: "" });
  const bankChanging = f.bankCode !== profile.bankCode || f.accountNumber !== profile.accountNumber;
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
        Phone <span className="mono">{profile.phone}</span>. Changes apply to new quotes. Your business is checked again on every purchase, and an order already under way keeps the details that were checked.
      </p>
      {pendingBank ? (
        <p className="form-error" role="status">
          Your payout account is changing to the one ending {pendingBank.accountEnding} on {pendingBank.effective}. If you didn&apos;t ask for this, change your password now: that cancels it.
        </p>
      ) : null}
      <form
        noValidate
        className="account-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send.run(f).then((r) => {
            if (r.ok) {
              setSaved(true);
              setF((s) => ({ ...s, password: "", code: "" }));
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
        {bankChanging ? (
          twoStepOn ? (
            <>
              <p className="note" style={{ margin: 0, fontSize: 14 }}>For your safety, a new payout account takes effect 24 hours after you save it, and you&apos;ll be notified.</p>
              <Field id="vp-code" label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" value={f.code} onChange={set("code")} error={issueFor(send.error, "code")} />
            </>
          ) : (
            <p className="form-error" style={{ margin: 0 }}>
              To change your payout account, first turn on two-step sign-in in <a href="/account">your account</a>.
            </p>
          )
        ) : null}
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
