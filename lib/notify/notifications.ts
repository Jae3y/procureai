import { db, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import type { Order, OrderStatus } from "@/lib/generated/prisma/client";
import { log } from "@/lib/log";
import { emailEnabled, sendEmail } from "./email";

/**
 * Notifications work like the webhook outbox: the row is written in the same transaction as the
 * event, so nobody is told about something that rolled back, and the email goes out afterwards from
 * the background tick. A failed send never affects the money path.
 */

export type NotificationInput = { accountId: string; kind: string; title: string; body: string; href?: string };

/** Emails older than this are not sent: an old alert arriving days late only confuses people. */
const EMAIL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function notify(client: Tx, input: NotificationInput): Promise<void> {
  await client.notification.create({ data: { accountId: input.accountId, kind: input.kind, title: input.title, body: input.body, href: input.href ?? null } });
}

/** The accounts behind an order: demo orders have none, so they never notify anyone. */
async function partiesOf(client: Tx, order: Pick<Order, "requestId" | "vendorId">) {
  const request = await client.request.findUniqueOrThrow({ where: { id: order.requestId }, select: { item: true, buyerId: true } });
  const vendor = await client.vendor.findUniqueOrThrow({ where: { id: order.vendorId }, select: { contactId: true } });
  const [buyer, seller] = await Promise.all([
    client.account.findUnique({ where: { buyerId: request.buyerId }, select: { id: true } }),
    vendor.contactId ? client.account.findUnique({ where: { vendorContactId: vendor.contactId }, select: { id: true } }) : null,
  ]);
  return { item: request.item, buyerAccountId: buyer?.id ?? null, sellerAccountId: seller?.id ?? null };
}

type Copy = { title: string; body: (item: string) => string };

const BUYER_COPY: Partial<Record<OrderStatus, Copy>> = {
  UNDERPAID: { title: "Your transfer was short", body: (i) => `The transfer for ${i} came in below the amount due. Open the order to pay the rest.` },
  HELD: { title: "Your money is held", body: (i) => `Your payment for ${i} is confirmed. The vendor gets 30% now and the rest on delivery.` },
  COMPLETE: { title: "Purchase complete", body: (i) => `Your purchase of ${i} is complete. Your record and receipt are ready.` },
  PAYOUT_FAILED: { title: "A vendor payout didn't go through", body: (i) => `A payout for ${i} failed. Your money is safe and we are on it.` },
  DISPUTED: { title: "Problem reported", body: (i) => `A problem was reported on ${i}. Stage 2 is on hold until it is resolved.` },
  REFUNDED: { title: "Refund sent", body: (i) => `Your refund for ${i} has been sent.` },
};

const SELLER_COPY: Partial<Record<OrderStatus, Copy>> = {
  HELD: { title: "The buyer's money is held", body: (i) => `The buyer has paid for ${i}. Your 30% is on its way.` },
  STAGE_1_PAID: { title: "Stage 1 sent to your account", body: (i) => `30% for ${i} has been sent to your account. You can start the order.` },
  RELEASED: { title: "Stage 2 sent to your account", body: (i) => `The final 70% for ${i} has been sent to your account.` },
  COMPLETE: { title: "Order complete", body: (i) => `The order for ${i} is complete and fully paid.` },
  PAYOUT_FAILED: { title: "A payout to you didn't go through", body: (i) => `A payout for ${i} failed. We'll retry it, and contact you if your bank details need checking.` },
  DISPUTED: { title: "The buyer reported a problem", body: (i) => `The buyer reported a problem on ${i}. Stage 2 is on hold. Open your order to add your side.` },
  REFUNDED: { title: "Order refunded", body: (i) => `The order for ${i} was refunded to the buyer.` },
};

/**
 * Alerts for the person running ProcureAI (OPS_ALERT_EMAIL): delivered to their own account like any
 * notification, so they appear in-app and by email. Silently skipped if that account doesn't exist.
 */
export async function notifyOps(client: Tx, input: Omit<NotificationInput, "accountId">): Promise<void> {
  const email = env().OPS_ALERT_EMAIL.trim().toLowerCase();
  if (!email) return;
  const owner = await client.account.findUnique({ where: { email }, select: { id: true } });
  if (owner) await notify(client, { ...input, accountId: owner.id });
}

const OPS_COPY: Partial<Record<OrderStatus, string>> = {
  PAYOUT_FAILED: "A vendor payout failed",
  DISPUTED: "A buyer reported a problem",
  UNDERPAID: "A buyer's transfer was short",
};

/** Called from transition(), inside its transaction. */
export async function notifyOrderTransition(tx: Tx, order: Order, to: OrderStatus): Promise<void> {
  const opsTitle = OPS_COPY[to];
  if (opsTitle) {
    await notifyOps(tx, { kind: `ops.${to}`, title: opsTitle, body: `Order PA-${String(order.number).padStart(4, "0")} needs a look in the admin console.`, href: "/admin" });
  }
  const buyerCopy = BUYER_COPY[to];
  const sellerCopy = SELLER_COPY[to];
  if (!buyerCopy && !sellerCopy) return;
  const { item, buyerAccountId, sellerAccountId } = await partiesOf(tx, order);
  if (buyerCopy && buyerAccountId) {
    await notify(tx, { accountId: buyerAccountId, kind: `order.${to}`, title: buyerCopy.title, body: buyerCopy.body(item), href: `/orders/${order.id}` });
  }
  if (sellerCopy && sellerAccountId) {
    await notify(tx, { accountId: sellerAccountId, kind: `order.${to}`, title: sellerCopy.title, body: sellerCopy.body(item), href: "/vendor" });
  }
}

export async function notifyDelivered(tx: Tx, order: Order, hours: number): Promise<void> {
  const { item, buyerAccountId } = await partiesOf(tx, order);
  if (!buyerAccountId) return;
  await notify(tx, {
    accountId: buyerAccountId,
    kind: "order.delivered",
    title: "The vendor says it's delivered",
    body: `The vendor marked ${item} as delivered. If something is wrong, report it within ${hours} hours. After that, Stage 2 is released automatically.`,
    href: `/orders/${order.id}`,
  });
}

export async function notifyMessage(tx: Tx, order: Pick<Order, "id" | "requestId" | "vendorId">, from: "BUYER" | "VENDOR"): Promise<void> {
  const { item, buyerAccountId, sellerAccountId } = await partiesOf(tx, order);
  const accountId = from === "BUYER" ? sellerAccountId : buyerAccountId;
  if (!accountId) return;
  await notify(tx, {
    accountId,
    kind: "order.message",
    title: from === "BUYER" ? "New message from the buyer" : "New message from the vendor",
    body: `About ${item}. Open the order to read and reply.`,
    href: from === "BUYER" ? "/vendor" : `/orders/${order.id}`,
  });
}

/** Sends the email copy of recent notifications. Each row is claimed first, so two passes can't send it twice. */
export async function flushNotificationEmails(limit = 20): Promise<{ sent: number; failed: number }> {
  if (!emailEnabled()) return { sent: 0, failed: 0 };
  const since = new Date(Date.now() - EMAIL_MAX_AGE_MS);
  const due = await db().notification.findMany({
    where: { emailedAt: null, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    take: limit,
    include: { account: { select: { email: true, deletionRequestedAt: true } } },
  });
  let sent = 0;
  let failed = 0;
  for (const n of due) {
    const { count } = await db().notification.updateMany({ where: { id: n.id, emailedAt: null }, data: { emailedAt: new Date() } });
    if (count === 0) continue;
    const ok = await sendEmail({
      to: n.account.email,
      subject: n.title,
      content: { heading: n.title, paragraphs: [n.body], ...(n.href ? { button: { label: "Open ProcureAI", url: `${env().APP_BASE_URL}${n.href}` } } : {}) },
    }).catch((err: unknown) => {
      log.error({ err, notification: n.id }, "email send failed");
      return false;
    });
    if (ok) {
      sent += 1;
    } else {
      failed += 1;
      await db().notification.update({ where: { id: n.id }, data: { emailedAt: null } });
    }
  }
  return { sent, failed };
}
