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

/** Last resort when the root layout itself fails: plain HTML, no dependencies, still calm and recoverable. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportCrash(error), [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f5f2ea", color: "#14130f", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "96px 24px" }} role="alert">
          <h1 style={{ fontSize: 44, margin: 0 }}>Taking a moment.</h1>
          <p style={{ fontSize: 18, lineHeight: 1.5, marginTop: 24 }}>
            ProcureAI couldn&apos;t load this page. Nothing is lost and no money has moved without the bank confirming it. Re-check to try again.
          </p>
          <button type="button" onClick={() => reset()} style={{ marginTop: 32, padding: "14px 28px", fontSize: 16, background: "#14130f", color: "#f5f2ea", border: 0, borderRadius: 8, cursor: "pointer" }}>
            Re-check
          </button>
        </main>
      </body>
    </html>
  );
}
