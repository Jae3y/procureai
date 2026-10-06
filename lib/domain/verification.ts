import { db } from "@/lib/db";
import type { VendorVerification } from "@/lib/generated/prisma/client";
import { kora } from "@/lib/kora/client";
import { isKoraError, type KoraError } from "@/lib/kora/errors";
import { log } from "@/lib/log";
import { type CacOutcome, matchVendor } from "./matching";
import { DomainError, NotFoundError } from "./errors";
import { toJson } from "./kora-events";
import { requestEvent } from "./timeline";

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

function definitiveRefusal(e: KoraError): boolean {
  // A 4xx that is not about our access: Kora looked and said no.
  return e.outcomeKnown && e.kind !== "auth" && e.kind !== "access";
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
  const vendors = request.vendors.filter((v) => v.quote && v.rcNumber && v.bankCode && v.accountNumber);
  if (vendors.length === 0) throw new DomainError("no_quotes", "No vendor has replied with business details yet.", 409);

  await db().request.update({ where: { id: requestId }, data: { status: "VERIFYING" } });
  const k = kora();
  const signature = k.identitySimulated ? "SIMULATED" : "API";
  const outcomes: VerifyOutcome[] = [];

  for (const v of vendors) {
    const rc = v.rcNumber ?? "";
    const bankCode = v.bankCode ?? "";
    const accountNumber = v.accountNumber ?? "";
    const consent = Boolean(v.consentAt);
    try {
      let cac: CacOutcome;
      let rawCac: unknown;
      let cacReference: string | null = null;
      try {
        const r = await k.verifyCac({ rcNumber: rc, consent });
        cac = { found: true, registeredName: r.data.name, companyStatus: r.data.company_status, keyPersonnel: r.data.key_personnel };
        rawCac = r.raw;
        cacReference = r.data.reference;
        await requestEvent(requestId, {
          kind: "kora",
          title: "identity.cac",
          detail: `${v.label} · ${r.data.name} · ${(r.data.company_status ?? "unknown").toLowerCase()}`,
          koraReference: r.data.reference,
          signature,
        });
      } catch (e) {
        if (!isKoraError(e) || !definitiveRefusal(e)) throw e;
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
          const a = await k.verifyBankAccountBasic({ accountNumber, bankCode, consent });
          accountName = a.data.account_details.name;
          accountReference = a.data.reference;
          rawAccount = a.raw;
        } catch (e) {
          if (!isKoraError(e) || !definitiveRefusal(e)) throw e;
          rawAccount = e.body ?? { error: e.toJSON() };
        }
      }

      const match = matchVendor(cac, accountName);
      const verification = await db().vendorVerification.create({
        data: {
          vendorId: v.id,
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
      if (!isKoraError(e)) throw e;
      log.warn({ vendorId: v.id, kind: e.kind, err: e.message }, "identity check could not complete");
      await requestEvent(requestId, { kind: "error", title: `Couldn't check ${v.label} with Kora`, detail: e.userMessage });
      outcomes.push({ vendorId: v.id, label: v.label, verification: null, error: { kind: e.kind, message: e.userMessage } });
    }
  }
  return outcomes;
}
