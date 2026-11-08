import { signOutEverywhere } from "@/lib/domain/accounts";
import { Empty, route } from "@/lib/http/route";
import { clearAccountCookie, requireAccount } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/account/signout-all — ends every session on every device, this one included. */
export const POST = route({ name: "account.signout-all", input: Empty }, async ({ req }) => {
  await signOutEverywhere(await requireAccount(req));
  return { body: { ok: true }, cookies: [clearAccountCookie()] };
});
