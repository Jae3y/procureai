import { requestFromListing } from "@/lib/domain/listings";
import { ListingRequestBody } from "@/lib/http/listing-input";
import { route } from "@/lib/http/route";
import { requireAccount } from "@/lib/http/session";
import type { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/market/listings/:id/request — start a protected purchase from a marketplace listing. */
export const POST = route<z.output<typeof ListingRequestBody>, { id: string }>(
  { name: "market.request", input: ListingRequestBody, idempotent: true, limits: ({ ip }) => [{ key: `market-req:${ip}`, limit: 20, windowSeconds: 600 }] },
  async ({ input, params, req }) => {
    const account = await requireAccount(req);
    if (input.budget === null) throw new Error("budget is validated as required");
    const request = await requestFromListing(account, params.id, { quantity: input.quantity, budgetKobo: input.budget, deadline: input.deadline, alsoAskOthers: input.alsoAskOthers });
    return { status: 201, body: { id: request.id } };
  },
);
