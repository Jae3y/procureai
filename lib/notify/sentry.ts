import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * Error reports to Sentry, sent straight to its HTTP "envelope" endpoint: no SDK, so nothing to break the
 * Next.js build and nothing loaded in the browser (browser errors come through /api/client-error first).
 * Off until SENTRY_DSN is set. A report carries the error, where it happened and a correlation id to find
 * the full logs; never cookies, headers, request bodies, passwords or bank details.
 */

type Dsn = { endpoint: string; publicKey: string; raw: string };

/** "https://<key>@o123.ingest.sentry.io/456" → the envelope URL and key, or null if unset or malformed. */
export function parseDsn(raw: string): Dsn | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const projectId = u.pathname.replace(/^\/+|\/+$/g, "");
    if (u.protocol !== "https:" || !u.username || !/^\d+$/.test(projectId)) return null;
    return { endpoint: `https://${u.host}/api/${projectId}/envelope/`, publicKey: u.username, raw };
  } catch {
    return null; // a malformed DSN means reporting stays off; preflight/golive lists it
  }
}

/** Vendor invite links (/v/…) and record links (/r/…) are secrets in themselves: never send them on. */
export function redactPath(path: string): string {
  return path.replace(/^\/(v|r)\/[^/]+/, "/$1/[link]").replace(/^\/(orders|buy)\/[^/]+/, "/$1/[id]");
}

export function sentryEnabled(): boolean {
  return parseDsn(env().SENTRY_DSN) !== null;
}

type Frame = { function?: string; filename?: string; lineno?: number; colno?: number; in_app?: boolean };

/** V8 stack text → Sentry frames, oldest call first (Sentry's order). */
export function framesFrom(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split("\n").slice(1, 40)) {
    const m = line.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/);
    if (!m) continue;
    const filename = m[2] ?? "";
    frames.push({
      ...(m[1] ? { function: m[1] } : {}),
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !filename.includes("node_modules"),
    });
  }
  return frames.reverse();
}

export type ReportContext = {
  /** Where it happened: "route:auth.signup", "cron-tick", "browser", … Becomes a searchable tag. */
  where: string;
  correlationId?: string;
  /** Short extra facts (no personal data). */
  extra?: Record<string, string | number | boolean | null>;
  platform?: "node" | "javascript";
};

export function buildEvent(err: unknown, ctx: ReportContext, now = new Date()) {
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : "Non-error thrown");
  return {
    event_id: randomBytes(16).toString("hex"),
    timestamp: now.getTime() / 1000,
    platform: ctx.platform ?? "node",
    level: "error",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    ...(process.env.VERCEL_GIT_COMMIT_SHA ? { release: process.env.VERCEL_GIT_COMMIT_SHA } : {}),
    tags: { where: ctx.where, ...(ctx.correlationId ? { correlation_id: ctx.correlationId } : {}) },
    ...(ctx.extra ? { extra: ctx.extra } : {}),
    exception: {
      values: [{ type: e.name || "Error", value: e.message.slice(0, 1000), stacktrace: { frames: framesFrom(e.stack) } }],
    },
  };
}

/** Sends one report. Never throws: a broken error reporter must not break the request it is reporting on. */
export async function reportError(err: unknown, ctx: ReportContext, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const dsn = parseDsn(env().SENTRY_DSN);
    if (!dsn) return false;
    const event = buildEvent(err, ctx);
    const body = [JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString(), dsn: dsn.raw }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
    const res = await fetchImpl(dsn.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=procureai/1.0`,
      },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) log.warn({ status: res.status, where: ctx.where }, "sentry refused the error report");
    return res.ok;
  } catch (sendErr) {
    log.warn({ err: String(sendErr), where: ctx.where }, "could not send the error report to sentry");
    return false;
  }
}
