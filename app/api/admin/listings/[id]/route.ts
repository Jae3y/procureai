import { z } from "zod";
import { restoreListing, takeDownListing } from "@/lib/domain/moderation";
import { route } from "@/lib/http/route";
import { requireAdmin } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("take-down"), note: z.string().max(500) }),
  z.object({ action: z.literal("restore") }),
]);

/** POST /api/admin/listings/:id — the owner takes a listing down (with a reason the seller sees) or restores it. */
export const POST = route<z.output<typeof Body>, { id: string }>({ name: "admin.listings", input: Body }, async ({ input, params, req }) => {
  requireAdmin(req);
  if (input.action === "take-down") await takeDownListing(params.id, input.note);
  else await restoreListing(params.id);
  return { body: { ok: true } };
});
