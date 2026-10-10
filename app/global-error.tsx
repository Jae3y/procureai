"use client";

/** Last resort when the root layout itself fails: plain HTML, no dependencies, still calm and recoverable. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f5f2ea", color: "#14130f", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "96px 24px" }} role="alert">
          <h1 style={{ fontSize: 44, margin: 0 }}>Taking a moment.</h1>
          <p style={{ fontSize: 18, lineHeight: 1.5, marginTop: 24 }}>
            ProcureAI couldn&apos;t load this page. Nothing is lost and no money has moved without Kora confirming it. Re-check to try again.
          </p>
          <button type="button" onClick={() => reset()} style={{ marginTop: 32, padding: "14px 28px", fontSize: 16, background: "#14130f", color: "#f5f2ea", border: 0, borderRadius: 8, cursor: "pointer" }}>
            Re-check
          </button>
        </main>
      </body>
    </html>
  );
}
