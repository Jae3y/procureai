import { requestDeletion } from "@/lib/domain/accounts";
import { Empty, route } from "@/lib/http/route";
import { requireAccount } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/account/delete — asks for deletion. A person acts on it; payment records are kept as the law requires. */
export const POST = route({ name: "account.delete", input: Empty }, async ({ req }) => {
  await requestDeletion(await requireAccount(req));
  return { body: { ok: true } };
});
