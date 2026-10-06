import { createHash, randomBytes } from "node:crypto";
import { db, transaction, type Tx } from "@/lib/db";
import { lockOrder, transition } from "@/lib/domain/state";
import type { OrderStatus, PayoutRoute, PayoutStage } from "@/lib/generated/prisma/client";

/** Builders that produce rows valid under every DB invariant. */

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}${randomBytes(2).toString("hex")}`;

export async function makeBuyer() {
  return db().buyer.create({ data: { name: "Tolu Adebayo", email: `tolu+${uniq()}@procureai.test` } });
}

export async function makeRequest(buyerId?: string) {
  const buyer = buyerId ?? (await makeBuyer()).id;
  return db().request.create({
    data: {
      buyerId: buyer,
      rawText: "300 branded T-shirts, under ₦1.5m, delivered by 23 October",
      item: "Branded T-shirts",
      quantity: 300,
      budgetKobo: 150_000_000n,
      deadline: new Date("2026-10-23T00:00:00Z"),
      specParsedBy: "FALLBACK",
      status: "COLLECTING",
    },
  });
}

export async function makeVendor(requestId: string, opts: { label?: string; rc?: string; bank?: string; account?: string } = {}) {
  return db().vendor.create({
    data: {
      requestId,
      label: opts.label ?? `Vendor ${uniq()}`,
      name: "Kwik Threads",
      rcNumber: opts.rc ?? "RC00000011",
      bankCode: opts.bank ?? "058",
      accountNumber: opts.account ?? "0123456789",
      contactPhone: `+234816${Math.floor(Math.random() * 1e7).toString().padStart(7, "0")}`,
      email: "orders@kwikthreads.test",
      inviteTokenHash: createHash("sha256").update(uniq()).digest("hex"),
      inviteExpiresAt: new Date(Date.now() + 86_400_000),
      consentAt: new Date(),
    },
  });
}

export async function makeVerification(
  vendorId: string,
  verdict: "VERIFIED" | "FAILED",
  opts: { bank?: string; account?: string } = {},
) {
  const verified = verdict === "VERIFIED";
  return db().vendorVerification.create({
    data: {
      vendorId,
      rcNumber: "RC00000011",
      cacReference: verified ? `VR-CAC-${uniq()}` : null,
      registeredName: verified ? "John Doe Inc" : null,
      companyStatus: verified ? "ACTIVE" : null,
      directors: [{ name: "MICHAEL DOE", designation: "DIRECTOR" }],
      bankCode: opts.bank ?? "058",
      accountNumber: opts.account ?? "0123456789",
      accountReference: verified ? `VR-ACC-${uniq()}` : null,
      accountName: verified ? "MICHAEL JOHN DOE" : null,
      matchMethod: verified ? "DIRECTOR" : "NONE",
      matchScoreBp: verified ? 6666 : 0,
      matchedPerson: verified ? "MICHAEL DOE (director)" : null,
      verdict,
      failureReason: verified ? null : "Company registration could not be verified.",
      simulated: false,
      rawCac: verified ? { status: true, data: { reference: "VR-CAC" } } : { status: false, message: "not found" },
      rawAccount: verified ? { status: true, data: { reference: "VR-ACC" } } : undefined,
    },
  });
}

export async function makeQuote(requestId: string, vendorId: string, totalKobo = 126_000_000n) {
  return db().quote.create({
    data: {
      requestId,
      vendorId,
      rawReply: "I fit do am 4,200 each, delivery free for Lagos, 60% upfront, ready Thursday",
      unitPriceKobo: totalKobo / 300n,
      totalKobo,
      deliveryKobo: 0n,
      quantityOffered: 300,
      upfrontPercent: 60,
      readyDate: new Date("2026-10-08T00:00:00Z"),
      meetsSpec: true,
      flags: [],
      parsedBy: "FALLBACK",
    },
  });
}

/** A request with one vendor, a VERIFIED verification, a quote, and an order in CREATED. */
export async function makeOrderFixture(opts: { amountKobo?: bigint } = {}) {
  const request = await makeRequest();
  const vendor = await makeVendor(request.id, { label: "Vendor B" });
  const verification = await makeVerification(vendor.id, "VERIFIED");
  const amountKobo = opts.amountKobo ?? 126_000_000n;
  const quote = await makeQuote(request.id, vendor.id, amountKobo);
  const order = await db().order.create({
    data: {
      requestId: request.id,
      quoteId: quote.id,
      vendorId: vendor.id,
      verificationId: verification.id,
      amountKobo,
    },
  });
  return { request, vendor, verification, quote, order };
}

export async function moveOrder(orderId: string, path: OrderStatus[]) {
  return transaction(async (tx) => {
    let order = await lockOrder(tx, orderId);
    for (const to of path) order = await transition(tx, order, to, { type: "SYSTEM", id: "test" });
    return order;
  });
}

/** Writes a balanced pay-in posting and marks the order HELD with `acceptedKobo` accepted. */
export async function fundOrder(orderId: string, acceptedKobo: bigint) {
  return transaction(async (tx) => {
    let order = await lockOrder(tx, orderId);
    order = await transition(tx, order, "AWAITING_PAYMENT", { type: "SYSTEM", id: "test" });
    const payIn = await tx.payIn.create({
      data: {
        orderId,
        sequence: 1,
        reference: `PA-${orderId}`,
        amountRequestedKobo: order.amountKobo,
        amountExpectedKobo: order.amountKobo,
        amountPaidKobo: acceptedKobo,
        amountAcceptedKobo: acceptedKobo,
        status: "SUCCESS",
        koraResponse: { status: true },
      },
    });
    await postPayIn(tx, orderId, payIn.id, payIn.reference, acceptedKobo);
    await tx.order.update({ where: { id: orderId }, data: { amountPaidKobo: acceptedKobo, amountAcceptedKobo: acceptedKobo } });
    order = await lockOrder(tx, orderId);
    return transition(tx, order, "HELD", { type: "SYSTEM", id: "test" });
  });
}

export async function postPayIn(tx: Tx, orderId: string, payInId: string, reference: string, amount: bigint) {
  await tx.ledgerEntry.createMany({
    data: [
      { orderId, account: "BUYER_PAYIN", direction: "DEBIT", amountKobo: amount, koraReference: reference, sourceType: "PAYIN", sourceId: payInId },
      { orderId, account: "HELD", direction: "CREDIT", amountKobo: amount, koraReference: reference, sourceType: "PAYIN", sourceId: payInId },
    ],
  });
}

export async function insertPayout(
  tx: Tx,
  input: {
    orderId: string;
    verificationId: string;
    stage: PayoutStage;
    amountKobo: bigint;
    reference?: string;
    route?: PayoutRoute;
    bank?: string;
    account?: string;
    retryOfId?: string;
    attempt?: number;
  },
) {
  return tx.payout.create({
    data: {
      orderId: input.orderId,
      verificationId: input.verificationId,
      stage: input.stage,
      amountKobo: input.amountKobo,
      reference: input.reference ?? `PO-${input.orderId}-${input.stage === "STAGE_1" ? "S1" : "S2"}-${uniq()}`,
      route: input.route ?? "VERIFIED_ACCOUNT",
      destinationBankCode: input.bank ?? "058",
      destinationAccount: input.account ?? "0123456789",
      attempt: input.attempt ?? 1,
      retryOfId: input.retryOfId ?? null,
    },
  });
}
