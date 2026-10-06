import { sha256Hex } from "@/lib/crypto";
import { db, Prisma } from "@/lib/db";
import { DomainError } from "@/lib/domain/errors";
import { isKoraError } from "@/lib/kora/errors";

/**
 * Idempotency-Key for our own mutating routes. The first request with a key claims it (unique row)
 * and runs; a repeat with the same key and the same body gets the stored response; a repeat with a
 * different body is refused; a repeat while the first is still running gets 409.
 *
 * Deterministic failures (4xx, Kora refused) are stored like successes. Unexpected errors and
 * unknown Kora outcomes release the key so the client may retry.
 */

export type StoredReply = { status: number; body: unknown };

const KEY_RE = /^[A-Za-z0-9_.:-]{8,200}$/;

export async function withIdempotency(
  scope: string,
  key: string,
  requestBody: string,
  run: () => Promise<StoredReply>,
): Promise<StoredReply & { replayed: boolean }> {
  if (!KEY_RE.test(key)) throw new DomainError("bad_idempotency_key", "Idempotency-Key must be 8–200 characters of A-Z a-z 0-9 _ . : -", 400);
  const fullKey = `${scope}:${key}`;
  const requestHash = sha256Hex(requestBody);

  const claimed = await db().idempotencyKey.createMany({ data: [{ key: fullKey, route: scope, requestHash }], skipDuplicates: true });
  if (claimed.count === 0) {
    const existing = await db().idempotencyKey.findUniqueOrThrow({ where: { key: fullKey } });
    if (existing.requestHash !== requestHash) {
      throw new DomainError("idempotency_mismatch", "This Idempotency-Key was already used with a different request.", 422);
    }
    if (existing.statusCode === null) {
      throw new DomainError("in_progress", "The first request with this Idempotency-Key is still running.", 409);
    }
    return { status: existing.statusCode, body: existing.responseJson, replayed: true };
  }

  try {
    const reply = await run();
    await store(fullKey, reply);
    return { ...reply, replayed: false };
  } catch (err) {
    const deterministic = (err instanceof DomainError && err.status < 500) || (isKoraError(err) && err.outcomeKnown);
    if (deterministic) {
      const reply = errorReply(err);
      await store(fullKey, reply);
      return { ...reply, replayed: false };
    }
    await db().idempotencyKey.delete({ where: { key: fullKey } });
    throw err;
  }
}

async function store(key: string, reply: StoredReply): Promise<void> {
  await db().idempotencyKey.update({
    where: { key },
    data: { statusCode: reply.status, responseJson: toStoredJson(reply.body), completedAt: new Date() },
  });
}

function toStoredJson(body: unknown): Prisma.InputJsonValue {
  return JSON.parse(jsonText(body ?? null)) as Prisma.InputJsonValue;
}

/** bigint-safe JSON (kobo travels as digit strings). */
export function jsonText(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
}

export function errorReply(err: unknown): StoredReply {
  if (err instanceof DomainError) {
    return { status: err.status, body: { error: { code: err.code, message: err.userMessage, details: err.details ?? null } } };
  }
  if (isKoraError(err)) {
    const status = err.kind === "insufficient_funds" ? 409 : err.outcomeKnown ? 422 : 502;
    return { status, body: { error: { code: `kora_${err.kind}`, message: err.userMessage, details: { koraMessage: err.koraMessage ?? null, endpoint: err.endpoint } } } };
  }
  return { status: 500, body: { error: { code: "internal", message: "Something went wrong on our side." } } };
}
