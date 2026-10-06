import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import pino from "pino";

/**
 * Structured logging with redaction at the logger, plus a correlation context so one purchase's
 * app actions and Kora calls share a correlationId (and orderId once known).
 *
 * Redaction is defence in depth: lib/kora/client.ts already logs a summarised payload, never the
 * whole identity response. These paths catch anything that slips through.
 */

type LogContext = { correlationId: string; orderId?: string; requestId?: string };

const storage = new AsyncLocalStorage<LogContext>();

const REDACT_PATHS = [
  "authorization",
  "*.authorization",
  "headers.authorization",
  "*.headers.authorization",
  "secretKey",
  "*.secretKey",
  "KORA_SECRET_KEY",
  "*.KORA_SECRET_KEY",
  "AI_API_KEY",
  "*.AI_API_KEY",
  "bvn",
  "*.bvn",
  "*.*.bvn",
  "date_of_birth",
  "*.date_of_birth",
  "*.*.date_of_birth",
  "handoverCode",
  "*.handoverCode",
  "image",
  "*.image",
  "*.*.image",
  "token",
  "*.token",
  "inviteToken",
  "*.inviteToken",
];

function level(): string {
  const v = process.env.LOG_LEVEL;
  return v && ["fatal", "error", "warn", "info", "debug", "trace", "silent"].includes(v) ? v : "info";
}

export const log = pino({
  level: level(),
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  base: { app: "procureai" },
  mixin() {
    const ctx = storage.getStore();
    return ctx ? { ...ctx } : {};
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export function withLogContext<T>(ctx: Partial<LogContext>, fn: () => T): T {
  const parent = storage.getStore();
  const next: LogContext = {
    correlationId: ctx.correlationId ?? parent?.correlationId ?? randomUUID(),
    ...(parent?.orderId ? { orderId: parent.orderId } : {}),
    ...(parent?.requestId ? { requestId: parent.requestId } : {}),
    ...(ctx.orderId ? { orderId: ctx.orderId } : {}),
    ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
  };
  return storage.run(next, fn);
}

export function currentCorrelationId(): string {
  return storage.getStore()?.correlationId ?? "no-correlation";
}

/** Masks an account number to its last 4 digits for logs and UI. */
export function maskAccount(account: string): string {
  return account.length <= 4 ? account : `${"•".repeat(account.length - 4)}${account.slice(-4)}`;
}
