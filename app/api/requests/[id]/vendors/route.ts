import { z } from "zod";
import { addBuyerVendor } from "@/lib/domain/requests";
import { route } from "@/lib/http/route";
import { requireBuyerOfRequest } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  businessName: z.string().trim().min(2, "Enter the vendor's business name").max(120),
  phone: z.string().trim().min(7, "Enter the vendor's phone number").max(20),
});

/** POST /api/requests/:id/vendors — the buyer brings a vendor they know, and gets the link to send them. */
export const POST = route<z.output<typeof Body>, { id: string }>(
  { name: "requests.vendors.add", input: Body, limits: ({ params }) => [{ key: `add-vendor:${params.id}`, limit: 30, windowSeconds: 3600 }] },
  async ({ params, input, req }) => {
    await requireBuyerOfRequest(req, params.id);
    const invite = await addBuyerVendor(params.id, input);
    return { status: 201, body: { label: invite.label } };
  },
);
