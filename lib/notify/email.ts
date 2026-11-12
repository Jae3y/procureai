import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { type EmailContent, renderEmail } from "./email-template";

/**
 * Outgoing email through Resend's HTTP API. Without RESEND_API_KEY nothing is sent and callers are
 * told so: the product keeps working on in-app notifications, and the sign-in screens say plainly
 * when an emailed link isn't available.
 */

export type Email = { to: string; subject: string; content: EmailContent };

export function emailEnabled(): boolean {
  return Boolean(env().RESEND_API_KEY);
}

export async function sendEmail(mail: Email): Promise<boolean> {
  const e = env();
  if (!e.RESEND_API_KEY) {
    log.info({ subject: mail.subject }, "email not sent: RESEND_API_KEY is not set");
    return false;
  }
  const { text, html } = renderEmail(mail.content);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: e.EMAIL_FROM,
      to: [mail.to],
      subject: mail.subject,
      text,
      html,
      ...(e.EMAIL_REPLY_TO ? { reply_to: e.EMAIL_REPLY_TO } : {}),
      // One-click unsubscribe (RFC 8058): mail apps show their own "Unsubscribe" button.
      ...(mail.content.unsubscribeUrl ? { headers: { "List-Unsubscribe": `<${mail.content.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    log.error({ status: res.status, subject: mail.subject, body: (await res.text()).slice(0, 300) }, "email provider refused the message");
    return false;
  }
  return true;
}
