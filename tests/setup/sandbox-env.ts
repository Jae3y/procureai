import { config } from "dotenv";

/**
 * Sandbox suite: the owner's real Kora test key from .env, against the real Kora sandbox, with the
 * test database. Every sandbox test is skipped (loudly) when no sk_test_ key is configured.
 */
config({ quiet: true });

const testDb = process.env.DATABASE_URL_TEST ?? "postgresql://procureai:procureai@localhost:5434/procureai_test";
Object.assign(process.env, { NODE_ENV: "test", LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? "warn", DATABASE_URL: testDb, DEMO_MODE: "true" });

export const hasSandboxKey = /^sk_test_/.test(process.env.KORA_SECRET_KEY ?? "");
if (!hasSandboxKey) {
  console.warn("\n⚠  SANDBOX SUITE SKIPPED: KORA_SECRET_KEY (sk_test_…) is not set in .env\n");
}
