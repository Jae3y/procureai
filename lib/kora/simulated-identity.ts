import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import bankAccountBasic058 from "./fixtures/documented/bank-account-basic-058-0123456789.json";
import banksBasic from "./fixtures/documented/banks-basic-basic.json";
import cacValid from "./fixtures/documented/cac-RC00000011.json";

/**
 * SIMULATE_IDENTITY=true only. Never silent: every caller marks the result `simulated`, which the
 * UI and the purchase record render as a "SIMULATED IDENTITY" badge.
 *
 * Lookup order for a given input:
 *   1. lib/kora/fixtures/recorded/<kind>-<key>.json — a real sandbox response captured by
 *      `npm run preflight` with the owner's test key.
 *   2. lib/kora/fixtures/documented/… — Kora's documented sandbox example for that exact test input.
 *   3. Otherwise a not-found response. Kora does not document the error body for an invalid
 *      CAC/account lookup (BLOCKERS.md B-07), so this message says plainly that it is simulated.
 */

const Fixture = z.object({ httpStatus: z.number().int(), body: z.unknown(), source: z.string().optional() });
export type IdentityFixture = { httpStatus: number; body: unknown; source: "recorded" | "documented" | "simulated-not-found" };

const DOCUMENTED: Record<string, unknown> = {
  "cac-RC00000011": cacValid,
  "banks-basic-basic": banksBasic,
  "bank-account-basic-058-0123456789": bankAccountBasic058,
};

function safeKey(s: string): string {
  return s.replace(/[^A-Za-z0-9-]/g, "_");
}

export async function simulatedIdentityResponse(
  kind: "cac" | "banks-basic" | "bank-account-basic",
  key: string,
): Promise<IdentityFixture> {
  const name = `${kind}-${safeKey(key)}`;
  try {
    const text = await readFile(path.join(process.cwd(), "lib", "kora", "fixtures", "recorded", `${name}.json`), "utf8");
    const recorded = Fixture.parse(JSON.parse(text));
    return { httpStatus: recorded.httpStatus, body: recorded.body, source: "recorded" };
  } catch (e) {
    const notFound = e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT";
    if (!notFound) throw e;
  }
  const documented = DOCUMENTED[name];
  if (documented) {
    const f = Fixture.parse(documented);
    return { httpStatus: f.httpStatus, body: f.body, source: "documented" };
  }
  return {
    httpStatus: 404,
    source: "simulated-not-found",
    body: {
      status: false,
      message:
        kind === "cac"
          ? "No business found for this registration number (simulated identity)"
          : "Account could not be resolved (simulated identity)",
      data: null,
    },
  };
}
