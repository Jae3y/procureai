import { db } from "@/lib/db";
import { Empty, route } from "@/lib/http/route";
import { requireAccount } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/account/notifications/read — marks everything read. */
export const POST = route({ name: "account.notifications.read", input: Empty }, async ({ req }) => {
  const account = await requireAccount(req);
  await db().notification.updateMany({ where: { accountId: account.id, readAt: null }, data: { readAt: new Date() } });
  return { body: { ok: true } };
});
