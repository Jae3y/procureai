import type { Tx } from "@/lib/db";
import { Prisma } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto";

/**
 * Records the result of *us querying Kora* as a KoraEvent (source API), next to webhooks.
 * Identical results dedupe on (type, reference, idempotencyHash) via ON CONFLICT DO NOTHING, so a
 * poller asking the same question every 10s doesn't flood the log — but every distinct answer is
 * kept (I8).
 */
export async function recordApiEvent(
  tx: Tx,
  input: { type: string; reference: string; orderId: string | null; raw: unknown; fingerprint: unknown },
): Promise<void> {
  const idempotencyHash = sha256Hex(`api:${JSON.stringify(input.fingerprint)}`);
  await tx.koraEvent.createMany({
    data: [
      {
        type: input.type,
        reference: input.reference,
        source: "API",
        signatureValid: null,
        idempotencyHash,
        payload: toJson(input.raw),
        orderId: input.orderId,
        processedAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });
}

/** Kora JSON → Prisma JSON input. Kora never sends undefined/functions, so this is lossless. */
export function toJson(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined) return { value: null };
  return JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))) as Prisma.InputJsonValue;
}
