/**
 * npm run dev:offline — runs ProcureAI against the Kora TEST DOUBLE (tests/kora-double) instead of
 * live Kora API, for clicking through the UI before a Kora test key exists. Every page shows an
 * "OFFLINE · KORA TEST DOUBLE" banner; nothing here is presented as real Kora.
 *
 * The double replays Kora's documented response shapes and POSTs signed webhooks back to the app.
 * With a real key in .env, use `npm run dev` — no code changes.
 */
import { spawn } from "node:child_process";
import { KoraDouble } from "../tests/kora-double/server";

const PORT = Number(process.env.PORT ?? 3000);
const DOUBLE_PORT = 4010;
const SECRET = "sk_test_offline_kora_double";

async function main() {
  const double = new KoraDouble(SECRET);
  double.webhookTarget = `http://127.0.0.1:${PORT}/api/webhooks/kora`;
  const baseUrl = await double.start(DOUBLE_PORT);
  console.log(`\n  Kora TEST DOUBLE on ${baseUrl}  (webhooks → ${double.webhookTarget})\n`);

  const env = {
    ...process.env,
    KORA_SECRET_KEY: SECRET,
    KORA_PUBLIC_KEY: "pk_test_offline_kora_double",
    KORA_BASE_URL: baseUrl,
    KORA_WEBHOOK_URL: "https://offline.procureai.invalid/api/webhooks/kora",
    KORA_OFFLINE_DOUBLE: "1",
    DEMO_MODE: "true",
    SIMULATE_IDENTITY: "false",
    APP_BASE_URL: `http://localhost:${PORT}`,
  };
  await new Promise<void>((resolve, reject) => {
    const reset = spawn("npx", ["tsx", "scripts/demo-reset.ts"], { stdio: "inherit", shell: true, env });
    reset.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`demo:reset exited with ${code}`))));
  });
  const child = spawn("npx", ["next", "dev", "--port", String(PORT)], { stdio: "inherit", shell: true, env });
  const stop = () => {
    child.kill();
    void double.stop().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => {
    void double.stop().then(() => process.exit(code ?? 0));
  });
}

void main();
