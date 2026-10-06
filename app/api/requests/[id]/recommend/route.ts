import { recommend } from "@/lib/domain/recommend";
import { Empty, route } from "@/lib/http/route";
import { requireBuyerOfRequest } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/requests/:id/recommend — rank verified quotes; unverified vendors can't be chosen. */
export const POST = route<undefined, { id: string }>(
  { name: "requests.recommend", input: Empty, idempotent: true, limits: ({ params }) => [{ key: `rec:${params.id}`, limit: 10, windowSeconds: 300 }] },
  async ({ params, req }) => {
    await requireBuyerOfRequest(req, params.id);
    const r = await recommend(params.id);
    return { body: { id: r.id, chosenQuoteId: r.chosenQuoteId, parsedBy: r.parsedBy } };
  },
);
