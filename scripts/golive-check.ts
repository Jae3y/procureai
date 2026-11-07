/**
 * npm run golive:check — what still stands between this deployment and taking real money.
 * Reads the environment (from .env, or `vercel env pull` output passed as ENV_FILE) and prints
 * READY / NOT YET for each item. Prints no secret values, only whether each one is set.
 */
import { config } from "dotenv";
import { LEGAL_REVIEWED } from "@/lib/legal";

config({ path: process.env.ENV_FILE ?? ".env", quiet: true });
const e = process.env;

type Check = { item: string; ok: boolean; fix: string };

const live = (e.KORA_SECRET_KEY ?? "").startsWith("sk_live_");
const checks: Check[] = [
  { item: "Kora live key", ok: live, fix: "Finish Kora's live KYC, then set KORA_SECRET_KEY / KORA_PUBLIC_KEY to the live pair." },
  { item: "Demo mode off", ok: e.DEMO_MODE === "false", fix: "Set DEMO_MODE=false (the live key refuses to run with it on)." },
  { item: "Real identity checks", ok: e.SIMULATE_IDENTITY !== "true", fix: "Set SIMULATE_IDENTITY=false." },
  { item: "Admin token", ok: (e.ADMIN_TOKEN ?? "").length >= 24, fix: "Set ADMIN_TOKEN to 24+ random characters." },
  { item: "Cron secret", ok: (e.CRON_SECRET ?? "").length >= 16, fix: "Set CRON_SECRET and send it from the 10-minute cron job." },
  { item: "Email sending", ok: Boolean(e.RESEND_API_KEY), fix: "Create a Resend account, verify procureai.com.ng, set RESEND_API_KEY." },
  { item: "Webhook on the custom domain", ok: (e.KORA_WEBHOOK_URL ?? "").startsWith("https://procureai.com.ng/"), fix: "Point KORA_WEBHOOK_URL and the Kora dashboard webhook at https://procureai.com.ng/api/webhooks/kora." },
  { item: "AI key", ok: Boolean(e.AI_API_KEY), fix: "Set AI_API_KEY (the rules parser works without it, but reads replies less well)." },
  { item: "Legal pages reviewed", ok: LEGAL_REVIEWED, fix: "Have a lawyer review /terms, /privacy and /refunds, then set LEGAL_REVIEWED in lib/legal.ts." },
];

let missing = 0;
for (const c of checks) {
  if (!c.ok) missing += 1;
  console.log(`${c.ok ? "READY  " : "NOT YET"}  ${c.item}${c.ok ? "" : `\n         → ${c.fix}`}`);
}
console.log(missing ? `\n${missing} item${missing === 1 ? "" : "s"} left before real money.` : "\nReady for real money.");
process.exitCode = missing ? 1 : 0;
