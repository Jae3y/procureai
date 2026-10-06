import { z } from "zod";
import { db, type Tx } from "@/lib/db";

/**
 * Demo controls persisted in the DB so the web process, the worker and the admin screen agree.
 * Each one changes how ProcureAI *talks to* Kora (where a payout goes, whether a received
 * webhook is acted on) — never what Kora answers.
 */

const SETTINGS = {
  /** Where the next payout is sent. SANDBOX_* only take effect with a test-mode key. */
  payoutRoute: z.enum(["VERIFIED_ACCOUNT", "SANDBOX_SUCCESS_033", "SANDBOX_FAIL_035"]).default("VERIFIED_ACCOUNT"),
  /** The next received webhook is stored but not processed (simulates a lost webhook). */
  suppressNextWebhook: z.enum(["true", "false"]).default("false"),
  /** Pointer to the request demo:reset prepared. */
  currentDemoRequestId: z.string().default(""),
} as const;

type Settings = typeof SETTINGS;
export type SettingKey = keyof Settings;
export type SettingValue<K extends SettingKey> = z.output<Settings[K]>;

export async function getSetting<K extends SettingKey>(key: K, tx?: Tx): Promise<SettingValue<K>> {
  const row = await (tx ?? db()).demoSetting.findUnique({ where: { key } });
  const schema = SETTINGS[key];
  const parsed = schema.safeParse(row?.value);
  // Every setting has a default, so an unknown/garbled stored value reads as the default.
  const value = parsed.success ? parsed.data : schema.parse(undefined);
  return value as SettingValue<K>;
}

export async function setSetting<K extends SettingKey>(key: K, value: SettingValue<K>, tx?: Tx): Promise<void> {
  const v = SETTINGS[key].parse(value);
  await (tx ?? db()).demoSetting.upsert({ where: { key }, create: { key, value: String(v) }, update: { value: String(v) } });
}

/**
 * Atomically consumes the "suppress next webhook" flag: exactly one webhook is suppressed even if
 * several arrive at once.
 */
export async function consumeSuppressNextWebhook(): Promise<boolean> {
  const n = await db().$executeRaw`
    UPDATE "DemoSetting" SET "value" = 'false', "updatedAt" = now()
    WHERE "key" = 'suppressNextWebhook' AND "value" = 'true'`;
  return n === 1;
}
