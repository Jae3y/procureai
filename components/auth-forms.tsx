"use client";

import Link from "next/link";
import { useState, type InputHTMLAttributes } from "react";
import { useAction, type ActionError } from "./hooks";
import { Spinner } from "./ui";

/** Sign-in screens. After success the page reloads fully, so every server component sees the new session. */

function issueFor(error: ActionError | null, path: string): string | undefined {
  const issues = (error?.details as { issues?: Array<{ path: string; message: string }> } | undefined)?.issues ?? [];
  return issues.find((i) => i.path === path)?.message;
}

function hasIssues(error: ActionError | null): boolean {
  return Boolean((error?.details as { issues?: unknown[] } | undefined)?.issues?.length);
}

export function Field({
  id,
  label,
  error,
  ...props
}: { id: string; label: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" aria-invalid={Boolean(error)} {...props} />
      {error ? <span className="form-error" style={{ marginTop: 0 }}>{error}</span> : null}
    </div>
  );
}

/** Google's own "G" mark, as their branding guidelines ask for on a "Continue with Google" button. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function GoogleButton({ next, label }: { next: string; label: string }) {
  return (
    <>
      <a className="btn-2 google-btn" href={`/api/auth/google/start?next=${encodeURIComponent(next)}`}>
        <GoogleMark />
        {label}
      </a>
      <div className="or-rule" aria-hidden="true">
        <span>or</span>
      </div>
    </>
  );
}

function FormShell({ title, intro, children }: { title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="account-narrow">
      <h1 className="account-title">{title}</h1>
      {intro ? <p className="note" style={{ margin: "12px 0 28px" }}>{intro}</p> : <div style={{ height: 28 }} />}
      {children}
    </section>
  );
}

export function LoginForm({ next, google = false, error = null, startAtCode = false }: { next: string; google?: boolean; error?: string | null; startAtCode?: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"password" | "code">(startAtCode ? "code" : "password");
  const send = useAction<{ email: string; password: string }, { ok?: boolean; twoFactor?: boolean }>("/api/auth/login");
  const verify = useAction<{ code: string }>("/api/auth/login/verify");
  if (step === "code") {
    return (
      <FormShell title="Enter your code" intro="Open your authenticator app and enter the 6-digit code for ProcureAI. Lost your phone? Use one of your recovery codes.">
        <form
          noValidate
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            void verify.run({ code }).then((r) => {
              if (r.ok) window.location.assign(next);
            });
          }}
        >
          <Field id="login-code" label="Code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} error={issueFor(verify.error, "code")} autoFocus />
          <button type="submit" className="btn" disabled={verify.pending}>
            {verify.pending ? <Spinner label="Checking" /> : "Sign in"}
          </button>
          <div aria-live="polite">{verify.error && !hasIssues(verify.error) ? <p className="form-error">{verify.error.message}</p> : null}</div>
        </form>
        <p className="note" style={{ marginTop: 24 }}>
          <button type="button" className="btn-text" onClick={() => { setStep("password"); setCode(""); }}>Back</button>
        </p>
      </FormShell>
    );
  }
  return (
    <FormShell title="Sign in">
      {error ? (
        <p className="form-error" role="alert" style={{ marginTop: 0 }}>
          {error}
        </p>
      ) : null}
      {google ? <GoogleButton next={next} label="Continue with Google" /> : null}
      <form
        noValidate
        className="account-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send.run({ email, password }).then((r) => {
            if (!r.ok) return;
            if (r.data.twoFactor) setStep("code");
            else window.location.assign(next);
          });
        }}
      >
        <Field id="login-email" label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={issueFor(send.error, "email")} />
        <Field id="login-password" label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={issueFor(send.error, "password")} />
        <button type="submit" className="btn" disabled={send.pending}>
          {send.pending ? <Spinner label="Signing in" /> : "Sign in"}
        </button>
        <div aria-live="polite">{send.error && !hasIssues(send.error) ? <p className="form-error">{send.error.message}</p> : null}</div>
      </form>
      <p className="note" style={{ marginTop: 24 }}>
        <Link href="/forgot">Forgot your password?</Link>
        <br />
        New here? <Link href={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link>
      </p>
    </FormShell>
  );
}

export function SignupForm({ next, google = false }: { next: string; google?: boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const send = useAction<{ name: string; email: string; password: string }>("/api/auth/signup");
  return (
    <FormShell title="Create your account" intro="Ask real vendors, keep every purchase in one place, and get told when something needs you.">
      {google ? (
        <>
          <GoogleButton next={next} label="Continue with Google" />
          <p className="note" style={{ margin: "-8px 0 20px", fontSize: 13 }}>
            Continuing with Google means you agree to the <Link href="/terms">terms</Link> and <Link href="/privacy">privacy policy</Link>.
          </p>
        </>
      ) : null}
      <form
        noValidate
        className="account-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send.run({ name, email, password }).then((r) => {
            if (r.ok) window.location.assign(next);
          });
        }}
      >
        <Field id="signup-name" label="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={issueFor(send.error, "name")} />
        <Field id="signup-email" label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={issueFor(send.error, "email")} />
        <Field id="signup-password" label="Password (at least 10 characters)" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={issueFor(send.error, "password")} />
        <label className="check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>
            I agree to the <Link href="/terms">terms</Link> and <Link href="/privacy">privacy policy</Link>.
          </span>
        </label>
        <button type="submit" className="btn" disabled={send.pending || !agreed}>
          {send.pending ? <Spinner label="Creating your account" /> : "Create account"}
        </button>
        <div aria-live="polite">{send.error && !hasIssues(send.error) ? <p className="form-error">{send.error.message}</p> : null}</div>
      </form>
      <p className="note" style={{ marginTop: 24 }}>
        Already have an account? <Link href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link>
        <br />
        Selling, not buying? <Link href="/vendors/join">Register your business</Link>
      </p>
    </FormShell>
  );
}

export function ForgotForm({ support }: { support: string }) {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<"sent" | "unavailable" | null>(null);
  const send = useAction<{ email: string }, { sent: boolean }>("/api/auth/forgot");
  return (
    <FormShell title="Reset your password" intro="Enter your email and we'll send a link to choose a new password.">
      {result === "sent" ? (
        <p className="note" role="status">If that email has an account, the link is on its way. It works once and expires in an hour.</p>
      ) : result === "unavailable" ? (
        <p className="note" role="status">We can&apos;t send email just yet. Write to {support} from your account&apos;s email address and we&apos;ll reset it for you.</p>
      ) : (
        <form
          noValidate
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send.run({ email }).then((r) => {
              if (r.ok) setResult(r.data.sent ? "sent" : "unavailable");
            });
          }}
        >
          <Field id="forgot-email" label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={issueFor(send.error, "email")} />
          <button type="submit" className="btn" disabled={send.pending}>
            {send.pending ? <Spinner label="Sending" /> : "Send the link"}
          </button>
          <div aria-live="polite">{send.error && !hasIssues(send.error) ? <p className="form-error">{send.error.message}</p> : null}</div>
        </form>
      )}
    </FormShell>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const send = useAction<{ token: string; password: string; code?: string }>("/api/auth/reset");
  const needsCode = Boolean(issueFor(send.error, "code")) || code.length > 0;
  return (
    <FormShell title="Choose a new password" intro="You'll be signed out everywhere else.">
      <form
        noValidate
        className="account-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send.run({ token, password, ...(code ? { code } : {}) }).then((r) => {
            if (r.ok) window.location.assign("/account");
          });
        }}
      >
        <Field id="reset-password" label="New password (at least 10 characters)" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={issueFor(send.error, "password")} />
        {needsCode ? (
          <Field id="reset-code" label="Authenticator code or recovery code" inputMode="text" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} error={issueFor(send.error, "code")} />
        ) : null}
        <button type="submit" className="btn" disabled={send.pending}>
          {send.pending ? <Spinner label="Saving" /> : "Save new password"}
        </button>
        <div aria-live="polite">
          {send.error && !issueFor(send.error, "password") && !issueFor(send.error, "code") ? (
            <p className="form-error">
              {send.error.message} <Link href="/forgot">Ask for a new link</Link>
            </p>
          ) : null}
        </div>
      </form>
    </FormShell>
  );
}
