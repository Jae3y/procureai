"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction } from "./hooks";
import { Header, Spinner } from "./ui";

type Draft = { item: string | null; quantity: string | null; budget: string | null; deadline: string | null };

/** 01 · Request — the buyer's one sentence. Missing parts show as "Not given", like the homepage parser. */
export function RequestComposer({ mode, testMode, initialText, initials }: { mode: "demo" | "real"; testMode: boolean; initialText: string; initials?: string }) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [draft, setDraft] = useState<Draft | null>(null);
  const create = useAction<{ text: string }, { id: string }>("/api/requests");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDraft(null);
    const r = await create.run({ text });
    if (r.ok) {
      router.push(`/buy/${r.data.id}`);
      return;
    }
    const d = (r.data as { draft?: Draft } | null)?.draft;
    if (d) setDraft(d);
  };

  const chips: Array<{ label: string; value: string | null; mono: boolean }> = draft
    ? [
        { label: "Item", value: draft.item, mono: false },
        { label: "Quantity", value: draft.quantity, mono: true },
        { label: "Budget", value: draft.budget, mono: true },
        { label: "Deadline", value: draft.deadline, mono: false },
      ]
    : [];

  return (
    <main className="page">
      <Header current="Request" reached={0} initials={initials} />
      <section className="request" aria-labelledby="new-purchase">
        <form onSubmit={submit} className="rise" noValidate>
          <label id="new-purchase" htmlFor="request-text" className="eyebrow" style={{ display: "block", marginBottom: 32 }}>
            New purchase
          </label>
          <textarea
            id="request-text"
            className="request-input"
            rows={3}
            spellCheck={false}
            value={text}
            placeholder="300 branded T-shirts, under ₦1.5m, delivered by 23 October"
            onChange={(e) => {
              setText(e.target.value);
              setDraft(null);
              create.clearError();
            }}
            aria-describedby="request-hint request-error"
          />
          <div className="request-foot">
            <span id="request-hint" className="body-lg muted" style={{ fontSize: 18 }}>
              Say what, how many, how much, and by when.
            </span>
            <button type="submit" className="btn" disabled={create.pending || text.trim().length < 5}>
              {create.pending ? <Spinner label="Reading it" /> : <>Continue <span className="arrow">→</span></>}
            </button>
          </div>
          {mode === "demo" ? (
            <p className="note" style={{ marginTop: 20 }}>
              This is the demo: scripted vendors reply and no real vendor is contacted. <Link href="/signup?next=/buy">Create an account</Link> to ask real vendors.
            </p>
          ) : testMode ? (
            <p className="note" style={{ marginTop: 20 }}>Real vendors, Kora test mode: no real money moves yet.</p>
          ) : null}
          <div id="request-error" aria-live="polite">
            {create.error && !draft ? <p className="form-error">{create.error.message}</p> : null}
          </div>
        </form>

        {draft ? (
          <div aria-live="polite">
            <div className="chips">
              {chips.map((c, i) => (
                <div key={c.label} className="chip" style={{ animationDelay: `${150 * (i + 1)}ms` }}>
                  <div className="label">{c.label}</div>
                  <div className={`chip-value${c.mono ? " mono" : ""}${c.value ? "" : " missing"}`}>{c.value ?? "Not given"}</div>
                </div>
              ))}
            </div>
            <p className="note" style={{ marginTop: 32 }}>
              Add the missing part and ProcureAI can start asking vendors.
            </p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
