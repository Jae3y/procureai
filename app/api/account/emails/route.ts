import { z } from "zod";
import { db } from "@/lib/db";
import { route } from "@/lib/http/route";
import { requireAccount } from "@/lib/http/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ checkins: z.boolean(), tips: z.boolean() });

/**
 * POST /api/account/emails — the person's own email choices. `checkins` covers the welcome and the
 * "did it arrive well?" notes; `tips` is the marketing consent (NDPA: opt-in, separate, revocable).
 * Security and order emails are not affected: they keep the account and the money safe.
 */
export const POST = route<z.output<typeof Body>>({ name: "account.emails", input: Body }, async ({ input, req }) => {
  const account = await requireAccount(req);
  const tips = input.tips && input.checkins; // tips are part of "emails from us"; turning those off turns tips off too
  await db().account.update({
    where: { id: account.id },
    data: {
      emailsOffAt: input.checkins ? null : (account.emailsOffAt ?? new Date()),
      marketingConsentAt: tips ? (account.marketingConsentAt ?? new Date()) : null,
    },
  });
  return { body: { ok: true, checkins: input.checkins, tips } };
});
