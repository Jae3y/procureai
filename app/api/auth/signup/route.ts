import { z } from "zod";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth/password";
import { signUp } from "@/lib/domain/accounts";
import { route } from "@/lib/http/route";
import { accountSessionCookie } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  email: z.email("Enter a valid email").max(120),
  password: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`).max(PASSWORD_MAX),
});

/** POST /api/auth/signup — opens an account and signs in. */
export const POST = route<z.output<typeof Body>>(
  { name: "auth.signup", input: Body, limits: ({ ip }) => [{ key: `signup:${ip}`, limit: 10, windowSeconds: 3600 }] },
  async ({ input }) => {
    const account = await signUp(input);
    return { status: 201, body: { ok: true }, cookies: [accountSessionCookie(account)] };
  },
);
