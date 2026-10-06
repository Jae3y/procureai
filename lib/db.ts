import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/lib/generated/prisma/client";

/**
 * One Prisma client per process (kept on globalThis so Next dev hot reload doesn't leak pools).
 * DATABASE_URL is read directly so scripts and tests can point at their own database.
 */

export type Tx = Prisma.TransactionClient;
export { Prisma };

const globalForDb = globalThis as unknown as { procureaiDb?: PrismaClient; procureaiDbUrl?: string };

export function db(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is missing");
  if (!globalForDb.procureaiDb || globalForDb.procureaiDbUrl !== url) {
    const adapter = new PrismaPg({ connectionString: url, max: 10 });
    globalForDb.procureaiDb = new PrismaClient({ adapter });
    globalForDb.procureaiDbUrl = url;
  }
  return globalForDb.procureaiDb;
}

export async function disconnectDb(): Promise<void> {
  if (globalForDb.procureaiDb) {
    await globalForDb.procureaiDb.$disconnect();
    globalForDb.procureaiDb = undefined;
  }
}

/**
 * Interactive transaction with sane bounds. READ COMMITTED + explicit row locks (SELECT … FOR
 * UPDATE) is the concurrency model; see lib/domain/state.ts#lockOrder.
 */
export function transaction<T>(fn: (tx: Tx) => Promise<T>, opts: { timeoutMs?: number } = {}): Promise<T> {
  return db().$transaction(fn, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10_000,
    timeout: opts.timeoutMs ?? 15_000,
  });
}

/** Postgres error text, for asserting on invariant messages (e.g. "I3:"). */
export function dbErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
