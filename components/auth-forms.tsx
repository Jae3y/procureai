"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
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
        <PasswordField id="login-password" label="Password" autoComplete="current-password" value={password} onChange={setPassword} error={issueFor(send.error, "password")} />
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

const INTENTS = [
  { value: "BUY", title: "Buy", hint: "Get quotes from vendors and pay safely" },
  { value: "SELL", title: "Sell", hint: "Get requests and get paid before you start" },
  { value: "BOTH", title: "Both", hint: "I buy and I sell" },
] as const;

const HEARD = [
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "X", label: "X (Twitter)" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "FRIEND", label: "A friend or colleague" },
  { value: "EVENT", label: "An event" },
  { value: "SEARCH", label: "Google or another search" },
  { value: "OTHER", label: "Somewhere else" },
] as const;

const EMAIL_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmail.con": "gmail.com", "gamil.com": "gmail.com", "gmail.co": "gmail.com",
  "yaho.com": "yahoo.com", "yahoo.con": "yahoo.com", "hotmial.com": "hotmail.com", "hotmail.con": "hotmail.com", "outlok.com": "outlook.com",
};

function emailSuggestion(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const fix = EMAIL_TYPOS[email.slice(at + 1).toLowerCase()];
  return fix ? `${email.slice(0, at)}@${fix}` : null;
}

/** What the live checklist shows. The server enforces the same rules, plus a check against known data breaches. */
function passwordState(password: string, name: string, email: string) {
  const lower = password.toLowerCase();
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  const nameParts = name.toLowerCase().split(/\s+/).filter((p) => p.length >= 4);
  const longEnough = password.length >= 10;
  const personal = password.length > 0 && ((local.length >= 4 && lower.includes(local)) || nameParts.some((p) => lower.includes(p)));
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  const score = !longEnough || personal ? 0 : password.length >= 16 || (password.length >= 12 && classes >= 3) ? 3 : password.length >= 12 || classes >= 3 ? 2 : 1;
  return { longEnough, personal, score };
}

const METER_LABEL = ["Too weak", "Okay", "Good", "Strong"];

function PasswordField({
  id,
  label,
  value,
  onChange,
  error,
  autoComplete,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  autoComplete: string;
  children?: React.ReactNode;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pw-wrap">
        <input id={id} className="input" type={shown ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={Boolean(error)} />
        <button type="button" className="pw-toggle" onClick={() => setShown((s) => !s)} aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown}>
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      {error ? <span className="form-error" style={{ marginTop: 0 }}>{error}</span> : null}
      {children}
    </div>
  );
}

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void }) => string; remove: (id: string) => void };
  }
}

/** Cloudflare's bot check. Mostly invisible; shows a tick box only when it is unsure. */
function TurnstileBox({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let widget: string | undefined;
    const render = () => {
      if (box.current && window.turnstile && !widget) widget = window.turnstile.render(box.current, { sitekey: siteKey, callback: onToken, "expired-callback": () => onToken("") });
    };
    if (window.turnstile) {
      render();
    } else {
      let script = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
      if (!script) {
        script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.dataset.turnstile = "1";
        document.head.appendChild(script);
      }
      script.addEventListener("load", render);
    }
    return () => {
      if (widget && window.turnstile) window.turnstile.remove(widget);
    };
  }, [siteKey, onToken]);
  return <div ref={box} />;
}

export function SignupForm({ next, google = false, turnstileSiteKey = "" }: { next: string; google?: boolean; turnstileSiteKey?: string }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [intent, setIntent] = useState<"BUY" | "SELL" | "BOTH" | "">(next.startsWith("/vendors") ? "SELL" : "");
  const [organisation, setOrganisation] = useState("");
  const [heardFrom, setHeardFrom] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [website, setWebsite] = useState("");
  const [token, setToken] = useState("");
  const [openedAt] = useState(() => Date.now());
  const send = useAction<Record<string, unknown>, { ok: boolean; intent: "BUY" | "SELL" | "BOTH" }>("/api/auth/signup");
  const fullName = `${firstName} ${lastName}`.trim();
  const pw = passwordState(password, fullName, email);
  const typo = emailSuggestion(email.trim());
  const ready = Boolean(firstName.trim() && lastName.trim() && email.trim() && phone.trim() && intent && pw.longEnough && agreed && (!turnstileSiteKey || token));
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
          void send
            .run({
              firstName,
              lastName,
              email,
              phone,
              password,
              intent,
              ...(organisation.trim() ? { organisation } : {}),
              ...(heardFrom ? { heardFrom } : {}),
              marketingOptIn: marketing,
              acceptTerms: agreed,
              website,
              openedAt,
              ...(token ? { turnstileToken: token } : {}),
            })
            .then((r) => {
              if (r.ok) window.location.assign(r.data.intent === "SELL" ? "/vendors/join" : next);
            });
        }}
      >
        <div className="field-row">
          <Field id="signup-first" label="First name" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} error={issueFor(send.error, "firstName")} />
          <Field id="signup-last" label="Last name" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} error={issueFor(send.error, "lastName")} />
        </div>
        <div className="field">
          <Field id="signup-email" label="Email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={issueFor(send.error, "email")} />
          {typo ? (
            <span className="note" style={{ fontSize: 14 }}>
              Did you mean{" "}
              <button type="button" className="btn-text" style={{ minHeight: 0, padding: 0 }} onClick={() => setEmail(typo)}>
                {typo}
              </button>
              ?
            </span>
          ) : null}
        </div>
        <Field id="signup-phone" label="Phone number" type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} error={issueFor(send.error, "phone")} />
        <fieldset className="intent-set">
          <legend>What will you do on ProcureAI?</legend>
          <div className="intent-grid">
            {INTENTS.map((o) => (
              <label key={o.value} className={`intent-card${intent === o.value ? " on" : ""}`}>
                <input type="radio" name="intent" value={o.value} checked={intent === o.value} onChange={() => setIntent(o.value)} />
                <span className="intent-title">{o.title}</span>
                <span className="intent-hint">{o.hint}</span>
              </label>
            ))}
          </div>
          {issueFor(send.error, "intent") ? <span className="form-error">{issueFor(send.error, "intent")}</span> : null}
        </fieldset>
        <PasswordField id="signup-password" label="Password" value={password} onChange={setPassword} autoComplete="new-password" error={issueFor(send.error, "password")}>
          {password ? (
            <div className="pw-help" aria-live="polite">
              <div className="meter" data-level={pw.score} aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <span className="note" style={{ fontSize: 13 }}>
                {METER_LABEL[pw.score]}
              </span>
            </div>
          ) : null}
          <ul className="pw-rules">
            <li className={pw.longEnough ? "ok" : ""}>At least 10 characters. A few random words is best.</li>
            <li className={password && !pw.personal ? "ok" : ""}>Doesn&apos;t contain your name or email</li>
            <li>We also reject common passwords and ones found in data breaches</li>
          </ul>
        </PasswordField>
        <Field id="signup-org" label="Business or organisation (optional)" autoComplete="organization" value={organisation} onChange={(e) => setOrganisation(e.target.value)} error={issueFor(send.error, "organisation")} />
        <div className="field">
          <label htmlFor="signup-heard">How did you hear about ProcureAI? (optional)</label>
          <select id="signup-heard" className="input" value={heardFrom} onChange={(e) => setHeardFrom(e.target.value)}>
            <option value="">Choose one</option>
            {HEARD.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </div>
        <div className="hp" aria-hidden="true">
          <label htmlFor="signup-website">Leave this field empty</label>
          <input id="signup-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        <label className="check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>
            I agree to the <Link href="/terms">terms</Link> and <Link href="/privacy">privacy policy</Link>.
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
          <span>Send me ProcureAI news and tips. You can stop these at any time. Order and security emails always come through.</span>
        </label>
        {turnstileSiteKey ? <TurnstileBox siteKey={turnstileSiteKey} onToken={setToken} /> : null}
        <button type="submit" className="btn" disabled={send.pending || !ready}>
          {send.pending ? <Spinner label="Creating your account" /> : "Create account"}
        </button>
        <div aria-live="polite">{send.error && !hasIssues(send.error) ? <p className="form-error">{send.error.message}</p> : null}</div>
      </form>
      <p className="note" style={{ marginTop: 24 }}>
        Already have an account? <Link href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link>
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
        <PasswordField id="reset-password" label="New password (at least 10 characters)" autoComplete="new-password" value={password} onChange={setPassword} error={issueFor(send.error, "password")} />
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
