import { z } from "zod";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { normalizeEmail, signUp } from "@/lib/domain/accounts";
import { DomainError } from "@/lib/domain/errors";
import { registerVendor } from "@/lib/domain/vendor-profiles";
import { accountFrom, accountSessionCookie } from "@/lib/http/session";
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
  consent: z.literal(true, { error: "Tick the box to let ProcureAI check your business and bank account" }),
  /** Opens an account with the profile. Not needed when already signed in. */
  password: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`).max(PASSWORD_MAX).optional(),
});

/** POST /api/vendors/register — a vendor joins the directory once. Details can't be overwritten here. */
export const POST = route<z.output<typeof Body>>(
  { name: "vendors.register", input: Body, idempotent: true, limits: ({ ip }) => [{ key: `vreg-ip:${ip}`, limit: 10, windowSeconds: 3600 }] },
  async ({ input, req }) => {
    const signedIn = await accountFrom(req);
    if (signedIn?.vendorContactId) throw new DomainError("already_vendor", "This account already has a vendor profile.", 409);
    if (!signedIn && input.password) {
      const taken = await db().account.findUnique({ where: { email: normalizeEmail(input.email) }, select: { id: true } });
      if (taken) throw new DomainError("email_taken", "There's already an account with this email. Sign in, then register your business.", 409);
    }
    const { password, ...profile } = input;
    const created = await registerVendor(profile);
    const account = signedIn ?? (password ? await signUp({ name: created.businessName, email: input.email, password }) : null);
    if (!account) return { status: 201, body: created };
    await db().account.update({ where: { id: account.id }, data: { vendorContactId: created.id } });
    return { status: 201, body: created, cookies: signedIn ? [] : [accountSessionCookie(account)] };
  },
);
