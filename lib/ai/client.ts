import { randomInt } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * Server-side chat client for any OpenAI-compatible endpoint (Gemini via Google AI Studio, Groq,
 * OpenAI…), chosen by AI_BASE_URL / AI_MODEL. Temperature 0, JSON output, Zod-validated, 2 retries.
 * Every failure becomes AiUnavailableError so callers fall back to the deterministic parser.
 */

export class AiUnavailableError extends Error {
  constructor(
    readonly reason: "disabled" | "timeout" | "http" | "invalid-output",
    message: string,
  ) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

const ChatResponse = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

export type AiResult<T> = { data: T; model: string };

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike = (input, init) => fetch(input, init);

/** Test hook: swap the transport. */
export function setAiFetchForTests(f: FetchLike | undefined): void {
  fetchImpl = f ?? ((input, init) => fetch(input, init));
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

type ChatOpts<S extends z.ZodType> = { task: string; system: string; user: string; schema: S; timeoutMs?: number };
type Provider = { key: string; baseUrl: string; model: string };

/**
 * Asks the primary provider; if it is unavailable (overloaded, retired model, bad key, timeout) and a
 * backup is configured (AI_BACKUP_*), asks that one before the caller falls back to rules.
 */
export async function chatJson<S extends z.ZodType>(opts: ChatOpts<S>): Promise<AiResult<z.output<S>>> {
  const e = env();
  if (!e.AI_API_KEY) throw new AiUnavailableError("disabled", "AI_API_KEY is not set; using the rule-based parser");
  try {
    return await callProvider({ key: e.AI_API_KEY, baseUrl: e.AI_BASE_URL, model: e.AI_MODEL }, opts);
  } catch (err) {
    if (!(err instanceof AiUnavailableError) || !e.AI_BACKUP_API_KEY) throw err;
    log.warn({ ai: { task: opts.task, error: err.message } }, "primary AI unavailable; trying the backup provider");
    return callProvider({ key: e.AI_BACKUP_API_KEY, baseUrl: e.AI_BACKUP_BASE_URL, model: e.AI_BACKUP_MODEL }, opts);
  }
}

async function callProvider<S extends z.ZodType>(p: Provider, opts: ChatOpts<S>): Promise<AiResult<z.output<S>>> {
  const url = `${p.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  // Gemini's current models "think" before answering (26 s vs 3 s here), which blows the request timeout
  // and silently pushes every call to the fallback. Google's OpenAI-compatible endpoint takes
  // reasoning_effort "none"; other providers may reject unknown fields, so it is sent to Google only.
  const thinking = new URL(url).hostname === "generativelanguage.googleapis.com" ? { reasoning_effort: "none" } : {};
  const body = JSON.stringify({
    model: p.model,
    ...thinking,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });

  let last: AiUnavailableError | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = performance.now();
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
      });
      const latencyMs = Math.round(performance.now() - started);
      if (!res.ok) {
        const text = (await res.text()).slice(0, 300);
        last = new AiUnavailableError("http", `${opts.task}: AI provider returned HTTP ${res.status}: ${text}`);
        log.warn({ ai: { task: opts.task, attempt, status: res.status, latencyMs } }, "ai http error");
        // Auth/config problems won't fix themselves on retry.
        if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) throw last;
      } else {
        const parsed = ChatResponse.safeParse(await res.json());
        const content = parsed.success ? parsed.data.choices[0]?.message.content : null;
        let json: unknown = null;
        try {
          json = content ? JSON.parse(stripFences(content)) : null;
        } catch {
          json = null; // treated as invalid output below
        }
        const result = opts.schema.safeParse(json);
        if (result.success) {
          log.info({ ai: { task: opts.task, attempt, latencyMs, model: parsed.success ? parsed.data.model : p.model } }, "ai ok");
          return { data: result.data, model: (parsed.success && parsed.data.model) || p.model };
        }
        last = new AiUnavailableError("invalid-output", `${opts.task}: AI output did not match the expected shape`);
        log.warn({ ai: { task: opts.task, attempt, latencyMs } }, "ai invalid output");
      }
    } catch (err) {
      if (err instanceof AiUnavailableError) throw err;
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      last = new AiUnavailableError(timedOut ? "timeout" : "http", `${opts.task}: ${timedOut ? "AI timed out" : `AI request failed: ${String(err)}${err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : ""}`}`);
      log.warn({ ai: { task: opts.task, attempt, error: last.message } }, "ai request failed");
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 300 * attempt + randomInt(0, 200)));
  }
  throw last ?? new AiUnavailableError("http", `${opts.task}: AI unavailable`);
}
