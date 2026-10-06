/** npm run db:test:reset — re-applies every migration to the integration-test database. */
import "dotenv/config";
import { execSync } from "node:child_process";

const url = process.env.DATABASE_URL_TEST ?? "postgresql://procureai:procureai@localhost:5434/procureai_test";
execSync("npx prisma migrate reset --force --skip-seed", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
