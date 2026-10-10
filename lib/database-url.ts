/**
 * The Postgres connection string. Neon's Vercel integration provides DATABASE_URL (pooled) and
 * DATABASE_URL_UNPOOLED (direct); the direct one is preferred because LISTEN/NOTIFY and migrations
 * need a real session. Anywhere else, DATABASE_URL is used as is.
 */
export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || undefined;
}
