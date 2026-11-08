import { z } from "zod";
import { db } from "@/lib/db";
import { completeLogin, verifySecondFactor } from "@/lib/domain/accounts";
import { DomainError } from "@/lib/domain/errors";
import { rateLimit } from "@/lib/http/rate-limit";
import { route } from "@/lib/http/route";
import { accountSessionCookie, clearLoginTicketCookie, loginTicketFrom } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ code: z.string().trim().min(6, "Enter the 6-digit code").max(20) });

/** POST /api/auth/login/verify — the second step: an authenticator code or a recovery code. */
export const POST = route<z.output<typeof Body>>(
  {
    name: "auth.login.verify",
    input: Body,
    limits: ({ ip }) => [{ key: `2fa-ip:${ip}`, limit: 20, windowSeconds: 600 }],
  },
  async ({ input, req, ip }) => {
    const accountId = loginTicketFrom(req);
    if (!accountId) throw new DomainError("ticket_expired", "Your sign-in took too long. Enter your password again.", 401);
    // Per account as well, so spreading guesses across addresses doesn't help: 5 tries per 10 minutes.
    await rateLimit(`2fa-account:${accountId}`, 5, 600);
    const account = await db().account.findUnique({ where: { id: accountId } });
    if (!account) throw new DomainError("ticket_expired", "Your sign-in took too long. Enter your password again.", 401);
    await verifySecondFactor(account, input.code);
    const signedIn = await completeLogin(account, { ip, userAgent: req.headers.get("user-agent") });
    return { body: { ok: true }, cookies: [accountSessionCookie(signedIn), clearLoginTicketCookie()] };
  },
);
