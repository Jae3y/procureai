import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Neon on Vercel: prefer the direct (unpooled) connection for migrations.
  datasource: { url: process.env.DATABASE_URL_UNPOOLED || env("DATABASE_URL") },
});
