import { createListing } from "@/lib/domain/listings";
import { ListingBody, type ListingBodyT } from "@/lib/http/listing-input";
import { route } from "@/lib/http/route";
import { requireAccount } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/vendor/listings — a registered seller adds a product to the marketplace. */
export const POST = route<ListingBodyT>(
  { name: "vendor.listings.create", input: ListingBody, idempotent: true, limits: ({ ip }) => [{ key: `listing-new:${ip}`, limit: 30, windowSeconds: 3600 }] },
  async ({ input, req }) => {
    const account = await requireAccount(req);
    const listing = await createListing(account, { ...input, priceKobo: input.price });
    return { status: 201, body: { id: listing.id } };
  },
);
