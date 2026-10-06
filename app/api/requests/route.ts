import { z } from "zod";
import { db } from "@/lib/db";
import { DEMO_BUYER } from "@/lib/demo/script";
import { createRequest, IncompleteSpecError } from "@/lib/domain/requests";
import { env } from "@/lib/env";
import { formatNaira } from "@/lib/money";
import { route } from "@/lib/http/route";
import { buyerIdFrom, buyerSessionCookie } from "@/lib/http/session";
import { civilDay } from "@/lib/views/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  text: z.string().trim().min(5).max(500),
  buyerName: z.string().trim().min(2).max(80).optional(),
  buyerEmail: z.email().max(120).optional(),
});

/** POST /api/requests — one sentence in, a parsed request out (or what's missing). */
export const POST = route({ name: "requests.create", input: Body, idempotent: true, limits: ({ ip }) => [{ key: `req:${ip}`, limit: 20, windowSeconds: 600 }] }, async ({ input, req }) => {
  let buyerId = buyerIdFrom(req);
  const cookies: string[] = [];
  if (!buyerId) {
    const name = input.buyerName ?? (env().DEMO_MODE ? DEMO_BUYER.name : null);
    const email = input.buyerEmail ?? (env().DEMO_MODE ? DEMO_BUYER.email : null);
    if (!name || !email) {
      return { status: 400, body: { error: { code: "buyer_details", message: "Add your name and email so Kora can send your receipt." } } };
    }
    const buyer = (await db().buyer.findFirst({ where: { email } })) ?? (await db().buyer.create({ data: { name, email } }));
    buyerId = buyer.id;
    cookies.push(buyerSessionCookie(buyer.id));
  }
  try {
    const request = await createRequest({ rawText: input.text, buyerId });
    return { status: 201, body: { id: request.id }, cookies };
  } catch (err) {
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
