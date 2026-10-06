import { execSync } from "node:child_process";
import { config } from "dotenv";

/** Applies every migration (including the I1–I8 triggers) to the test database once per run. */
export default function setup() {
  config({ quiet: true });
  const url = process.env.DATABASE_URL_TEST ?? "postgresql://procureai:procureai@localhost:5434/procureai_test";
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url },
  });
}
