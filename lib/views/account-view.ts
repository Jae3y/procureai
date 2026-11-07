import { inviteTokenFor, signRecordId } from "@/lib/crypto";
import { db } from "@/lib/db";
import type { Account, OrderStatus, RequestStatus } from "@/lib/generated/prisma/client";
import { formatNaira } from "@/lib/money";
import { lagosDay, lagosTime, orderRef } from "./format";

/** The signed-in dashboards. Amounts arrive formatted; every line is scoped to the account asking. */

const ORDER_WORDS: Record<OrderStatus, string> = {
  CREATED: "Waiting for your payment",
  AWAITING_PAYMENT: "Waiting for your payment",
  UNDERPAID: "Transfer was short",
  HELD: "Money held",
  STAGE_1_PAID: "Stage 1 sent",
  CODE_VERIFIED: "Delivery confirmed",
  RELEASED: "Stage 2 sent",
  COMPLETE: "Complete",
  PAYOUT_FAILED: "Payout being retried",
  DISPUTED: "Problem reported",
  REFUNDED: "Refunded",
};

const REQUEST_WORDS: Record<RequestStatus, string> = {
  DRAFT: "Not sent yet",
  COLLECTING: "Waiting for quotes",
  VERIFYING: "Checking vendors",
  RECOMMENDED: "Ready for your decision",
  APPROVED: "Approved",
  CANCELLED: "Closed",
};

export type NotificationRow = { id: string; title: string; body: string; href: string | null; when: string; unread: boolean };

async function notificationsOf(accountId: string): Promise<NotificationRow[]> {
  const rows = await db().notification.findMany({ where: { accountId }, orderBy: { createdAt: "desc" }, take: 20 });
  return rows.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, when: `${lagosDay(n.createdAt)} ${lagosTime(n.createdAt)}`, unread: !n.readAt }));
}

export type AccountView = {
  name: string;
  email: string;
  emailVerified: boolean;
  deletionRequested: boolean;
  isVendor: boolean;
  notifications: NotificationRow[];
  purchases: Array<{ id: string; title: string; when: string; status: string; amount: string | null; ref: string | null; href: string; receiptHref: string | null; recordHref: string | null }>;
};

export async function buildAccountView(account: Account): Promise<AccountView> {
  const [notifications, requests] = await Promise.all([
    notificationsOf(account.id),
    db().request.findMany({ where: { buyerId: account.buyerId }, orderBy: { createdAt: "desc" }, take: 50, include: { order: { select: { id: true, number: true, amountKobo: true, status: true } } } }),
  ]);
  return {
    name: account.name,
    email: account.email,
    emailVerified: Boolean(account.emailVerifiedAt),
    deletionRequested: Boolean(account.deletionRequestedAt),
    isVendor: Boolean(account.vendorContactId),
    notifications,
    purchases: requests.map((r) => ({
      id: r.id,
      title: `${r.quantity.toLocaleString("en-NG")} × ${r.item}`,
      when: lagosDay(r.createdAt),
      status: r.order ? ORDER_WORDS[r.order.status] : REQUEST_WORDS[r.status],
      amount: r.order ? formatNaira(r.order.amountKobo) : null,
      ref: r.order ? orderRef(r.order.number) : null,
      href: r.order ? `/orders/${r.order.id}` : `/buy/${r.id}`,
      receiptHref: r.order && !["CREATED", "AWAITING_PAYMENT"].includes(r.order.status) ? `/orders/${r.order.id}/receipt` : null,
      recordHref: r.order ? `/r/${signRecordId(r.order.id)}` : null,
    })),
  };
}

export type VendorDashboardView = {
  notifications: NotificationRow[];
  profile: { businessName: string; phone: string; sells: string; city: string; rcNumber: string; bankCode: string; accountNumber: string; email: string };
  invitations: Array<{ id: string; title: string; deadline: string; status: string; href: string; quoted: boolean; total: string | null }>;
  orders: Array<{ id: string; ref: string; title: string; amount: string; status: string; href: string }>;
};

/** Everything goes through the vendor's own invite link, so the dashboard and a shared link show the same screen. */
export async function buildVendorDashboard(account: Account & { vendorContactId: string }): Promise<VendorDashboardView> {
  const [notifications, contact, vendors] = await Promise.all([
    notificationsOf(account.id),
    db().vendorContact.findUniqueOrThrow({ where: { id: account.vendorContactId } }),
    db().vendor.findMany({
      where: { contactId: account.vendorContactId, request: { isDemo: false } },
      orderBy: { inviteExpiresAt: "desc" },
      take: 50,
      include: { quote: { select: { totalKobo: true } }, request: { select: { id: true, item: true, quantity: true, deadline: true, status: true, order: { select: { id: true, number: true, vendorId: true, amountKobo: true, status: true } } } } },
    }),
  ]);
  const titleOf = (v: (typeof vendors)[number]) => `${v.request.quantity.toLocaleString("en-NG")} × ${v.request.item}`;
  const hrefOf = (v: (typeof vendors)[number]) => `/v/${inviteTokenFor(v.request.id, v.label)}`;
  return {
    notifications,
    profile: {
      businessName: contact.businessName,
      phone: contact.phone,
      sells: contact.category,
      city: contact.city,
      rcNumber: contact.rcNumber ?? "",
      bankCode: contact.bankCode ?? "",
      accountNumber: contact.accountNumber ?? "",
      email: contact.email ?? "",
    },
    invitations: vendors
      .filter((v) => !v.request.order)
      .map((v) => ({
        id: v.id,
        title: titleOf(v),
        deadline: lagosDay(v.request.deadline),
        status: v.quote ? "Quote sent" : ["COLLECTING", "VERIFYING"].includes(v.request.status) ? "Waiting for your quote" : "Closed",
        href: hrefOf(v),
        quoted: Boolean(v.quote),
        total: v.quote?.totalKobo != null ? formatNaira(v.quote.totalKobo) : null,
      })),
    orders: vendors.flatMap((v) => {
      const o = v.request.order;
      return o && o.vendorId === v.id ? [{ id: o.id, ref: orderRef(o.number), title: titleOf(v), amount: formatNaira(o.amountKobo), status: ORDER_WORDS[o.status].replace("your payment", "the buyer's payment"), href: hrefOf(v) }] : [];
    }),
  };
}
