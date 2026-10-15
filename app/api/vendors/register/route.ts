import { z } from "zod";
import { registerVendor } from "@/lib/domain/vendor-profiles";
import { route } from "@/lib/http/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  businessName: z.string().trim().min(2, "Enter your business name").max(120),
  phone: z.string().trim().min(7, "Enter your phone number").max(20),
  sells: z.string().trim().min(3, "Say what you sell, e.g. T-shirts, printing").max(200),
  city: z.string().trim().min(2, "Enter your city").max(60),
  rcNumber: z.string().trim().regex(/^(RC|BN|IT|LP|LLP)?\s?\d{4,10}$/i, "Use your CAC registration number, e.g. RC1482093"),
  bankCode: z.string().trim().regex(/^\d{3,6}$/, "Choose your bank"),
  accountNumber: z.string().trim().regex(/^\d{10}$/, "Account numbers are 10 digits"),
  email: z.email("Enter a business email").max(120),
  consent: z.literal(true, { error: "Tick the box to let ProcureAI check your business with Kora" }),
});

/** POST /api/vendors/register — a vendor joins the directory once. Details can't be overwritten here. */
export const POST = route<z.output<typeof Body>>(
  { name: "vendors.register", input: Body, idempotent: true, limits: ({ ip }) => [{ key: `vreg-ip:${ip}`, limit: 10, windowSeconds: 3600 }] },
  async ({ input }) => ({ status: 201, body: await registerVendor(input) }),
);
