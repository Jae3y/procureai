"use client";

import { useEffect } from "react";

/** Tells ProcureAI's server a page crashed (forwarded to Sentry when it's switched on). Never throws. */
function reportCrash(error: Error & { digest?: string }): void {
  void fetch("/api/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: error.message.slice(0, 500) || "Unknown error", name: error.name, stack: (error.stack ?? "").slice(0, 4000), ...(error.digest ? { digest: error.digest } : {}), path: window.location.pathname }),
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * Anything that throws while rendering a page lands here instead of a blank screen. Nothing the
 * buyer did is lost: money moves only through confirmed steps on the server, so re-checking is safe.
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("page error", error.digest ?? error.message);
    reportCrash(error);
  }, [error]);
  return (
    <main id="main" className="page">
      <section className="request" role="alert" aria-live="polite">
        <div className="eyebrow">ProcureAI</div>
        <h1 className="headline" style={{ maxWidth: "16ch" }}>
          Taking a moment.
        </h1>
        <p className="body-lg muted" style={{ maxWidth: "52ch", marginTop: 32 }}>
          Something didn&apos;t load, most likely a slow reply from the bank or the AI. Nothing is lost and no money has moved without the bank confirming it. Re-check and it
          should pick up where it was.
        </p>
        <div style={{ marginTop: 40, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={() => reset()}>
            Re-check <span className="arrow">→</span>
          </button>
          <a className="btn-2" href="/">
            Back to the start
          </a>
        </div>
        {error.digest ? <p className="mono muted" style={{ marginTop: 24, fontSize: 12 }}>Reference {error.digest}</p> : null}
      </section>
    </main>
  );
}
