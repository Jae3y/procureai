import { afterAll, beforeEach } from "vitest";
import { db, disconnectDb } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";

/**
 * Every integration test starts from empty tables. TRUNCATE bypasses the append-only row
 * triggers by design; the transition-rule table and migration history are preserved.
 */
const KEEP = new Set(["OrderTransitionRule", "_prisma_migrations"]);

let tables: string[] | undefined;

beforeEach(async () => {
  resetEnvCache();
  if (!tables) {
    const rows = await db().$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    tables = rows.map((r) => r.tablename).filter((t) => !KEEP.has(t));
  }
  if (tables.length) {
    await db().$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
});

afterAll(async () => {
  await disconnectDb();
});
