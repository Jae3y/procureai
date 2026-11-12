import { z } from "zod";
import { setListingStatus } from "@/lib/domain/listings";
import { route } from "@/lib/http/route";
import { requireAccount } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ status: z.enum(["ACTIVE", "PAUSED", "REMOVED"]) });

/** POST /api/vendor/listings/:id/status — show, pause or remove a product. */
export const POST = route<z.output<typeof Body>, { id: string }>({ name: "vendor.listings.status", input: Body }, async ({ input, params, req }) => {
  await setListingStatus(await requireAccount(req), params.id, input.status);
  return { body: { ok: true } };
});
