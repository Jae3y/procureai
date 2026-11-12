import { z } from "zod";
import { db } from "@/lib/db";
import { DEMO_BUYER } from "@/lib/demo/script";
import { verifySession } from "@/lib/crypto";
import { refundAiRequest, useAiRequest } from "@/lib/domain/ai-allowance";
import { DomainError } from "@/lib/domain/errors";
import { createRequest, IncompleteSpecError } from "@/lib/domain/requests";
import { env } from "@/lib/env";
import { formatNaira } from "@/lib/money";
import { route } from "@/lib/http/route";
import { accountFrom, BUYER_COOKIE, buyerSessionCookie, readCookie } from "@/lib/http/session";
import { civilDay } from "@/lib/views/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ text: z.string().trim().min(5).max(500) });

/** POST /api/requests — one sentence in, a parsed request out (or what's missing). */
export const POST = route({ name: "requests.create", input: Body, idempotent: true, limits: ({ ip }) => [{ key: `req:${ip}`, limit: 20, windowSeconds: 600 }] }, async ({ input, req }) => {
  const account = await accountFrom(req);
  const cookies: string[] = [];
  let buyerId = account?.buyerId ?? verifySession("buyer-session", readCookie(req, BUYER_COOKIE));
  if (!buyerId) {
    if (!env().DEMO_MODE) throw new DomainError("sign_in_required", "Sign in to start a purchase.", 401);
    // On a shared demo (an ADMIN_TOKEN is set) every visitor gets their own buyer, so one visitor
    // can't open another's orders; a local demo keeps the single presenter buyer.
    const shared = Boolean(env().ADMIN_TOKEN);
    const existing = shared ? null : await db().buyer.findFirst({ where: { email: DEMO_BUYER.email } });
    const buyer = existing ?? (await db().buyer.create({ data: { name: DEMO_BUYER.name, email: DEMO_BUYER.email } }));
    buyerId = buyer.id;
    cookies.push(buyerSessionCookie(buyer.id));
  }
  // A signed-in buyer's purchase uses one of today's AI requests; the demo is limited by IP above.
  if (account) await useAiRequest(account);
  try {
    const request = await createRequest({ rawText: input.text, buyerId, isDemo: !account });
    return { status: 201, body: { id: request.id }, cookies };
  } catch (err) {
    if (account) await refundAiRequest(account);
    if (err instanceof IncompleteSpecError) {
      const d = err.draft;
      return {
        status: 422,
        cookies,
        body: {
          error: { code: err.code, message: err.userMessage },
          draft: {
            item: d.item,
            quantity: d.quantity?.toLocaleString("en-NG") ?? null,
            budget: d.budgetKobo !== null ? formatNaira(d.budgetKobo) : null,
            deadline: d.deadline ? civilDay(d.deadline) : null,
          },
        },
      };
    }
    throw err;
  }
});
