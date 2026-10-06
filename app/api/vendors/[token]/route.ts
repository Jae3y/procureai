import { route } from "@/lib/http/route";
import { buildVendorView } from "@/lib/views/vendor-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/vendors/:token — what the vendor's phone shows. */
export const GET = route<undefined, { token: string }>(
  { name: "vendors.get", limits: ({ params, ip }) => [{ key: `vtok:${params.token.slice(0, 12)}:${ip}`, limit: 120, windowSeconds: 60 }] },
  async ({ params }) => ({ body: await buildVendorView(params.token) }),
);
