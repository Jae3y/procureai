import { markDelivered } from "@/lib/domain/delivery";
import { orderIdForVendorToken } from "@/lib/domain/messages";
import { vendorByToken } from "@/lib/domain/vendors";
import { EvidenceBody, type EvidenceBodyT } from "@/lib/http/evidence-input";
import { route } from "@/lib/http/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/vendors/:token/delivered — the vendor marks the order delivered, with a note and an optional photo. */
export const POST = route<EvidenceBodyT, { token: string }>(
  { name: "vendors.delivered", input: EvidenceBody, idempotent: true, limits: ({ params }) => [{ key: `deliv:${params.token.slice(0, 12)}`, limit: 10, windowSeconds: 600 }] },
  async ({ params, input }) => {
    const vendor = await vendorByToken(params.token);
    const orderId = await orderIdForVendorToken(params.token);
    const r = await markDelivered(orderId, vendor.id, input);
    return { body: { autoReleaseAt: r.autoReleaseAt.toISOString() } };
  },
);
