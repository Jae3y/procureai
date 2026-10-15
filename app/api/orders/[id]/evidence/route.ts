import { addDisputeEvidence } from "@/lib/domain/delivery";
import { DomainError } from "@/lib/domain/errors";
import { EvidenceBody, type EvidenceBodyT } from "@/lib/http/evidence-input";
import { route } from "@/lib/http/route";
import { buyerIdFrom, requireBuyerOfOrder } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/orders/:id/evidence — the buyer's side of a dispute. Only the buyer, not an admin. */
export const POST = route<EvidenceBodyT, { id: string }>(
  { name: "orders.evidence", input: EvidenceBody, idempotent: true, limits: ({ params }) => [{ key: `evid-b:${params.id}`, limit: 10, windowSeconds: 600 }] },
  async ({ params, req, input }) => {
    const buyerId = await requireBuyerOfOrder(req, params.id);
    if (buyerIdFrom(req) !== buyerId) throw new DomainError("forbidden", "Only the buyer can add evidence here.", 403);
    await addDisputeEvidence(params.id, "BUYER", input);
    return { status: 201, body: { ok: true } };
  },
);
