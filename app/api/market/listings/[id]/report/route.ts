import { z } from "zod";
import { REPORT_REASONS, reportListing } from "@/lib/domain/moderation";
import { route } from "@/lib/http/route";
import { accountFrom } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ reason: z.enum(REPORT_REASONS, { error: "Choose a reason" }), note: z.string().max(500).default("") });

/** POST /api/market/listings/:id/report — anyone can report a listing; the owner reviews it. */
export const POST = route<z.output<typeof Body>, { id: string }>(
  { name: "market.report", input: Body, limits: ({ ip }) => [{ key: `listing-report:${ip}`, limit: 5, windowSeconds: 3600 }] },
  async ({ input, params, req }) => {
    const account = await accountFrom(req);
    await reportListing(params.id, { reason: input.reason, note: input.note, accountId: account?.id ?? null });
    return { status: 201, body: { ok: true } };
  },
);
