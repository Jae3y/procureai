import { inviteTokenFor, signRecordId } from "@/lib/crypto";
import { db } from "@/lib/db";
import type { Account, OrderStatus, RequestStatus } from "@/lib/generated/prisma/client";
import { applyDueBankChange } from "@/lib/domain/vendor-profiles";
import { formatNaira } from "@/lib/money";
import { emailEnabled } from "@/lib/notify/email";
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
  /** Email sending is switched on, so a confirmation link can be sent. */
  emailWorks: boolean;
  /** False for accounts that only sign in with Google: they set a first password instead of changing one. */
  hasPassword: boolean;
  /** The account is linked to a Google sign-in. */
  signsInWithGoogle: boolean;
  /** Email choices: check-ins (welcome, "did it arrive well?") and occasional tips (marketing consent). */
  emails: { checkins: boolean; tips: boolean };
  deletionRequested: boolean;
  isVendor: boolean;
  twoStep: { on: boolean; recoveryCodesLeft: number };
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
    emailWorks: emailEnabled(),
    hasPassword: Boolean(account.passwordHash),
    signsInWithGoogle: Boolean(account.googleSub),
    emails: { checkins: !account.emailsOffAt, tips: Boolean(account.marketingConsentAt) && !account.emailsOffAt },
    deletionRequested: Boolean(account.deletionRequestedAt),
    isVendor: Boolean(account.vendorContactId),
    twoStep: { on: Boolean(account.totpEnabledAt), recoveryCodesLeft: account.recoveryCodeHashes.length },
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
  profile: { businessName: string; phone: string; sells: string; city: string; rcNumber: string; ownerName: string; bankCode: string; accountNumber: string; email: string; foundingNumber: number | null };
  /** A bank change waiting out its 24 hours. */
  pendingBank: { accountEnding: string; effective: string } | null;
  twoStepOn: boolean;
  invitations: Array<{ id: string; title: string; deadline: string; status: string; href: string; quoted: boolean; total: string | null }>;
  orders: Array<{ id: string; ref: string; title: string; amount: string; status: string; href: string }>;
  /** The seller's marketplace products (removed ones are left out). */
  listings: Array<{ id: string; title: string; description: string; category: string; price: string; unit: string; minOrder: number; status: "ACTIVE" | "PAUSED"; hasPhoto: boolean }>;
};

/** Everything goes through the vendor's own invite link, so the dashboard and a shared link show the same screen. */
export async function buildVendorDashboard(account: Account & { vendorContactId: string }): Promise<VendorDashboardView> {
  await applyDueBankChange(account.vendorContactId);
  const [notifications, contact, vendors, listings] = await Promise.all([
    notificationsOf(account.id),
    db().vendorContact.findUniqueOrThrow({ where: { id: account.vendorContactId } }),
    db().vendor.findMany({
      where: { contactId: account.vendorContactId, request: { isDemo: false } },
      orderBy: { inviteExpiresAt: "desc" },
      take: 50,
      include: { quote: { select: { totalKobo: true } }, request: { select: { id: true, item: true, quantity: true, deadline: true, status: true, order: { select: { id: true, number: true, vendorId: true, amountKobo: true, status: true } } } } },
    }),
    db().listing.findMany({
      where: { contactId: account.vendorContactId, status: { not: "REMOVED" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, description: true, category: true, priceKobo: true, unit: true, minOrder: true, status: true, photoType: true },
    }),
  ]);
  const titleOf = (v: (typeof vendors)[number]) => `${v.request.quantity.toLocaleString("en-NG")} × ${v.request.item}`;
  const hrefOf = (v: (typeof vendors)[number]) => `/v/${inviteTokenFor(v.request.id, v.label)}`;
  return {
    notifications,
    profile: {
      businessName: contact.businessName,
      foundingNumber: contact.foundingNumber,
      phone: contact.phone,
      sells: contact.category,
      city: contact.city,
      rcNumber: contact.rcNumber ?? "",
      ownerName: contact.ownerName ?? "",
      bankCode: contact.bankCode ?? "",
      accountNumber: contact.accountNumber ?? "",
      email: contact.email ?? "",
    },
    pendingBank:
      contact.pendingBankEffectiveAt && contact.pendingAccountNumber
        ? { accountEnding: contact.pendingAccountNumber.slice(-4), effective: `${lagosDay(contact.pendingBankEffectiveAt)} ${lagosTime(contact.pendingBankEffectiveAt)}` }
        : null,
    twoStepOn: Boolean(account.totpEnabledAt),
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
    listings: listings.map((l) => ({
      id: l.id,
      title: l.title,
      description: l.description,
      category: l.category,
      price: l.priceKobo === null ? "" : formatNaira(l.priceKobo).replace("₦", ""),
      unit: l.unit,
      minOrder: l.minOrder,
      status: l.status === "PAUSED" ? ("PAUSED" as const) : ("ACTIVE" as const),
      hasPhoto: Boolean(l.photoType),
    })),
  };
}
