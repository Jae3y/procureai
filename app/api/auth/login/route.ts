import { z } from "zod";
import { completeLogin, logIn, normalizeEmail } from "@/lib/domain/accounts";
import { route } from "@/lib/http/route";
import { accountSessionCookie, clearLoginTicketCookie, loginTicketCookie } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ email: z.email("Enter a valid email").max(120), password: z.string().min(1, "Enter your password").max(200) });

/**
 * POST /api/auth/login — limited per address and per account, so guessing is slow from anywhere.
 * With two-step sign-in on, a correct password only earns a 5-minute ticket for /api/auth/login/verify.
 */
export const POST = route<z.output<typeof Body>>(
  {
    name: "auth.login",
    input: Body,
    limits: ({ ip, input }) => [
      { key: `login-ip:${ip}`, limit: 30, windowSeconds: 600 },
      { key: `login-email:${normalizeEmail(input.email)}`, limit: 8, windowSeconds: 600 },
    ],
  },
  async ({ input, req, ip }) => {
    const account = await logIn(input);
    if (account.totpEnabledAt) return { body: { twoFactor: true }, cookies: [loginTicketCookie(account.id)] };
    const signedIn = await completeLogin(account, { ip, userAgent: req.headers.get("user-agent") });
    return { body: { ok: true }, cookies: [accountSessionCookie(signedIn), clearLoginTicketCookie()] };
  },
);
