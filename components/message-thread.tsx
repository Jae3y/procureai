"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Thread, ThreadMessage } from "@/lib/views/thread-view";
import { Spinner } from "./ui";

const POLL_MS = 3_000;

/**
 * The buyer–vendor thread. `url` is /api/orders/:id/messages (buyer) or /api/vendors/:token/messages
 * (vendor). Polls for newer messages every 3 s while the page is visible; text only.
 */
export function MessageThread({ url }: { url: string }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const lastId = useRef<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const merge = useCallback((t: Thread) => {
    setThread((prev) => {
      const seen = new Set(prev?.messages.map((m) => m.id));
      const fresh = t.messages.filter((m) => !seen.has(m.id));
      const messages: ThreadMessage[] = [...(prev?.messages ?? []), ...fresh];
      if (messages.length) lastId.current = messages[messages.length - 1]!.id;
      return { ...t, messages };
    });
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(lastId.current ? `${url}?after=${lastId.current}` : url, { credentials: "same-origin", cache: "no-store" });
      const body = (await res.json()) as Thread | { error?: { message?: string } };
      if (!res.ok || !("messages" in body)) {
        setLoadError(("error" in body && body.error?.message) || `Couldn't load messages (${res.status}).`);
        return;
      }
      setLoadError(null);
      merge(body);
    } catch {
      setLoadError("Reconnecting…");
    }
  }, [url, merge]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  const count = thread?.messages.length ?? 0;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(lastId.current ? `${url}?after=${lastId.current}` : url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = (await res.json()) as Thread | { error?: { message?: string } };
      if (!res.ok || !("messages" in body)) {
        setSendError(("error" in body && body.error?.message) || `Not sent (${res.status}).`);
        return;
      }
      setDraft("");
      merge(body);
    } catch {
      setSendError("Not sent. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  const max = thread?.maxChars ?? 300;
  return (
    <section className="thread" aria-label="Messages">
      <div className="thread-head">
        <span className="thread-title">Messages</span>
        <span className="label">{thread ? `with ${thread.with}` : ""}</span>
      </div>
      <ol className="thread-list" ref={listRef} aria-live="polite">
        {!thread && !loadError ? (
          <li className="note thread-empty">Loading messages…</li>
        ) : count === 0 ? (
          <li className="note thread-empty">No messages yet. Ask about delivery, sizes or timing here.</li>
        ) : (
          thread?.messages.map((m) => (
            <li key={m.id} className={`msg${m.mine ? " mine" : ""}`}>
              <div className="msg-meta">
                <strong>{m.who}</strong> · <time>{m.when}</time>
              </div>
              <div className="msg-text">{m.text}</div>
            </li>
          ))
        )}
      </ol>
      {loadError ? <p className="form-error" style={{ marginTop: 8 }}>{loadError}</p> : null}
      <form
        className="thread-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor={`msg-${url}`} className="sr-only">
          Write a message
        </label>
        <textarea
          id={`msg-${url}`}
          className="input thread-input"
          placeholder="Write a message"
          rows={2}
          maxLength={max}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="thread-actions">
          <span className="label" aria-live="polite">
            {draft.length}/{max}
          </span>
          <button type="submit" className="btn btn-sm thread-send" disabled={sending || !draft.trim()}>
            {sending ? <Spinner label="Sending" /> : "Send"}
          </button>
        </div>
        {sendError ? <p className="form-error">{sendError}</p> : null}
      </form>
    </section>
  );
}
