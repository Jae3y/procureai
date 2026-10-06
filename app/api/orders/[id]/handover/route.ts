import { z } from "zod";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain/errors";
import { submitHandoverCode } from "@/lib/domain/handover";
import { vendorByToken } from "@/lib/domain/vendors";
import { route } from "@/lib/http/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ token: z.string().min(20).max(64), code: z.string().regex(/^\d{6}$/, "The delivery code is 6 digits") });

/**
 * POST /api/orders/:id/handover — the vendor enters the buyer's 6-digit code. Rate-limited by
 * token and by IP in front of the 5-attempt cap; a correct code triggers Stage 2 server-side only.
 */
export const POST = route<z.output<typeof Body>, { id: string }>(
  {
    name: "orders.handover",
    input: Body,
    limits: ({ input, ip }) => [
      { key: `code-tok:${input.token.slice(0, 12)}`, limit: 8, windowSeconds: 600 },
      { key: `code-ip:${ip}`, limit: 20, windowSeconds: 600 },
    ],
  },
  async ({ params, input }) => {
    const vendor = await vendorByToken(input.token);
    const order = await db().order.findUnique({ where: { id: params.id }, select: { vendorId: true } });
    if (!order || order.vendorId !== vendor.id) throw new DomainError("forbidden", "This code isn't for your order.", 403);
    const result = await submitHandoverCode(params.id, input.code, `vendor:${vendor.id}`);
    if (result.ok) return { body: { ok: true } };
    const message =
      result.reason === "wrong"
        ? `That code isn't right. ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? "" : "s"} left.`
        : result.reason === "locked"
          ? "This code is locked after 5 wrong attempts. Ask the buyer to contact ProcureAI."
          : result.reason === "expired"
            ? "This code has expired. Ask the buyer to contact ProcureAI."
            : "This code has already been used.";
    // A wrong code is an expected answer, not a failed request: 200 with ok:false.
    return { status: 200, body: { ok: false, reason: result.reason, message, attemptsLeft: result.reason === "wrong" ? result.attemptsLeft : 0 } };
  },
);
