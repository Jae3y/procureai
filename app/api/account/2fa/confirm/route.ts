import { z } from "zod";
import { confirmTotpSetup } from "@/lib/domain/accounts";
import { route } from "@/lib/http/route";
import { requireAccount } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ code: z.string().trim().min(6, "Enter the 6-digit code").max(10) });

/** POST /api/account/2fa/confirm — the first code from the app turns two-step sign-in on. */
export const POST = route<z.output<typeof Body>>(
  { name: "account.2fa.confirm", input: Body, limits: ({ ip }) => [{ key: `2fa-confirm:${ip}`, limit: 10, windowSeconds: 600 }] },
  async ({ input, req }) => ({ body: { recoveryCodes: await confirmTotpSetup(await requireAccount(req), input.code) } }),
);
