import { updateListing } from "@/lib/domain/listings";
import { ListingBody, type ListingBodyT } from "@/lib/http/listing-input";
import { route } from "@/lib/http/route";
import { requireAccount } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/vendor/listings/:id — the seller edits one of their products. */
export const POST = route<ListingBodyT, { id: string }>(
  { name: "vendor.listings.update", input: ListingBody, limits: ({ ip }) => [{ key: `listing-edit:${ip}`, limit: 60, windowSeconds: 3600 }] },
  async ({ input, params, req }) => {
    const account = await requireAccount(req);
    await updateListing(account, params.id, { ...input, priceKobo: input.price });
    return { body: { ok: true } };
  },
);
