import { normalizeQuote } from "@/lib/ai/normalize";
import { sha256Hex } from "@/lib/crypto";
import { db } from "@/lib/db";
import type { Vendor } from "@/lib/generated/prisma/client";
import { formatNaira } from "@/lib/money";
import { DomainError } from "./errors";
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

export type QuoteSubmission = {
  reply: string;
  businessName: string;
  rcNumber: string;
  bankCode: string;
  accountNumber: string;
  email: string;
  consent: boolean;
};

/** One reply per invite, with the business details Kora will check. */
export async function submitQuote(token: string, input: QuoteSubmission) {
  const vendor = await vendorByToken(token);
  const request = await db().request.findUniqueOrThrow({ where: { id: vendor.requestId } });
  if (request.status !== "COLLECTING" && request.status !== "VERIFYING") {
    throw new DomainError("closed", "This request is no longer taking quotes.", 409);
  }
  const existing = await db().quote.findUnique({ where: { vendorId: vendor.id } });
  if (existing) throw new DomainError("already_quoted", "You've already sent a quote for this request.", 409);
  if (!input.consent) throw new DomainError("consent_required", "Tick the box to let ProcureAI check your business with Kora.", 400);

  const { quote, parsedBy, model, note } = await normalizeQuote(input.reply, specOf(request), createdDateOf(request));
  await db().vendor.update({
    where: { id: vendor.id },
    data: {
      name: input.businessName.trim(),
      rcNumber: input.rcNumber.trim().toUpperCase(),
      bankCode: input.bankCode.trim(),
      accountNumber: input.accountNumber.trim(),
      email: input.email.trim().toLowerCase(),
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
  return created;
}
