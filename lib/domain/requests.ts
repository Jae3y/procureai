import { lagosDate } from "@/lib/ai/dates";
import { extractSpec } from "@/lib/ai/extract";
import type { Spec, SpecDraft } from "@/lib/ai/fallback";
import { inviteTokenFor, sha256Hex } from "@/lib/crypto";
import { db } from "@/lib/db";
import type { Request } from "@/lib/generated/prisma/client";
import { DomainError, NotFoundError } from "./errors";
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

export async function createRequest(input: { rawText: string; buyerId: string }): Promise<Request> {
  const rawText = input.rawText.replace(/\s+/g, " ").trim();
  if (rawText.length < 5) throw new DomainError("too_short", "Say what, how many, how much, and by when.", 400);
  const now = new Date();
  const parsed = await parseRequestText(rawText, now);
  const d = parsed.draft;
  if (!d.item || !d.quantity || !d.budgetKobo || !d.deadline) throw new IncompleteSpecError(d, parsed.parsedBy);

  const request = await db().request.create({
    data: {
      buyerId: input.buyerId,
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

/** Invites every vendor in the directory. Tokens are returned once and stored only as hashes. */
export async function inviteVendors(requestId: string): Promise<Invite[]> {
  const request = await db().request.findUnique({ where: { id: requestId }, include: { vendors: true } });
  if (!request) throw new NotFoundError("Request");
  if (request.status !== "DRAFT") throw new DomainError("already_invited", "Vendors have already been asked for this request.", 409);
  const contacts = await db().vendorContact.findMany({ orderBy: { createdAt: "asc" } });
  if (contacts.length === 0) throw new DomainError("no_vendors", "There are no vendors in the directory to ask yet.", 409);

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
  }
  await db().request.update({ where: { id: requestId }, data: { status: "COLLECTING" } });
  await requestEvent(requestId, { kind: "info", title: `Asked ${contacts.length} vendors`, detail: contacts.map((c) => c.businessName).join(", ") });
  return invites;
}
