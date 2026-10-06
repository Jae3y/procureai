import { db, transaction } from "@/lib/db";
import type { Order } from "@/lib/generated/prisma/client";
import { DomainError, NotFoundError } from "./errors";
import { openPayIn } from "./payin";
import { latestVerifications } from "./recommend";
import type { Cause } from "./state";
import { requestEvent } from "./timeline";

/**
 * The buyer approves one vendor: an Order is created against that vendor's latest VERIFIED
 * verification (the DB refuses anything else — I1), then Kora opens the one-time account.
 *
 * Idempotent and resumable: one order per request (unique), so a repeat returns the same order,
 * and if Kora couldn't open the account the first time, the repeat opens it.
 */
export async function approve(requestId: string, quoteId: string | null, cause: Cause): Promise<Order> {
  const request = await db().request.findUnique({
    where: { id: requestId },
    include: { order: true, recommendations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!request) throw new NotFoundError("Request");

  let order = request.order;
  if (!order) {
    const chosenId = quoteId ?? request.recommendations[0]?.chosenQuoteId ?? null;
    if (!chosenId) throw new DomainError("no_choice", "There is no recommended vendor to approve.", 409);
    const quote = await db().quote.findUnique({ where: { id: chosenId }, include: { vendor: true } });
    if (!quote || quote.requestId !== requestId) throw new DomainError("bad_quote", "That quote is not part of this request.", 400);
    if (quote.totalKobo === null) throw new DomainError("no_price", "That quote has no price to pay.", 409);
    const verification = (await latestVerifications([quote.vendorId])).get(quote.vendorId);
    if (!verification || verification.verdict !== "VERIFIED") {
      throw new DomainError("unverified", `${quote.vendor.label} is not verified by Kora, so ProcureAI won't send it money.`, 409);
    }
    const totalKobo = quote.totalKobo;
    order = await transaction(async (tx) => {
      const existing = await tx.order.findUnique({ where: { requestId } });
      if (existing) return existing;
      const created = await tx.order.create({
        data: { requestId, quoteId: quote.id, vendorId: quote.vendorId, verificationId: verification.id, amountKobo: totalKobo },
      });
      await tx.request.update({ where: { id: requestId }, data: { status: "APPROVED" } });
      await tx.orderEvent.create({
        data: { orderId: created.id, kind: "info", title: `Approved ${quote.vendor.label}`, detail: quote.vendor.name ?? null, amountKobo: totalKobo },
      });
      return created;
    });
    await requestEvent(requestId, { kind: "info", title: `Approved ${quote.vendor.label}` });
  }

  if (order.status === "CREATED") {
    const open = await db().payIn.findFirst({ where: { orderId: order.id, status: "PROCESSING" } });
    if (!open) await openPayIn(order.id, order.amountKobo, "initial", cause);
    order = await db().order.findUniqueOrThrow({ where: { id: order.id } });
  }
  return order;
}
