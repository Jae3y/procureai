import { exportAccountData } from "@/lib/domain/accounts";
import { route } from "@/lib/http/route";
import { requireAccount } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/account/export — everything ProcureAI holds about the signed-in person, as JSON. */
export const GET = route({ name: "account.export" }, async ({ req }) => ({ body: await exportAccountData(await requireAccount(req)) }));
