import { env } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * Outgoing email through Resend's HTTP API. Without RESEND_API_KEY nothing is sent and callers are
 * told so: the product keeps working on in-app notifications, and the sign-in screens say plainly
 * when an emailed link isn't available.
 */

export type Email = { to: string; subject: string; text: string };

export function emailEnabled(): boolean {
  return Boolean(env().RESEND_API_KEY);
}

export async function sendEmail(mail: Email): Promise<boolean> {
  const e = env();
  if (!e.RESEND_API_KEY) {
    log.info({ subject: mail.subject }, "email not sent: RESEND_API_KEY is not set");
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: e.EMAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    log.error({ status: res.status, subject: mail.subject }, "email provider refused the message");
    return false;
  }
  return true;
}
