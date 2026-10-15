import { z } from "zod";
import { resolveDispute } from "@/lib/domain/delivery";
import { route } from "@/lib/http/route";
import { requireAdmin } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ ruling: z.enum(["buyer", "vendor"]) });

/** POST /api/orders/:id/resolve — admin settles a dispute: refund the buyer, or release Stage 2 to the vendor. */
export const POST = route<z.output<typeof Body>, { id: string }>({ name: "orders.resolve", input: Body, idempotent: true }, async ({ params, req, input }) => {
  requireAdmin(req);
  return { body: await resolveDispute(params.id, input.ruling, { type: "ADMIN", id: "admin" }) };
});
