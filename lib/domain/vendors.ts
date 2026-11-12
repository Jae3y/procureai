import { normalizeQuote } from "@/lib/ai/normalize";
import { sha256Hex } from "@/lib/crypto";
import { db } from "@/lib/db";
import type { Vendor } from "@/lib/generated/prisma/client";
import { formatNaira } from "@/lib/money";
import { notify } from "@/lib/notify/notifications";
import { DomainError } from "./errors";
import { applyDueBankChange } from "./vendor-profiles";
import { createdDateOf, specOf } from "./requests";
import { requestEvent } from "./timeline";

/**
 * The vendor side, reached only through a single-purpose invite link (/v/<token>). The raw token
 * is never stored; we look it up by sha256. Expired or unknown tokens are indistinguishable.
 */

export async function vendorByToken(token: string): Promise<Vendor> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new DomainError("invalid_link", "This link is not valid.", 404);
  const vendor = await db().vendor.findUnique({ where: { inviteTokenHash: sha256Hex(token) } });
  if (!vendor || vendor.inviteExpiresAt < new Date()) throw new DomainError("invalid_link", "This link is not valid or has expired.", 404);
  return vendor;
}

/** Business details are only needed from a vendor who isn't registered on ProcureAI; a registered vendor's are reused. */
export type QuoteSubmission = {
  reply: string;
  businessName?: string;
  rcNumber?: string;
  ownerName?: string;
  bankCode?: string;
  accountNumber?: string;
  email?: string;
  consent?: boolean;
};

type BusinessDetails = { businessName: string; rcNumber: string; ownerName: string; bankCode: string; accountNumber: string; email: string };

/** The details Kora will check: the vendor's ProcureAI profile if they registered, otherwise what they typed in the form. */
async function detailsFor(vendor: Vendor, input: QuoteSubmission): Promise<BusinessDetails> {
  if (vendor.contactId) await applyDueBankChange(vendor.contactId);
  const contact = vendor.contactId ? await db().vendorContact.findUnique({ where: { id: vendor.contactId } }) : null;
  if (contact?.registeredAt && (contact.rcNumber || contact.ownerName) && contact.bankCode && contact.accountNumber && contact.email) {
    return { businessName: contact.businessName, rcNumber: contact.rcNumber ?? "", ownerName: contact.ownerName ?? "", bankCode: contact.bankCode, accountNumber: contact.accountNumber, email: contact.email };
  }
  if (!input.consent) throw new DomainError("consent_required", "Tick the box to let ProcureAI check your business and bank account.", 400);
  const { businessName, rcNumber = "", ownerName = "", bankCode, accountNumber, email } = input;
  if (!businessName || !bankCode || !accountNumber || !email || (!rcNumber && !ownerName)) {
    throw new DomainError("details_required", "Add your business name, bank, account number, email, and either your CAC number or the name on your bank account.", 400);
  }
  return { businessName, rcNumber, ownerName, bankCode, accountNumber, email };
}

/** One reply per invite, with the business details Kora will check. */
export async function submitQuote(token: string, input: QuoteSubmission) {
  const vendor = await vendorByToken(token);
  const request = await db().request.findUniqueOrThrow({ where: { id: vendor.requestId } });
  if (request.status !== "COLLECTING" && request.status !== "VERIFYING") {
    throw new DomainError("closed", "This request is no longer taking quotes.", 409);
  }
  const existing = await db().quote.findUnique({ where: { vendorId: vendor.id } });
  if (existing) throw new DomainError("already_quoted", "You've already sent a quote for this request.", 409);
  const details = await detailsFor(vendor, input);

  const { quote, parsedBy, model, note } = await normalizeQuote(input.reply, specOf(request), createdDateOf(request));
  await db().vendor.update({
    where: { id: vendor.id },
    data: {
      name: details.businessName.trim(),
      rcNumber: details.rcNumber.trim().toUpperCase() || null,
      ownerName: details.ownerName.trim() || null,
      bankCode: details.bankCode.trim(),
      accountNumber: details.accountNumber.trim(),
      email: details.email.trim().toLowerCase(),
      consentAt: new Date(),
    },
  });
  const created = await db().quote.create({
    data: {
      requestId: request.id,
      vendorId: vendor.id,
      rawReply: input.reply.trim(),
      unitPriceKobo: quote.unitPriceKobo,
      totalKobo: quote.totalKobo,
      deliveryKobo: quote.deliveryKobo,
      quantityOffered: quote.quantityOffered,
      upfrontPercent: quote.upfrontPercent,
      readyDate: quote.readyDate ? new Date(`${quote.readyDate}T00:00:00Z`) : null,
      meetsSpec: quote.meetsSpec,
      flags: quote.flags,
      parsedBy,
      model,
    },
  });
  await requestEvent(request.id, {
    kind: "info",
    title: `${vendor.label} replied`,
    detail: `${quote.totalKobo !== null ? formatNaira(quote.totalKobo) : "no price"} · read by ${parsedBy === "AI" ? `AI (${model ?? "model"})` : `rules${note ? ` — ${note}` : ""}`}`,
  });
  const buyerAccount = await db().account.findUnique({ where: { buyerId: request.buyerId }, select: { id: true } });
  if (buyerAccount) {
    await notify(db(), {
      accountId: buyerAccount.id,
      kind: "quote",
      title: "A vendor replied",
      body: `${vendor.label} sent a quote for ${request.item}${quote.totalKobo !== null ? `: ${formatNaira(quote.totalKobo)}` : ""}.`,
      href: `/buy/${request.id}`,
    });
  }
  return created;
}
