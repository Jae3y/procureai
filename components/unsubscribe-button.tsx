"use client";

import { useState } from "react";
import { Spinner } from "./ui";

export function UnsubscribeButton({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");
  if (state === "done") return <p className="note" role="status">Done. We won&apos;t send you those emails again. Thank you for telling us, and we wish you well.</p>;
  return (
    <div>
      <button
        type="button"
        className="btn"
        disabled={state === "busy"}
        onClick={() => {
          setState("busy");
          fetch(`/api/unsubscribe?t=${encodeURIComponent(token)}`, { method: "POST" })
            .then((r) => setState(r.ok ? "done" : "failed"))
            .catch(() => setState("failed"));
        }}
      >
        {state === "busy" ? <Spinner label="Saving" /> : "Yes, stop these emails"}
      </button>
      {state === "failed" ? <p className="form-error">That didn&apos;t work. Please try again, or reply to any of our emails.</p> : null}
    </div>
  );
}
