import { resendVerifyEmail } from "@/lib/domain/accounts";
import { rateLimit } from "@/lib/http/rate-limit";
import { Empty, route } from "@/lib/http/route";
import { requireAccount } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/account/verify-email — sends the confirmation link again. Three per hour per account. */
export const POST = route({ name: "account.verify-email", input: Empty }, async ({ req }) => {
  const account = await requireAccount(req);
  await rateLimit(`verify-resend:${account.id}`, 3, 3600);
  return { body: await resendVerifyEmail(account) };
});
