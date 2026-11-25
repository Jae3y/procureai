import { z } from "zod";
import { attributionFrom, signupEventCookie } from "@/lib/attribution";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth/password";
import { assertAcceptablePassword } from "@/lib/auth/password-policy";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { normalizeEmail, signUp } from "@/lib/domain/accounts";
import { DomainError } from "@/lib/domain/errors";
import { normalizeNigerianPhone } from "@/lib/domain/vendor-profiles";
import { route } from "@/lib/http/route";
import { accountSessionCookie } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const HEARD_FROM = ["WHATSAPP", "INSTAGRAM", "X", "FACEBOOK", "FRIEND", "EVENT", "SEARCH", "OTHER"] as const;

/** A person needs a few seconds to fill this in; a script posting straight to the API doesn't. */
const MIN_FILL_MS = 3_000;
const MAX_FILL_MS = 24 * 60 * 60 * 1000;

const Body = z.object({
  firstName: z.string().trim().min(1, "Enter your first name").max(40),
  lastName: z.string().trim().min(1, "Enter your last name").max(40),
  email: z.email("Enter a valid email").max(120),
  phone: z.string().trim().min(7, "Enter your phone number").max(20),
  password: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`).max(PASSWORD_MAX),
  intent: z.enum(["BUY", "SELL", "BOTH"], { error: "Tell us how you'll use ProcureAI" }),
  organisation: z.string().trim().max(120).optional(),
  heardFrom: z.enum(HEARD_FROM).optional(),
  marketingOptIn: z.boolean().default(false),
  acceptTerms: z.literal(true, { error: "Tick the box to agree to the terms" }),
  /** Honeypot: real people never see this field, bots fill every field they find. */
  website: z.string().max(0).optional(),
  openedAt: z.number().int(),
  turnstileToken: z.string().max(2048).optional(),
});

/** POST /api/auth/signup — opens an account and signs in. */
export const POST = route<z.output<typeof Body>>(
  { name: "auth.signup", input: Body, limits: ({ ip }) => [{ key: `signup:${ip}`, limit: 10, windowSeconds: 3600 }] },
  async ({ input, ip, req }) => {
    const age = Date.now() - input.openedAt;
    if (age < MIN_FILL_MS || age > MAX_FILL_MS) {
      throw new DomainError("too_fast", "That was quick. Check your details and press the button again.", 400);
    }
    let phone: string;
    try {
      phone = normalizeNigerianPhone(input.phone);
    } catch (err) {
      if (err instanceof DomainError) throw new DomainError(err.code, err.userMessage, 400, { issues: [{ path: "phone", message: err.userMessage }] });
      throw err;
    }
    // Cloudflare's token works once. Everything that can refuse the form is checked first, so a refused password
    // or a taken email doesn't spend it and make the next try fail the bot check.
    const name = `${input.firstName} ${input.lastName}`;
    await assertAcceptablePassword(input.password, { email: normalizeEmail(input.email), name });
    if (await db().account.findUnique({ where: { email: normalizeEmail(input.email) }, select: { id: true } })) {
      throw new DomainError("email_taken", "There's already an account with this email. Sign in instead.", 409, { issues: [{ path: "email", message: "This email already has an account. Sign in instead." }] });
    }
    await verifyTurnstile(input.turnstileToken, ip);
    const account = await signUp({
      name,
      passwordChecked: true,
      email: input.email,
      password: input.password,
      phone,
      intent: input.intent,
      ...(input.organisation ? { organisation: input.organisation } : {}),
      ...(input.heardFrom ? { heardFrom: input.heardFrom } : {}),
      marketingOptIn: input.marketingOptIn,
      attribution: attributionFrom(req),
    });
    return { status: 201, body: { ok: true, intent: input.intent }, cookies: [accountSessionCookie(account), signupEventCookie("email", env().APP_BASE_URL.startsWith("https://"))] };
  },
);
