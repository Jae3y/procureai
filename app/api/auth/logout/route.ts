import { Empty, route } from "@/lib/http/route";
import { clearAccountCookie } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/logout */
export const POST = route({ name: "auth.logout", input: Empty }, async () => ({ body: { ok: true }, cookies: [clearAccountCookie()] }));
