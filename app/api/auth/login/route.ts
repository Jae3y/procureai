import { z } from "zod";
import { logIn, normalizeEmail } from "@/lib/domain/accounts";
import { route } from "@/lib/http/route";
import { accountSessionCookie } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ email: z.email("Enter a valid email").max(120), password: z.string().min(1, "Enter your password").max(200) });

/** POST /api/auth/login — limited per address and per account, so guessing is slow from anywhere. */
export const POST = route<z.output<typeof Body>>(
  {
    name: "auth.login",
    input: Body,
    limits: ({ ip, input }) => [
      { key: `login-ip:${ip}`, limit: 30, windowSeconds: 600 },
      { key: `login-email:${normalizeEmail(input.email)}`, limit: 8, windowSeconds: 600 },
    ],
  },
  async ({ input }) => {
    const account = await logIn(input);
    return { body: { ok: true }, cookies: [accountSessionCookie(account)] };
  },
);
