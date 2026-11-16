import { db } from "@/lib/db";
import type { Vendor, VendorVerification } from "@/lib/generated/prisma/client";
import { isProviderError, payments, type ProviderError } from "@/lib/payments";
import { log } from "@/lib/log";
import { type CacOutcome, matchAccountOwner, matchVendor } from "./matching";
import { DomainError, NotFoundError } from "./errors";
import { toJson } from "./kora-events";
import { requestEvent, type TimelineSignature } from "./timeline";

/**
 * THE IDENTITY GATE — runs before any recommendation, for every vendor that replied.
 *   1. POST /identities/ng/cac with the RC number.
 *   2. GET /identities/ng/banks?type=basic (cached in the client) validates the bank code.
 *   3. POST /identities/ng/bank-account-basic resolves the payout account's name.
 *   4. lib/domain/matching.ts decides VERIFIED / FAILED.
 *
 * Only a definitive answer writes a VendorVerification row. If Kora can't be reached, or denies
 * access, nothing is written for that vendor and the reason is returned — an outage never turns
 * into "FAILED" (which would wrongly exclude a vendor) or "VERIFIED".
 */

export type VerifyOutcome = {
  vendorId: string;
  label: string;
  verification: VendorVerification | null;
  error: { kind: string; message: string } | null;
};

const NOT_FOUND = "Company registration could not be verified.";

/**
 * A company's CAC record changes rarely, and each lookup costs money. A FOUND result from the same provider is
 * reused for this long; the bank account is still checked on every purchase, because that decides where money
 * goes. "Not found" is never reused (a company registered yesterday must not be stuck with an old answer), and
 * a reused result is never reused again, so no record is older than this.
 */
export const CAC_REUSE_DAYS = 30;

type ReusedCac = { cac: Extract<CacOutcome, { found: true }>; cacReference: string; fromId: string; checkedAt: Date };

async function recentCac(rcNumber: string, provider: string, simulated: boolean, now = new Date()): Promise<ReusedCac | null> {
  const since = new Date(now.getTime() - CAC_REUSE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db().vendorVerification.findMany({
    where: { rcNumber, provider, simulated, checkedAt: { gte: since }, registeredName: { not: null }, cacReference: { not: null } },
    orderBy: { checkedAt: "desc" },
    take: 10,
  });
  for (const r of rows) {
    const raw = r.rawCac as Record<string, unknown> | null;
    if (!raw || "reusedFrom" in raw || !r.registeredName || !r.cacReference) continue;
    const people = Array.isArray(r.directors) ? (r.directors as Array<{ name?: unknown; designation?: unknown; status?: unknown }>) : [];
    return {
      cac: {
        found: true,
        registeredName: r.registeredName,
        companyStatus: r.companyStatus,
        keyPersonnel: people
          .filter((p) => typeof p.name === "string")
          .map((p) => ({ name: String(p.name), ...(typeof p.designation === "string" ? { designation: p.designation } : {}), ...(typeof p.status === "string" ? { status: p.status } : {}) })),
      },
      cacReference: r.cacReference,
      fromId: r.id,
      checkedAt: r.checkedAt,
    };
  }
  return null;
}

function definitiveRefusal(e: ProviderError): boolean {
  // A 4xx that is not about our access: Kora looked and said no.
  return e.outcomeKnown && e.kind !== "auth" && e.kind !== "access";
}

/**
 * A seller with no CAC number: the bank is the check. The provider resolves the payout account's name and
 * matchAccountOwner compares it to the name the seller gave. Same rule as above for outages: only a definitive
 * answer writes a row; a provider that can't be reached writes nothing and the reason comes back.
 */
async function verifyByAccountOwner(
  requestId: string,
  v: Vendor,
  d: { bankCode: string; accountNumber: string; consent: boolean },
  signature: TimelineSignature,
): Promise<VerifyOutcome> {
  const k = payments();
  let accountName: string | null = null;
  let accountReference: string | null = null;
  let rawAccount: unknown = null;
  try {
    const a = await k.verifyBankAccount({ accountNumber: d.accountNumber, bankCode: d.bankCode, consent: d.consent });
    accountName = a.data.accountName;
    accountReference = a.data.reference;
    rawAccount = a.raw;
  } catch (e) {
    if (!isProviderError(e) || !definitiveRefusal(e)) throw e;
    rawAccount = e.body ?? { error: e.toJSON() };
  }
  const match = matchAccountOwner(accountName, v.ownerName, v.name);
  const verification = await db().vendorVerification.create({
    data: {
      vendorId: v.id,
      provider: k.id,
      rcNumber: "",
      cacReference: null,
      registeredName: null,
      companyStatus: null,
      directors: toJson([]),
      bankCode: d.bankCode,
      accountNumber: d.accountNumber,
      accountReference,
      accountName,
      matchMethod: match.matchMethod,
      matchScoreBp: match.matchScoreBp,
      matchedPerson: null,
      verdict: match.verdict,
      failureReason: match.failureReason,
      simulated: k.identitySimulated,
      rawCac: toJson({ skipped: "no CAC registration number; checked by bank account owner" }),
      rawAccount: rawAccount === null ? undefined : toJson(rawAccount),
    },
  });
  await requestEvent(requestId, {
    kind: "kora",
    title: "identity.account",
    detail: match.verdict === "VERIFIED" ? `${v.label} · the bank confirmed the payout account is in the seller's own name` : `${v.label} · ${match.failureReason ?? "account did not match"}`,
    koraReference: accountReference,
    signature,
  });
  return { vendorId: v.id, label: v.label, verification, error: null };
}

export async function verifyVendors(requestId: string): Promise<VerifyOutcome[]> {
  const request = await db().request.findUnique({
    where: { id: requestId },
    include: { vendors: { include: { quote: true }, orderBy: { label: "asc" } } },
  });
  if (!request) throw new NotFoundError("Request");
  if (request.status === "APPROVED" || request.status === "CANCELLED") {
    throw new DomainError("closed", "This request is closed.", 409);
  }
  const vendors = request.vendors.filter((v) => v.quote && (v.rcNumber || v.ownerName) && v.bankCode && v.accountNumber);
  if (vendors.length === 0) throw new DomainError("no_quotes", "No vendor has replied with business details yet.", 409);

  await db().request.update({ where: { id: requestId }, data: { status: "VERIFYING" } });
  const k = payments();
  const signature = k.identitySimulated ? "SIMULATED" : "API";
  const outcomes: VerifyOutcome[] = [];

  for (const v of vendors) {
    const rc = v.rcNumber ?? "";
    const bankCode = v.bankCode ?? "";
    const accountNumber = v.accountNumber ?? "";
    const consent = Boolean(v.consentAt);
    try {
      if (!rc) {
        outcomes.push(await verifyByAccountOwner(requestId, v, { bankCode, accountNumber, consent }, signature));
        continue;
      }
      let cac: CacOutcome;
      let rawCac: unknown;
      let cacReference: string | null = null;
      const reused = await recentCac(rc, k.id, k.identitySimulated);
      if (reused) {
        cac = reused.cac;
        cacReference = reused.cacReference;
        rawCac = { reusedFrom: reused.fromId, checkedAt: reused.checkedAt.toISOString(), reason: `found within the last ${CAC_REUSE_DAYS} days` };
        const days = Math.max(0, Math.floor((Date.now() - reused.checkedAt.getTime()) / 86_400_000));
        await requestEvent(requestId, {
          kind: "kora",
          title: "identity.cac",
          detail: `${v.label} · ${reused.cac.registeredName} · ${(reused.cac.companyStatus ?? "unknown").toLowerCase()} · CAC record checked ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}`,
          koraReference: reused.cacReference,
          signature,
        });
      } else try {
        const r = await k.verifyBusiness({ rcNumber: rc, consent });
        cac = { found: true, registeredName: r.data.name, companyStatus: r.data.companyStatus, keyPersonnel: r.data.keyPersonnel };
        rawCac = r.raw;
        cacReference = r.data.reference;
        await requestEvent(requestId, {
          kind: "kora",
          title: "identity.cac",
          detail: `${v.label} · ${r.data.name} · ${(r.data.companyStatus ?? "unknown").toLowerCase()}`,
          koraReference: r.data.reference,
          signature,
        });
      } catch (e) {
        if (!isProviderError(e) || !definitiveRefusal(e)) throw e;
        cac = { found: false, reason: NOT_FOUND };
        rawCac = e.body ?? { error: e.toJSON() };
        await requestEvent(requestId, {
          kind: "kora",
          title: "identity.cac",
          detail: `${v.label} · registration not found (${rc})`,
          koraReference: null,
          signature,
        });
      }

      let accountName: string | null = null;
      let accountReference: string | null = null;
      let rawAccount: unknown = null;
      if (cac.found) {
        try {
          const a = await k.verifyBankAccount({ accountNumber, bankCode, consent });
          accountName = a.data.accountName;
          accountReference = a.data.reference;
          rawAccount = a.raw;
        } catch (e) {
          if (!isProviderError(e) || !definitiveRefusal(e)) throw e;
          rawAccount = e.body ?? { error: e.toJSON() };
        }
      }

      const match = matchVendor(cac, accountName);
      const verification = await db().vendorVerification.create({
        data: {
          vendorId: v.id,
          provider: k.id,
          rcNumber: rc,
          cacReference,
          registeredName: cac.found ? cac.registeredName : null,
          companyStatus: cac.found ? (cac.companyStatus ?? null) : null,
          directors: toJson(cac.found ? cac.keyPersonnel.map((p) => ({ name: p.name, designation: p.designation ?? null, status: p.status ?? null })) : []),
          bankCode,
          accountNumber,
          accountReference,
          accountName,
          matchMethod: match.matchMethod,
          matchScoreBp: match.matchScoreBp,
          matchedPerson: match.matchedPerson,
          verdict: match.verdict,
          failureReason: match.failureReason,
          simulated: k.identitySimulated,
          rawCac: toJson(rawCac),
          rawAccount: rawAccount === null ? undefined : toJson(rawAccount),
        },
      });
      if (cac.found) {
        await requestEvent(requestId, {
          kind: "kora",
          title: "identity.account",
          detail:
            match.verdict === "VERIFIED"
              ? `${v.label} · payout account owner is ${match.matchMethod === "COMPANY" ? "the company" : `a ${match.matchedPerson?.includes("shareholder") ? "shareholder" : "director"}`}`
              : `${v.label} · ${match.failureReason ?? "account did not match"}`,
          koraReference: accountReference,
          signature,
        });
      }
      outcomes.push({ vendorId: v.id, label: v.label, verification, error: null });
    } catch (e) {
      if (!isProviderError(e)) throw e;
      log.warn({ vendorId: v.id, kind: e.kind, err: e.message }, "identity check could not complete");
      await requestEvent(requestId, { kind: "error", title: `Couldn't check ${v.label} yet`, detail: e.userMessage });
      outcomes.push({ vendorId: v.id, label: v.label, verification: null, error: { kind: e.kind, message: e.userMessage } });
    }
  }
  return outcomes;
}
