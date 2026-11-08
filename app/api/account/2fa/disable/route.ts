import { z } from "zod";
import { disableTotp } from "@/lib/domain/accounts";
import { route } from "@/lib/http/route";
import { requireAccount } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ password: z.string().min(1, "Enter your password").max(200), code: z.string().trim().min(6, "Enter your code").max(20) });

/** POST /api/account/2fa/disable — needs the password and a current code. */
export const POST = route<z.output<typeof Body>>(
  { name: "account.2fa.disable", input: Body, limits: ({ ip }) => [{ key: `2fa-off:${ip}`, limit: 10, windowSeconds: 600 }] },
  async ({ input, req }) => {
    await disableTotp(await requireAccount(req), input.password, input.code);
    return { body: { ok: true } };
  },
);
