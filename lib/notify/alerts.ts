import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { sendEmail } from "./email";

/**
 * Tells the owner, by email, when something breaks that nobody would otherwise see: an unexpected server error,
 * a failed background run. One email per kind of problem per hour at most (a shared counter in the database, so
 * many servers don't all send the same alert), and never the error's private details beyond what's needed.
 */

export const ALERT_EVERY_MS = 60 * 60 * 1000;

/** True if this alert key may send now (and records that it did). Atomic across servers. */
async function claimAlertSlot(key: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - ALERT_EVERY_MS);
  const claimed = await db().$executeRaw`
    INSERT INTO "RateLimit" ("key", "windowStart", "count") VALUES (${`alert:${key}`}, ${now}, 1)
    ON CONFLICT ("key") DO UPDATE SET "windowStart" = ${now}, "count" = 1
    WHERE "RateLimit"."windowStart" < ${since}`;
  return claimed > 0;
}

export async function alertOwner(key: string, subject: string, lines: string[], now = new Date()): Promise<boolean> {
  const to = env().OPS_ALERT_EMAIL.trim();
  if (!to) return false;
  try {
    if (!(await claimAlertSlot(key, now))) return false;
    return await sendEmail({
      to,
      subject: `ProcureAI alert: ${subject}`,
      content: {
        heading: subject,
        paragraphs: [...lines, "You'll get at most one email like this an hour. The server logs have the full details."],
        button: { label: "Open the admin page", url: `${env().APP_BASE_URL}/admin` },
      },
    });
  } catch (err) {
    log.error({ err, key }, "could not send the owner alert");
    return false;
  }
}
