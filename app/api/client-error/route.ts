import { z } from "zod";
import { route } from "@/lib/http/route";
import { redactPath, reportError, sentryEnabled } from "@/lib/notify/sentry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  message: z.string().trim().min(1).max(500),
  name: z.string().trim().max(80).default("Error"),
  stack: z.string().max(4000).default(""),
  digest: z.string().max(80).optional(),
  /** The path only (no query string, which can carry tokens). */
  path: z.string().max(200).regex(/^\/[^?#]*$/, "path only").default("/"),
});

/**
 * POST /api/client-error — a page crashed in someone's browser. Forwarded to Sentry from the server, so the
 * browser never talks to Sentry directly (no third-party script, no CSP change). Rate-limited per address;
 * answers the same either way so a crashing page never shows a second error.
 */
export const POST = route<z.output<typeof Body>>(
  { name: "client-error", input: Body, limits: ({ ip }) => [{ key: `client-error:${ip}`, limit: 10, windowSeconds: 600 }] },
  async ({ input }) => {
    if (sentryEnabled()) {
      const e = new Error(input.message);
      e.name = input.name || "Error";
      e.stack = input.stack ? `${e.name}: ${input.message}\n${input.stack.split("\n").slice(1).join("\n")}` : e.stack;
      await reportError(e, { where: "browser", platform: "javascript", extra: { path: redactPath(input.path), digest: input.digest ?? null } });
    }
    return { body: { ok: true } };
  },
);
