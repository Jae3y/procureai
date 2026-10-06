import { z } from "zod";
import { submitQuote } from "@/lib/domain/vendors";
import { route } from "@/lib/http/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  reply: z.string().trim().min(3, "Write your price and terms").max(1000),
  businessName: z.string().trim().min(2).max(120),
  rcNumber: z.string().trim().regex(/^(RC|BN|IT|LP|LLP)?\s?\d{4,10}$/i, "Use your CAC registration number, e.g. RC1482093"),
  bankCode: z.string().trim().regex(/^\d{3,6}$/, "Choose your bank"),
  accountNumber: z.string().trim().regex(/^\d{10}$/, "Account numbers are 10 digits"),
  email: z.email("Enter a business email").max(120),
  consent: z.literal(true, { error: "Tick the box to let ProcureAI check your business with Kora" }),
});

/** POST /api/vendors/:token/quote — the vendor's free-text reply plus the details Kora will check. */
export const POST = route<z.output<typeof Body>, { token: string }>(
  {
    name: "vendors.quote",
    input: Body,
    idempotent: true,
    limits: ({ params, ip }) => [
      { key: `vq:${params.token.slice(0, 12)}`, limit: 10, windowSeconds: 600 },
      { key: `vq-ip:${ip}`, limit: 30, windowSeconds: 600 },
    ],
  },
  async ({ params, input }) => {
    const q = await submitQuote(params.token, { ...input, rcNumber: input.rcNumber.replace(/\s+/g, "") });
    return { status: 201, body: { quoteId: q.id } };
  },
);
