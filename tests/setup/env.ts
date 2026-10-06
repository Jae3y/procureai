import { config } from "dotenv";

/**
 * Unit + integration environment. Tests never use the owner's real Kora key: Kora calls in these
 * suites go to tests/kora-double (a local HTTP server replaying Kora's documented shapes), and the
 * secret below is what that double — and the webhook signature tests — sign with.
 * The real sandbox runs in the `sandbox` project (tests/setup/sandbox-env.ts).
 */
config({ quiet: true });

const testDb = process.env.DATABASE_URL_TEST ?? "postgresql://procureai:procureai@localhost:5434/procureai_test";

Object.assign(process.env, {
  NODE_ENV: "test",
  LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? "silent",
  DATABASE_URL: testDb,
  KORA_SECRET_KEY: "sk_test_procureai_unit_tests_only",
  KORA_PUBLIC_KEY: "pk_test_procureai_unit_tests_only",
  KORA_BASE_URL: "http://127.0.0.1:1/never-called-without-a-double",
  KORA_WEBHOOK_URL: "https://procureai.test/api/webhooks/kora",
  APP_BASE_URL: "http://localhost:3000",
  RECORD_SIGNING_SECRET: "test-signing-secret-0123456789abcdef0123456789abcdef",
  AI_API_KEY: "",
  DEMO_MODE: "true",
  SIMULATE_IDENTITY: "false",
  ENABLE_CHECKOUT_REDIRECT: "false",
});
