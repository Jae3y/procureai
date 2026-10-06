import { z } from "zod";

/**
 * The single, validated view of the process environment. Validated once, lazily, on first use;
 * a missing or malformed variable fails fast with every problem listed, not just the first.
 *
 * Server-only by construction: nothing here is NEXT_PUBLIC_, so Next never inlines it into a
 * client bundle, and scripts/verify-client-bundle.ts asserts no key-shaped string leaked.
 */

const bool = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

const EnvSchema = z
  .object({
    KORA_SECRET_KEY: z
      .string()
      .regex(/^sk_(test|live)_[A-Za-z0-9_]+$/, "must look like sk_test_… or sk_live_…"),
    KORA_PUBLIC_KEY: z
      .string()
      .regex(/^pk_(test|live)_[A-Za-z0-9_]+$/, "must look like pk_test_… or pk_live_…"),
    KORA_BASE_URL: z.url().default("https://api.korapay.com/merchant/api/v1"),
    KORA_WEBHOOK_URL: z.url().startsWith("https://", "Kora only delivers webhooks to public HTTPS URLs"),
    DATABASE_URL: z.string().startsWith("postgres"),
    AI_API_KEY: z.string().default(""),
    AI_BASE_URL: z.url().default("https://generativelanguage.googleapis.com/v1beta/openai"),
    AI_MODEL: z.string().min(1).default("gemini-2.5-flash"),
    APP_BASE_URL: z.url(),
    RECORD_SIGNING_SECRET: z.string().min(32, "use at least 32 random characters"),
    ADMIN_TOKEN: z.string().default(""),
    DEMO_MODE: bool.default(false),
    SIMULATE_IDENTITY: bool.default(false),
    ENABLE_CHECKOUT_REDIRECT: bool.default(false),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    CRON_SECRET: z.string().default(""),
  })
  .superRefine((env, ctx) => {
    const secretMode = env.KORA_SECRET_KEY.startsWith("sk_test_") ? "test" : "live";
    const publicMode = env.KORA_PUBLIC_KEY.startsWith("pk_test_") ? "test" : "live";
    if (secretMode !== publicMode) {
      ctx.addIssue({
        code: "custom",
        path: ["KORA_PUBLIC_KEY"],
        message: `public key is ${publicMode} mode but secret key is ${secretMode} mode`,
      });
    }
    if (secretMode === "live" && (env.SIMULATE_IDENTITY || env.DEMO_MODE)) {
      ctx.addIssue({
        code: "custom",
        path: ["KORA_SECRET_KEY"],
        message: "a live key cannot run with SIMULATE_IDENTITY or DEMO_MODE",
      });
    }
    if (!env.DEMO_MODE && env.ADMIN_TOKEN.length < 24) {
      ctx.addIssue({
        code: "custom",
        path: ["ADMIN_TOKEN"],
        message: "required (24+ chars) when DEMO_MODE=false, otherwise /admin is unprotected",
      });
    }
  });

export type Env = z.infer<typeof EnvSchema> & { koraMode: "test" | "live" };

export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Environment is not valid (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n` +
        problems.map((p) => `  • ${p}`).join("\n") +
        "\nCopy .env.example to .env and fill these in.",
    );
    this.name = "EnvError";
  }
}

/** Parses an env-like record. Exported for tests; app code uses env(). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings as "not set" so `KORA_SECRET_KEY=` reports as missing, not malformed.
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v !== undefined && v.trim() !== "") cleaned[k] = v.trim();
  }
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const key = issue.path.join(".") || "(env)";
      const missing = issue.code === "invalid_type" && cleaned[key] === undefined;
      return missing ? `${key} is missing` : `${key}: ${issue.message}`;
    });
    throw new EnvError(problems);
  }
  return {
    ...result.data,
    koraMode: result.data.KORA_SECRET_KEY.startsWith("sk_test_") ? "test" : "live",
  };
}

let cached: Env | undefined;

export function env(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}

/** Test hook: drop the cached env after a test mutates process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
