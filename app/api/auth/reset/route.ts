import { z } from "zod";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth/password";
import { resetPassword } from "@/lib/domain/accounts";
import { route } from "@/lib/http/route";
import { accountSessionCookie } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  token: z.string().min(20).max(100),
  password: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`).max(PASSWORD_MAX),
  code: z.string().trim().max(20).optional(),
});

/** POST /api/auth/reset — uses the emailed link, ends every older session, signs in here. */
export const POST = route<z.output<typeof Body>>(
  { name: "auth.reset", input: Body, limits: ({ ip }) => [{ key: `reset:${ip}`, limit: 10, windowSeconds: 3600 }] },
  async ({ input }) => {
    const account = await resetPassword(input.token, input.password, input.code || undefined);
    return { body: { ok: true }, cookies: [accountSessionCookie(account)] };
  },
);
