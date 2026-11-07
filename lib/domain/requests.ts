import { lagosDate } from "@/lib/ai/dates";
import { extractSpec } from "@/lib/ai/extract";
import type { Spec, SpecDraft } from "@/lib/ai/fallback";
import { inviteTokenFor, sha256Hex } from "@/lib/crypto";
import { ensureDemoDirectory } from "@/lib/demo/directory";
import { db } from "@/lib/db";
import { shortlist } from "./sourcing";
import { env } from "@/lib/env";
import type { Request } from "@/lib/generated/prisma/client";
import { notify } from "@/lib/notify/notifications";
import { DomainError, NotFoundError } from "./errors";
import { normalizeNigerianPhone } from "./vendor-profiles";
import { requestEvent } from "./timeline";

/**
 * A buyer's one sentence → a Request with a complete spec. Incomplete specs are not stored: the
 * route returns the draft (what was understood, what is missing) and the buyer edits the sentence.
 */

export class IncompleteSpecError extends DomainError {
  constructor(readonly draft: SpecDraft, readonly parsedBy: "AI" | "FALLBACK") {
    const missing = (["item", "quantity", "budgetKobo", "deadline"] as const)
      .filter((k) => draft[k] === null)
      .map((k) => (k === "budgetKobo" ? "budget" : k));
    super("incomplete_spec", `Add the missing part: ${missing.join(", ")}.`, 422, { missing });
  }
}

export function specOf(r: Pick<Request, "item" | "quantity" | "budgetKobo" | "deadline">): Spec {
  return { item: r.item, quantity: r.quantity, budgetKobo: r.budgetKobo, deadline: r.deadline.toISOString().slice(0, 10) };
}

export function createdDateOf(r: Pick<Request, "createdAt">): string {
  return lagosDate(r.createdAt);
}

export async function parseRequestText(rawText: string, now = new Date()) {
  return extractSpec(rawText.trim(), lagosDate(now));
}

/**
 * A fresh demo deployment starts with an empty vendor directory, which would leave "Ask vendors"
 * disabled, and a redeploy may change the demo vendors. In DEMO_MODE only, make sure the three demo
 * vendors exist with their current details (idempotent upserts by phone).
 */
async function seedDemoDirectory(): Promise<void> {
  if (env().DEMO_MODE) await ensureDemoDirectory();
}

/**
 * `isDemo` is decided by who is asking: a signed-in buyer's purchase is real, a visitor's is a demo.
 * Scripts and the presenter leave it out and get whatever the deployment is.
 */
export async function createRequest(input: { rawText: string; buyerId: string; isDemo?: boolean }): Promise<Request> {
  const rawText = input.rawText.replace(/\s+/g, " ").trim();
  if (rawText.length < 5) throw new DomainError("too_short", "Say what, how many, how much, and by when.", 400);
  const now = new Date();
  const parsed = await parseRequestText(rawText, now);
  const d = parsed.draft;
  if (!d.item || !d.quantity || !d.budgetKobo || !d.deadline) throw new IncompleteSpecError(d, parsed.parsedBy);

  await seedDemoDirectory();
  const request = await db().request.create({
    data: {
      buyerId: input.buyerId,
      isDemo: input.isDemo ?? env().DEMO_MODE,
      rawText,
      item: d.item,
      quantity: d.quantity,
      budgetKobo: d.budgetKobo,
      deadline: new Date(`${d.deadline}T00:00:00Z`),
      specParsedBy: parsed.parsedBy,
      specModel: parsed.model,
      createdAt: now,
    },
  });
  await requestEvent(request.id, {
    kind: "info",
    title: parsed.parsedBy === "AI" ? "Request understood by AI" : "Request understood by rules",
    detail: parsed.note ?? (parsed.model ? `model ${parsed.model}` : null),
  });
  return request;
}

export type Invite = { vendorId: string; label: string; phone: string; businessName: string; token: string };

/**
 * Who a purchase may reach: a demo goes only to the scripted vendors, a real purchase only to vendors
 * who registered themselves. Neither side can ever see the other's.
 */
export function directoryFilter(isDemo: boolean) {
  return isDemo ? { isDemo: true } : { isDemo: false, registeredAt: { not: null } };
}

/** Invites the matching vendors. A real purchase can start with none: the buyer can add vendors they know. */
export async function inviteVendors(requestId: string): Promise<Invite[]> {
  const request = await db().request.findUnique({ where: { id: requestId }, include: { vendors: true } });
  if (!request) throw new NotFoundError("Request");
  if (request.status !== "DRAFT") throw new DomainError("already_invited", "Vendors have already been asked for this request.", 409);
  await seedDemoDirectory();
  const directory = await db().vendorContact.findMany({ where: directoryFilter(request.isDemo), orderBy: { createdAt: "asc" }, include: { account: { select: { id: true } } } });
  const contacts = shortlist(directory, request.item);
  if (contacts.length === 0 && request.isDemo) throw new DomainError("no_vendors", "There are no vendors in the directory to ask yet.", 409);

  const expires = new Date(request.deadline.getTime() + 14 * 86_400_000);
  const invites: Invite[] = [];
  for (const [i, c] of contacts.entries()) {
    const label = `Vendor ${String.fromCharCode(65 + i)}`;
    const token = inviteTokenFor(requestId, label);
    const vendor = await db().vendor.create({
      data: {
        requestId,
        contactId: c.id,
        label,
        contactPhone: c.phone,
        inviteTokenHash: sha256Hex(token),
        inviteExpiresAt: expires,
      },
    });
    invites.push({ vendorId: vendor.id, label, phone: c.phone, businessName: c.businessName, token });
    if (c.account) {
      await notify(db(), { accountId: c.account.id, kind: "invite", title: "A buyer needs what you sell", body: `${request.quantity.toLocaleString("en-NG")} × ${request.item}, by ${request.deadline.toISOString().slice(0, 10)}. Reply with your price.`, href: `/v/${token}` });
    }
  }
  await db().request.update({ where: { id: requestId }, data: { status: "COLLECTING" } });
  await requestEvent(requestId, { kind: "info", title: `Asked ${contacts.length} vendors`, detail: `Searched ${directory.length} in the directory and matched ${contacts.length} to "${request.item}"${contacts.length ? `: ${contacts.map((c) => c.businessName).join(", ")}` : ""}` });
  return invites;
}

export const MAX_VENDORS_PER_REQUEST = 20;

function nextLabel(taken: readonly string[]): string {
  for (let i = 0; i < 26; i++) {
    const label = `Vendor ${String.fromCharCode(65 + i)}`;
    if (!taken.includes(label)) return label;
  }
  throw new DomainError("too_many_vendors", "This request has reached its limit of vendors.", 409);
}

/**
 * The buyer brings a vendor they already know, by name and phone. The vendor goes through the same
 * invite link and the same Kora check as anyone else. The contact is never marked registered: only
 * the vendor can do that, by signing up with this phone.
 */
export async function addBuyerVendor(requestId: string, input: { businessName: string; phone: string }): Promise<Invite> {
  const phone = normalizeNigerianPhone(input.phone);
  const request = await db().request.findUnique({ where: { id: requestId }, include: { vendors: { select: { label: true, contactPhone: true } } } });
  if (!request) throw new NotFoundError("Request");
  if (request.isDemo) throw new DomainError("demo_request", "A demo purchase uses the demo vendors. Sign up to invite your own.", 409);
  if (request.status !== "COLLECTING") throw new DomainError("closed", "This request isn't taking new vendors right now.", 409);
  if (request.vendors.some((v) => v.contactPhone === phone)) throw new DomainError("already_asked", "This vendor has already been asked.", 409);
  if (request.vendors.length >= MAX_VENDORS_PER_REQUEST) throw new DomainError("too_many_vendors", "This request has reached its limit of vendors.", 409);

  const businessName = input.businessName.trim();
  const contact = await db().vendorContact.upsert({ where: { phone }, update: {}, create: { phone, businessName, category: request.item.toLowerCase(), city: "" } });
  if (contact.isDemo) throw new DomainError("demo_number", "That number belongs to a demo vendor. Use the vendor's real number.", 400);
  const label = nextLabel(request.vendors.map((v) => v.label));
  const token = inviteTokenFor(requestId, label);
  const vendor = await db().vendor.create({
    data: {
      requestId,
      contactId: contact.id,
      addedByBuyer: true,
      label,
      contactPhone: phone,
      inviteTokenHash: sha256Hex(token),
      inviteExpiresAt: new Date(request.deadline.getTime() + 14 * 86_400_000),
    },
  });
  await requestEvent(requestId, { kind: "info", title: `Added ${businessName}`, detail: "The buyer added this vendor and shares the link themselves" });
  return { vendorId: vendor.id, label, phone, businessName, token };
}
