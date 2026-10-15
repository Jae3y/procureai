import type { MessageSender } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";
import { DomainError, NotFoundError } from "./errors";
import { vendorByToken } from "./vendors";

/**
 * The buyer–vendor thread on an order: plain text, stored in Postgres, read by polling. The order's
 * buyer (session cookie) and the chosen vendor (their invite link) are the only two parties.
 */

export const MESSAGE_MAX_CHARS = 300;

export async function postMessage(orderId: string, sender: MessageSender, raw: string): Promise<void> {
  const body = raw.trim();
  if (!body) throw new DomainError("empty_message", "Write a message first.", 400);
  if (body.length > MESSAGE_MAX_CHARS) throw new DomainError("message_too_long", `Messages are at most ${MESSAGE_MAX_CHARS} characters.`, 400);
  const exists = await db().order.count({ where: { id: orderId } });
  if (!exists) throw new NotFoundError("Order");
  await db().orderMessage.create({ data: { orderId, sender, body } });
}

export async function messageCount(orderId: string): Promise<number> {
  return db().orderMessage.count({ where: { orderId } });
}

/** The order a vendor's invite link may message on: only the order they were chosen for. */
export async function orderIdForVendorToken(token: string): Promise<string> {
  const vendor = await vendorByToken(token);
  const order = await db().order.findUnique({ where: { requestId: vendor.requestId }, select: { id: true, vendorId: true } });
  if (!order || order.vendorId !== vendor.id) throw new DomainError("no_order", "Messages open once the buyer chooses you.", 404);
  return order.id;
}
