import { verifyVendors } from "@/lib/domain/verification";
import { Empty, route } from "@/lib/http/route";
import { requireBuyerOfRequest } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/requests/:id/verify — the Kora identity gate for every vendor that replied. */
export const POST = route<undefined, { id: string }>(
  {
    name: "requests.verify",
    input: Empty,
    idempotent: true,
    limits: ({ params, ip }) => [
      { key: `verify:${params.id}`, limit: 6, windowSeconds: 300 },
      { key: `verify-ip:${ip}`, limit: 20, windowSeconds: 300 },
    ],
  },
  async ({ params, req }) => {
    await requireBuyerOfRequest(req, params.id);
    const outcomes = await verifyVendors(params.id);
    return {
      body: {
        checked: outcomes.filter((o) => o.verification).length,
        errors: outcomes.filter((o) => o.error).map((o) => ({ label: o.label, ...o.error })),
      },
    };
  },
);
