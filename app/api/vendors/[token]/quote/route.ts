import { z } from "zod";
import { submitQuote } from "@/lib/domain/vendors";
import { route } from "@/lib/http/route";
import { optionalRcNumber, ownerNameField, requireOwnerNameWithoutRc } from "@/lib/http/seller-fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Details = z
  .object({
    businessName: z.string().trim().min(2).max(120),
    rcNumber: optionalRcNumber,
    ownerName: ownerNameField,
    bankCode: z.string().trim().regex(/^\d{3,6}$/, "Choose your bank"),
    accountNumber: z.string().trim().regex(/^\d{10}$/, "Account numbers are 10 digits"),
    email: z.email("Enter a business email").max(120),
    consent: z.literal(true, { error: "Tick the box to let ProcureAI check your business and bank account" }),
  })
  .superRefine(requireOwnerNameWithoutRc);
const DETAIL_KEYS = ["businessName", "rcNumber", "ownerName", "bankCode", "accountNumber", "email", "consent"] as const;
/**
 * A registered vendor sends just the reply; anyone else sends the reply plus the details ProcureAI will check.
 * A CAC number is optional: without one, the name on the bank account is checked instead.
 * When any detail is sent, all of them are validated field by field (so the form can show each message).
 */
const Body = z
  .object({
    reply: z.string().trim().min(3, "Write your price and terms").max(1000),
    businessName: z.string().max(120).optional(),
    rcNumber: z.string().max(20).optional(),
    ownerName: z.string().max(120).optional(),
    bankCode: z.string().max(10).optional(),
    accountNumber: z.string().max(20).optional(),
    email: z.string().max(120).optional(),
    consent: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (!DETAIL_KEYS.some((k) => v[k] !== undefined && v[k] !== "" && v[k] !== false)) return;
    const r = Details.safeParse(v);
    if (!r.success) for (const issue of r.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  });

/** POST /api/vendors/:token/quote — the vendor's free-text reply plus the details ProcureAI will check. */
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
    const q = await submitQuote(params.token, { ...input, rcNumber: input.rcNumber?.replace(/\s+/g, "") });
    return { status: 201, body: { quoteId: q.id } };
  },
);
