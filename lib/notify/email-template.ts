import { COMPANY_LINE } from "@/lib/legal";

/**
 * One look for every email ProcureAI sends: a plain-text version (what spam filters and some phones
 * read) and a simple HTML version built from tables and inline styles, which is what email apps
 * reliably render. Every value is escaped; nothing a user typed can become markup.
 */

export type EmailContent = {
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  /** Small print under the button, e.g. "If you didn't ask for this, ignore this email." */
  footnote?: string;
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function renderEmail(c: EmailContent): { text: string; html: string } {
  const text = [c.heading, "", ...c.paragraphs.flatMap((p) => [p, ""]), ...(c.button ? [`${c.button.label}: ${c.button.url}`, ""] : []), ...(c.footnote ? [c.footnote, ""] : []), "ProcureAI", COMPANY_LINE].join("\n");

  const p = (s: string) => `<p style="margin:0 0 16px;font:400 16px/1.55 Arial,Helvetica,sans-serif;color:#3d3a33;">${escapeHtml(s)}</p>`;
  const button = c.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="background:#16150f;border-radius:999px;"><a href="${escapeHtml(c.button.url)}" style="display:inline-block;padding:14px 26px;font:600 15px/1 Arial,Helvetica,sans-serif;color:#f6f3ec;text-decoration:none;">${escapeHtml(c.button.label)}</a></td></tr></table>
       <p style="margin:0 0 16px;font:400 13px/1.5 Arial,Helvetica,sans-serif;color:#6b675c;">Or paste this link into your browser:<br><span style="word-break:break-all;color:#3d3a33;">${escapeHtml(c.button.url)}</span></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f3ec;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3ec;padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf8;border:1px solid #ddd7c9;border-radius:14px;">
<tr><td style="padding:28px 32px 8px;font:700 18px/1 Arial,Helvetica,sans-serif;color:#16150f;letter-spacing:-0.02em;">ProcureAI</td></tr>
<tr><td style="padding:16px 32px 8px;">
<h1 style="margin:0 0 18px;font:700 24px/1.2 Arial,Helvetica,sans-serif;color:#16150f;letter-spacing:-0.02em;">${escapeHtml(c.heading)}</h1>
${c.paragraphs.map(p).join("\n")}
${button}
${c.footnote ? `<p style="margin:0 0 8px;font:400 13px/1.5 Arial,Helvetica,sans-serif;color:#6b675c;">${escapeHtml(c.footnote)}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 32px 28px;border-top:1px solid #ddd7c9;font:400 12px/1.5 Arial,Helvetica,sans-serif;color:#6b675c;">${escapeHtml(COMPANY_LINE)}<br>You're receiving this because of your ProcureAI account.</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}
