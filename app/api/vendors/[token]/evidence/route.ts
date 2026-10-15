import { addDisputeEvidence } from "@/lib/domain/delivery";
import { orderIdForVendorToken } from "@/lib/domain/messages";
import { EvidenceBody, type EvidenceBodyT } from "@/lib/http/evidence-input";
import { route } from "@/lib/http/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/vendors/:token/evidence — the vendor's side of a dispute. */
export const POST = route<EvidenceBodyT, { token: string }>(
  { name: "vendors.evidence", input: EvidenceBody, idempotent: true, limits: ({ params }) => [{ key: `evid-v:${params.token.slice(0, 12)}`, limit: 10, windowSeconds: 600 }] },
  async ({ params, input }) => {
    await addDisputeEvidence(await orderIdForVendorToken(params.token), "VENDOR", input);
    return { status: 201, body: { ok: true } };
  },
);
