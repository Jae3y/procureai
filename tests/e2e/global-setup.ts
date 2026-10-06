import { execSync } from "node:child_process";

/**
 * Fresh demo scenario before the run. Offline runs reset with the same overrides dev:offline uses;
 * a real-sandbox run (E2E_BASE_URL set) resets with the owner's .env.
 */
export default function globalSetup(): void {
  const offline = !process.env.E2E_BASE_URL;
  execSync("npx tsx scripts/demo-reset.ts", {
    stdio: "inherit",
    env: offline
      ? {
          ...process.env,
          KORA_SECRET_KEY: "sk_test_offline_kora_double",
          KORA_PUBLIC_KEY: "pk_test_offline_kora_double",
          KORA_BASE_URL: "http://127.0.0.1:4010/merchant/api/v1",
          KORA_WEBHOOK_URL: "https://offline.procureai.invalid/api/webhooks/kora",
          DEMO_MODE: "true",
          SIMULATE_IDENTITY: "false",
          APP_BASE_URL: "http://localhost:3000",
        }
      : process.env,
  });
}
