import { afterAll, beforeAll, beforeEach } from "vitest";
import { KoraClient, setKoraClientForTests } from "@/lib/kora/client";
import { KoraDouble } from "../kora-double/server";

/** Starts the Kora test double for a test file and points the app's Kora client at it. */
export function useKoraDouble(opts: { timeoutMs?: number; simulateIdentity?: boolean } = {}): KoraDouble {
  const double = new KoraDouble();
  beforeAll(async () => {
    const baseUrl = await double.start();
    process.env.KORA_BASE_URL = baseUrl;
    setKoraClientForTests(
      new KoraClient({
        baseUrl,
        secretKey: double.secretKey,
        simulateIdentity: opts.simulateIdentity ?? false,
        timeoutMs: opts.timeoutMs ?? 2_000,
        sleep: async () => undefined,
      }),
    );
  });
  beforeEach(() => double.reset());
  afterAll(async () => {
    setKoraClientForTests(undefined);
    await double.stop();
  });
  return double;
}
