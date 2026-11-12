import { z } from "zod";
import { requireCurrentPassword, verifySecondFactor } from "@/lib/domain/accounts";
import { updateVendorProfile } from "@/lib/domain/vendor-profiles";
import { route } from "@/lib/http/route";
import { optionalRcNumber, ownerNameField, requireOwnerNameWithoutRc } from "@/lib/http/seller-fields";
import { requireAccount } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  businessName: z.string().trim().min(2, "Enter your business name").max(120),
  sells: z.string().trim().min(3, "Say what you sell").max(200),
  city: z.string().trim().min(2, "Enter your city").max(60),
  rcNumber: optionalRcNumber,
  ownerName: ownerNameField,
  bankCode: z.string().trim().regex(/^\d{3,6}$/, "Choose your bank"),
  accountNumber: z.string().trim().regex(/^\d{10}$/, "Account numbers are 10 digits"),
  email: z.email("Enter a business email").max(120),
  password: z.string().min(1, "Enter your password to confirm").max(200),
  /** Authenticator code: required only when the payout bank account changes. */
  code: z.string().trim().max(20).optional(),
}).superRefine(requireOwnerNameWithoutRc);

/** POST /api/vendor/profile — needs the password, because these details decide where money goes. */
export const POST = route<z.output<typeof Body>>(
  { name: "vendor.profile", input: Body, limits: ({ ip }) => [{ key: `vprofile:${ip}`, limit: 10, windowSeconds: 600 }] },
  async ({ input, req }) => {
    const account = await requireAccount(req);
    const { password, code, ...profile } = input;
    await requireCurrentPassword(account, password);
    const r = await updateVendorProfile(account, profile, (c) => verifySecondFactor(account, c), code || undefined);
    return { body: { ok: true, bankChangeEffectiveAt: r.bankChangeEffectiveAt?.toISOString() ?? null } };
  },
);
