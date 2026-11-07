import { z } from "zod";
import { normalizeEmail, requestPasswordReset } from "@/lib/domain/accounts";
import { route } from "@/lib/http/route";
import { log } from "@/lib/log";
import { emailEnabled } from "@/lib/notify/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ email: z.email("Enter a valid email").max(120) });

/** POST /api/auth/forgot — answers the same whether or not the account exists. */
export const POST = route<z.output<typeof Body>>(
  {
    name: "auth.forgot",
    input: Body,
    limits: ({ ip, input }) => [
      { key: `forgot-ip:${ip}`, limit: 10, windowSeconds: 3600 },
      { key: `forgot-email:${normalizeEmail(input.email)}`, limit: 3, windowSeconds: 3600 },
    ],
  },
  async ({ input }) => {
    if (!emailEnabled()) return { body: { sent: false } };
    await requestPasswordReset(input.email).catch((err: unknown) => log.error({ err }, "password reset email failed"));
    return { body: { sent: true } };
  },
);
