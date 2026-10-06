import { db, type Tx } from "@/lib/db";
import type { Kobo } from "@/lib/money";

/**
 * The order/request timelines streamed to the UI over SSE. Rows are append-only; inserting one
 * fires pg_notify (see the invariants migration), which wakes any open stream for that order.
 *
 * kind:      "kora"  — something Kora did or said (renders in the dark Kora events panel)
 *            "state" — an order status change (written by transition())
 *            "info" | "error" | "code" — everything else worth showing
 * signature: "VERIFIED" — from a webhook whose signature checked out
 *            "INVALID"  — from a webhook whose signature did not (admin only)
 *            "API"      — the result of us querying Kora
 *            "SIMULATED"— SIMULATE_IDENTITY fixture
 */
export type TimelineKind = "kora" | "state" | "info" | "error" | "code";
export type TimelineSignature = "VERIFIED" | "INVALID" | "API" | "SIMULATED";

export type TimelineEntry = {
  kind: TimelineKind;
  title: string;
  detail?: string | null;
  amountKobo?: Kobo | null;
  koraReference?: string | null;
  signature?: TimelineSignature | null;
};

export async function orderEvent(tx: Tx, orderId: string, e: TimelineEntry): Promise<void> {
  await tx.orderEvent.create({
    data: {
      orderId,
      kind: e.kind,
      title: e.title,
      detail: e.detail ?? null,
      amountKobo: e.amountKobo ?? null,
      koraReference: e.koraReference ?? null,
      signature: e.signature ?? null,
    },
  });
}

export async function requestEvent(requestId: string, e: Omit<TimelineEntry, "amountKobo">, tx?: Tx): Promise<void> {
  await (tx ?? db()).requestEvent.create({
    data: {
      requestId,
      kind: e.kind,
      title: e.title,
      detail: e.detail ?? null,
      koraReference: e.koraReference ?? null,
      signature: e.signature ?? null,
    },
  });
}
