import { z } from "zod";
import { DomainError } from "@/lib/domain/errors";
import { EnvError } from "@/lib/env";
import { isKoraError } from "@/lib/kora/errors";
import { currentCorrelationId, log, withLogContext } from "@/lib/log";
import { errorReply, jsonText, withIdempotency } from "./idempotency";
import { rateLimit } from "./rate-limit";
import { clientIp } from "./session";

/**
 * Every API route goes through here: Zod-validated input, typed error → status mapping (no raw Kora
 * payloads leak), optional rate limits, optional Idempotency-Key, a correlation id on every response.
 */

export type Reply = { status?: number; body: unknown; cookies?: string[] };

type Handler<I, P> = (args: { input: I; params: P; req: Request; ip: string }) => Promise<Reply>;

export type RouteOptions<I, P> = {
  name: string;
  input?: z.ZodType<I>;
  /** Honour the Idempotency-Key header (mutating routes). */
  idempotent?: boolean;
  limits?: (args: { params: P; ip: string; input: I }) => Array<{ key: string; limit: number; windowSeconds: number }>;
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}, cookies: string[] = []): Response {
  const h = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", "x-correlation-id": currentCorrelationId(), ...headers });
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(jsonText(body), { status, headers: h });
}

export function route<I = undefined, P extends Record<string, string> = Record<string, string>>(
  opts: RouteOptions<I, P>,
  handler: Handler<I, P>,
): (req: Request, ctx: { params: Promise<P> }) => Promise<Response> {
  return (req, ctx) =>
    withLogContext({}, async () => {
      const ip = clientIp(req);
      try {
        const params = await ctx.params;
        let raw = "";
        let input = undefined as I;
        if (opts.input) {
          raw = req.method === "GET" ? "" : await req.text();
          let parsedBody: unknown = {};
          if (raw.trim()) {
            try {
              parsedBody = JSON.parse(raw);
            } catch {
              throw new DomainError("bad_json", "The request body is not valid JSON.", 400);
            }
          }
          const r = opts.input.safeParse(parsedBody);
          if (!r.success) {
            throw new DomainError("invalid_input", "Some fields are missing or invalid.", 400, {
              issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
            });
          }
          input = r.data;
        }
        for (const l of opts.limits?.({ params, ip, input }) ?? []) await rateLimit(l.key, l.limit, l.windowSeconds);

        const run = async () => {
          const reply = await handler({ input, params, req, ip });
          return { status: reply.status ?? 200, body: reply.body, cookies: reply.cookies ?? [] };
        };

        const key = req.headers.get("idempotency-key");
        if (opts.idempotent && key) {
          let cookies: string[] = [];
          const result = await withIdempotency(`${opts.name}:${JSON.stringify(params)}`, key, raw, async () => {
            const r = await run();
            cookies = r.cookies;
            return { status: r.status, body: r.body };
          });
          return json(result.body, result.status, result.replayed ? { "Idempotent-Replay": "true" } : {}, cookies);
        }
        const r = await run();
        return json(r.body, r.status, {}, r.cookies);
      } catch (err) {
        if (err instanceof DomainError) {
          if (err.status >= 500) log.error({ err, route: opts.name }, "route failed");
          const reply = errorReply(err);
          return json(reply.body, reply.status, err.code === "rate_limited" ? { "Retry-After": String(err.details?.retryAfter ?? 60) } : {});
        }
        if (isKoraError(err)) {
          log.warn({ route: opts.name, kora: err.toJSON() }, "route: kora error");
          const reply = errorReply(err);
          return json(reply.body, reply.status);
        }
        if (err instanceof EnvError) {
          log.error({ problems: err.problems }, "environment not configured");
          return json({ error: { code: "not_configured", message: err.message } }, 503);
        }
        log.error({ err, route: opts.name }, "unhandled route error");
        return json({ error: { code: "internal", message: "Something went wrong on our side.", correlationId: currentCorrelationId() } }, 500);
      }
    });
}

export const Empty = z.object({}).strict().optional().transform(() => undefined);
