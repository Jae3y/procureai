"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useLive — subscribes to an SSE endpoint that sends full `snapshot` messages. EventSource
 * reconnects on its own; the server's first message on every (re)connect is a complete snapshot,
 * so the view can never be left with missed events. No polling.
 */
export function useLive<T>(url: string, initial: T): { data: T; connection: "live" | "reconnecting" } {
  const [data, setData] = useState<T>(initial);
  const [connection, setConnection] = useState<"live" | "reconnecting">("live");

  useEffect(() => {
    const es = new EventSource(url, { withCredentials: true });
    const onSnapshot = (ev: MessageEvent<string>) => {
      try {
        setData(JSON.parse(ev.data) as T);
        setConnection("live");
      } catch (err) {
        console.warn("ProcureAI: unreadable live update ignored", err);
      }
    };
    es.addEventListener("snapshot", onSnapshot as EventListener);
    es.onopen = () => setConnection("live");
    es.onerror = () => setConnection("reconnecting");
    return () => {
      es.removeEventListener("snapshot", onSnapshot as EventListener);
      es.close();
    };
  }, [url]);

  return { data, connection };
}

export type ActionError = { message: string; status: number; details?: unknown };

/**
 * useAction — one POST at a time. The button is disabled while pending (no double-submits from the
 * UI) and each attempt carries a fresh Idempotency-Key, reused only if the same attempt is retried
 * by the network layer. Never rejects: failures come back as a readable error.
 */
export function useAction<TBody = Record<string, unknown>, TResult = Record<string, unknown>>(url: string) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);
  const inflight = useRef(false);

  const run = useCallback(
    async (body?: TBody): Promise<{ ok: true; data: TResult } | { ok: false; error: ActionError; data: unknown }> => {
      if (inflight.current) return { ok: false, error: { message: "Already working on it.", status: 0 }, data: null };
      inflight.current = true;
      setPending(true);
      setError(null);
      try {
        const res = await fetch(url, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "Idempotency-Key": newKey() },
          body: JSON.stringify(body ?? {}),
        });
        let data: unknown = null;
        try {
          data = await res.json();
        } catch (parseErr) {
          data = { error: { message: `Unexpected response (${res.status}).`, cause: String(parseErr) } };
        }
        if (!res.ok) {
          const e = (data as { error?: { message?: string; details?: unknown } } | null)?.error;
          const err = { message: e?.message ?? `Something went wrong (${res.status}).`, status: res.status, details: e?.details };
          setError(err);
          return { ok: false, error: err, data };
        }
        return { ok: true, data: data as TResult };
      } catch (netErr) {
        const err = { message: "Couldn't reach ProcureAI. Check your connection and try again.", status: 0, details: String(netErr) };
        setError(err);
        return { ok: false, error: err, data: null };
      } finally {
        inflight.current = false;
        setPending(false);
      }
    },
    [url],
  );

  return { run, pending, error, clearError: () => setError(null) };
}

/** Works in insecure contexts too (a phone on the LAN over http), where randomUUID is absent. */
function newKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * mm:ss until an ISO timestamp, ticking each second (display only). Starts empty and fills in after
 * mount, so server and client render the same markup (no hydration mismatch).
 */
export function useCountdown(iso: string | null): string | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!iso) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [iso]);
  if (!iso || now === null) return null;
  const secs = Math.max(0, Math.floor((Date.parse(iso) - now) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}
