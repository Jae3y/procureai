import type { Tx } from "@/lib/db";
import type { CauseType, Order, OrderStatus } from "@/lib/generated/prisma/client";

/**
 * The order state machine, as data. The DB trigger "I5_order_status_guard" enforces the same
 * table (seeded into "OrderTransitionRule"); a test asserts the two never drift.
 *
 *   CREATED → AWAITING_PAYMENT → {UNDERPAID ⇄ AWAITING_PAYMENT, HELD}
 *   HELD → STAGE_1_PAID → CODE_VERIFIED → RELEASED → COMPLETE
 *   STAGE_1_PAID | RELEASED → PAYOUT_FAILED → (retry) → the state it failed from
 *   HELD | STAGE_1_PAID → DISPUTED → REFUNDED
 *
 * STAGE_1_PAID / RELEASED are entered when that stage's payout is *dispatched* (its PENDING row is
 * written in the same transaction). Whether the money has landed is the Payout's own status, which
 * is what the Money Trail renders — the trail never runs ahead of Kora.
 */
export const ORDER_TRANSITIONS = {
  CREATED: ["AWAITING_PAYMENT"],
  AWAITING_PAYMENT: ["UNDERPAID", "HELD"],
  UNDERPAID: ["AWAITING_PAYMENT", "HELD"],
  HELD: ["STAGE_1_PAID", "DISPUTED"],
  STAGE_1_PAID: ["CODE_VERIFIED", "PAYOUT_FAILED", "DISPUTED"],
  CODE_VERIFIED: ["RELEASED"],
  RELEASED: ["COMPLETE", "PAYOUT_FAILED"],
  PAYOUT_FAILED: ["STAGE_1_PAID", "RELEASED"],
  DISPUTED: ["REFUNDED"],
  COMPLETE: [],
  REFUNDED: [],
} as const satisfies Record<OrderStatus, readonly OrderStatus[]>;

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (ORDER_TRANSITIONS[from] as readonly OrderStatus[]).includes(to);
}

export function allTransitions(): Array<[OrderStatus, OrderStatus]> {
  return (Object.entries(ORDER_TRANSITIONS) as Array<[OrderStatus, readonly OrderStatus[]]>).flatMap(([from, tos]) =>
    tos.map((to): [OrderStatus, OrderStatus] => [from, to]),
  );
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
    readonly orderId: string,
  ) {
    super(`I5: illegal order transition ${from} -> ${to} (order ${orderId})`);
    this.name = "IllegalTransitionError";
  }
}

export type Cause = { type: CauseType; id: string; note?: string };

/**
 * Locks the order row for the rest of the transaction and returns its current state.
 * Every order mutation starts here: webhook worker, poller, user actions and admin controls all
 * serialise on this lock, which is what makes their races converge on one outcome.
 */
export async function lockOrder(tx: Tx, orderId: string): Promise<Order> {
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
  return tx.order.findUniqueOrThrow({ where: { id: orderId } });
}

const TRANSITION_TITLES: Record<OrderStatus, string> = {
  CREATED: "Order created",
  AWAITING_PAYMENT: "Waiting for payment",
  UNDERPAID: "Underpaid",
  HELD: "Money held",
  STAGE_1_PAID: "Stage 1 sent",
  CODE_VERIFIED: "Delivery code entered",
  RELEASED: "Stage 2 sent",
  COMPLETE: "Complete",
  PAYOUT_FAILED: "Payout failed",
  DISPUTED: "Disputed",
  REFUNDED: "Refunded",
};

/**
 * Moves a LOCKED order to `to`, recording who/what caused it. Throws IllegalTransitionError (and
 * the caller's transaction rolls back) for anything not in ORDER_TRANSITIONS.
 */
export async function transition(tx: Tx, order: Order, to: OrderStatus, cause: Cause): Promise<Order> {
  if (!canTransition(order.status, to)) throw new IllegalTransitionError(order.status, to, order.id);
  await tx.orderTransition.create({
    data: {
      orderId: order.id,
      fromState: order.status,
      toState: to,
      causeType: cause.type,
      causeId: cause.id,
      note: cause.note ?? null,
    },
  });
  const updated = await tx.order.update({ where: { id: order.id }, data: { status: to } });
  await tx.orderEvent.create({
    data: {
      orderId: order.id,
      kind: "state",
      title: TRANSITION_TITLES[to],
      detail: `${order.status} → ${to} · ${cause.type.toLowerCase()}${cause.note ? ` · ${cause.note}` : ""}`,
    },
  });
  return updated;
}

/** The state a PAYOUT_FAILED order returns to when the failed stage is retried. */
export function retryTarget(stage: "STAGE_1" | "STAGE_2"): OrderStatus {
  return stage === "STAGE_1" ? "STAGE_1_PAID" : "RELEASED";
}
