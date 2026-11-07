import { z } from "zod";
import { updateName } from "@/lib/domain/accounts";
import { route } from "@/lib/http/route";
import { requireAccount } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ name: z.string().trim().min(2, "Enter your name").max(80) });

/** POST /api/account/profile */
export const POST = route<z.output<typeof Body>>({ name: "account.profile", input: Body }, async ({ input, req }) => {
  await updateName(await requireAccount(req), input.name);
  return { body: { ok: true } };
});
