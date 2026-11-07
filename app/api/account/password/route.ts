import { z } from "zod";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth/password";
import { changePassword } from "@/lib/domain/accounts";
import { route } from "@/lib/http/route";
import { accountSessionCookie, requireAccount } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ current: z.string().min(1, "Enter your current password").max(200), next: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`).max(PASSWORD_MAX) });

/** POST /api/account/password — ends every other session; this browser gets a fresh one. */
export const POST = route<z.output<typeof Body>>(
  { name: "account.password", input: Body, limits: ({ ip }) => [{ key: `pw-change:${ip}`, limit: 10, windowSeconds: 600 }] },
  async ({ input, req }) => {
    const account = await changePassword(await requireAccount(req), input.current, input.next);
    return { body: { ok: true }, cookies: [accountSessionCookie(account)] };
  },
);
