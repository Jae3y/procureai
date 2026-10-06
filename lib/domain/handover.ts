import { transaction, type Tx } from "@/lib/db";
import { checkHandoverCode, decryptHandoverCode, encryptHandoverCode, generateHandoverCode, hashHandoverCode } from "@/lib/crypto";
import type { Order } from "@/lib/generated/prisma/client";
import { DomainError } from "./errors";
import { dispatchStage } from "./payouts";
import { lockOrder, transition } from "./state";
import { orderEvent } from "./timeline";

/**
 * The 6-digit delivery code. Issued when the money is HELD; the buyer sees it on the tracker and
 * hands it over with the goods; the vendor enters it to release Stage 2.
 *
 * Stored twice, for two jobs: an HMAC (keyed, so an offline guess needs the server secret) to check
 * entries in constant time, and an AES-GCM ciphertext (bound to the order id) so the buyer's
 * tracker can show it again. Max 5 attempts, single use, expiring; per-token and per-IP rate limits
 * sit in front of this in the route.
 */

export const MAX_CODE_ATTEMPTS = 5;
const CODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function issueHandoverCode(tx: Tx, order: Order): Promise<void> {
  if (order.handoverCodeHash) return;
  const code = generateHandoverCode();
  await tx.order.update({
    where: { id: order.id },
    data: {
      handoverCodeHash: hashHandoverCode(order.id, code),
      handoverCodeCipher: encryptHandoverCode(order.id, code),
      codeAttempts: 0,
      codeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  await orderEvent(tx, order.id, { kind: "code", title: "Delivery code issued", detail: "Shown to the buyer only" });
}

/** For the buyer's tracker. Never sent to the vendor. */
export function revealHandoverCode(order: Pick<Order, "id" | "handoverCodeCipher">): string | null {
  return order.handoverCodeCipher ? decryptHandoverCode(order.id, order.handoverCodeCipher) : null;
}

export type CodeAttemptResult =
  | { ok: true }
  | { ok: false; reason: "wrong"; attemptsLeft: number }
  | { ok: false; reason: "locked" | "expired" | "used" };

export async function submitHandoverCode(orderId: string, candidate: string, actor: string): Promise<CodeAttemptResult> {
  if (!/^\d{6}$/.test(candidate)) throw new DomainError("code_format", "The delivery code is 6 digits.", 400);

  const result = await transaction(async (tx): Promise<CodeAttemptResult> => {
    const order = await lockOrder(tx, orderId);
    if (!order.handoverCodeHash) throw new DomainError("no_code", "This order has no delivery code yet.", 409);
    if (order.codeUsedAt) return { ok: false, reason: "used" };
    if (order.codeExpiresAt && order.codeExpiresAt < new Date()) return { ok: false, reason: "expired" };
    if (order.codeAttempts >= MAX_CODE_ATTEMPTS) return { ok: false, reason: "locked" };
    if (order.status !== "STAGE_1_PAID") {
      throw new DomainError("code_not_now", "The delivery code can't be used at this stage of the order.", 409);
    }
    const stage1 = await tx.payout.findFirst({ where: { orderId, stage: "STAGE_1", status: "SUCCESS" } });
    if (!stage1) throw new DomainError("stage1_pending", "Stage 1 hasn't landed with you yet. Try again in a moment.", 409);

    if (!checkHandoverCode(orderId, candidate, order.handoverCodeHash)) {
      const updated = await tx.order.update({ where: { id: orderId }, data: { codeAttempts: { increment: 1 } } });
      const attemptsLeft = Math.max(0, MAX_CODE_ATTEMPTS - updated.codeAttempts);
      await orderEvent(tx, orderId, {
        kind: "error",
        title: "Wrong delivery code",
        detail: attemptsLeft > 0 ? `${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left` : "Code locked after 5 wrong attempts",
      });
      return attemptsLeft > 0 ? { ok: false, reason: "wrong", attemptsLeft } : { ok: false, reason: "locked" };
    }

    await tx.order.update({ where: { id: orderId }, data: { codeUsedAt: new Date() } });
    await transition(tx, order, "CODE_VERIFIED", { type: "USER", id: actor, note: "vendor entered the buyer's code" });
    return { ok: true };
  });

  if (result.ok) await dispatchStage(orderId, "STAGE_2", { type: "USER", id: actor });
  return result;
}
