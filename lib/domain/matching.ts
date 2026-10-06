/**
 * THE MATCHING RULE — whether a vendor's payout account belongs to the registered business or to
 * one of its directors/shareholders. This decides who may be paid.
 *
 * VERIFIED requires company_status ACTIVE and the resolved account name matching EITHER
 *   COMPANY  — the registered company name, or
 *   DIRECTOR — a key person whose designation is DIRECTOR or SHAREHOLDER (and who is not resigned).
 *
 * Normalisation: uppercase → strip punctuation, collapse whitespace → drop legal suffixes →
 * tokenise. Matching is order-insensitive token containment, and matchScore is |A∩B| / |A∪B|.
 *
 * Two deliberate tightenings of "every token of the shorter name appears in the longer"
 * (DECISIONS.md D-02), both needed for the required cases and both safer:
 *   1. COMPANY is one-directional: every account-name token must be in the registered name. A
 *      personal account "MICHAEL JOHN DOE" contains company "JOHN DOE (INC)" but is not the
 *      company's account — with the symmetric rule it would verify as COMPANY, and anyone whose
 *      name contains a company's name could pass as that company.
 *   2. The shorter side needs ≥ 2 tokens (unless both sides are a single token): a bare surname
 *      never verifies an account.
 */

export type KeyPerson = { name: string; designation?: string | null | undefined; status?: string | null | undefined };

export type CacOutcome =
  | { found: true; registeredName: string; companyStatus: string | null | undefined; keyPersonnel: KeyPerson[] }
  | { found: false; reason: string };

export type MatchResult = {
  verdict: "VERIFIED" | "FAILED";
  matchMethod: "COMPANY" | "DIRECTOR" | "NONE";
  matchScoreBp: number;
  matchedPerson: string | null;
  failureReason: string | null;
};

export const LEGAL_SUFFIXES: ReadonlySet<string> = new Set([
  "LTD",
  "LIMITED",
  "PLC",
  "INC",
  "ENTERPRISES",
  "VENTURES",
  "NIG",
  "NIGERIA",
  "&",
  "AND",
]);

export function normalizeName(name: string): string[] {
  const upper = name.toUpperCase().replace(/&/g, " & ");
  const cleaned = upper.replace(/[^\p{L}\p{N}&\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const tokens = cleaned.split(" ").filter((t) => t.length > 0 && !LEGAL_SUFFIXES.has(t));
  return [...new Set(tokens)];
}

/** |A∩B| / |A∪B| in basis points (integer, no floats). */
export function overlapBp(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const inter = b.filter((t) => sa.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return Math.floor((inter * 10_000) / union);
}

function contains(container: readonly string[], items: readonly string[]): boolean {
  const s = new Set(container);
  return items.every((t) => s.has(t));
}

function enoughTokens(shorter: readonly string[], longer: readonly string[]): boolean {
  return shorter.length >= 2 || (shorter.length === 1 && longer.length === 1);
}

/** Symmetric rule for people: every token of the shorter name appears in the longer. */
export function personMatches(accountTokens: readonly string[], personTokens: readonly string[]): boolean {
  const [shorter, longer] =
    accountTokens.length <= personTokens.length ? [accountTokens, personTokens] : [personTokens, accountTokens];
  return shorter.length > 0 && enoughTokens(shorter, longer) && contains(longer, shorter);
}

/** One-directional rule for the company: the account name may only use words from the registered name. */
export function companyMatches(accountTokens: readonly string[], companyTokens: readonly string[]): boolean {
  return (
    accountTokens.length > 0 && enoughTokens(accountTokens, companyTokens) && contains(companyTokens, accountTokens)
  );
}

function isEligiblePerson(p: KeyPerson): "DIRECTOR" | "SHAREHOLDER" | null {
  const status = (p.status ?? "").toUpperCase();
  if (status && status !== "ACTIVE") return null;
  const d = (p.designation ?? "").toUpperCase();
  if (/\bDIRECTOR\b/.test(d)) return "DIRECTOR";
  if (/\bSHAREHOLDER\b/.test(d)) return "SHAREHOLDER";
  return null;
}

export function matchVendor(cac: CacOutcome, accountName: string | null): MatchResult {
  const fail = (failureReason: string, matchScoreBp = 0): MatchResult => ({
    verdict: "FAILED",
    matchMethod: "NONE",
    matchScoreBp,
    matchedPerson: null,
    failureReason,
  });

  if (!cac.found) return fail(cac.reason);

  const status = (cac.companyStatus ?? "").trim().toUpperCase();
  if (status !== "ACTIVE") {
    return fail(`Company is registered but its status is ${status ? status.toLowerCase() : "unknown"}, not active.`);
  }
  if (!accountName || !accountName.trim()) return fail("Kora could not resolve the payout account's name.");

  const account = normalizeName(accountName);
  const company = normalizeName(cac.registeredName);

  if (companyMatches(account, company)) {
    return {
      verdict: "VERIFIED",
      matchMethod: "COMPANY",
      matchScoreBp: overlapBp(account, company),
      matchedPerson: null,
      failureReason: null,
    };
  }

  type Candidate = { name: string; role: "DIRECTOR" | "SHAREHOLDER"; score: number };
  const candidates: Candidate[] = [];
  for (const person of cac.keyPersonnel) {
    const role = isEligiblePerson(person);
    if (!role) continue;
    const tokens = normalizeName(person.name);
    if (personMatches(account, tokens)) candidates.push({ name: person.name.trim(), role, score: overlapBp(account, tokens) });
  }
  candidates.sort((a, b) => b.score - a.score || (a.role === b.role ? 0 : a.role === "DIRECTOR" ? -1 : 1));
  const best = candidates[0];
  if (best) {
    return {
      verdict: "VERIFIED",
      matchMethod: "DIRECTOR",
      matchScoreBp: best.score,
      matchedPerson: `${best.name} (${best.role.toLowerCase()})`,
      failureReason: null,
    };
  }

  const bestScore = Math.max(
    overlapBp(account, company),
    ...cac.keyPersonnel.filter((p) => isEligiblePerson(p)).map((p) => overlapBp(account, normalizeName(p.name))),
  );
  return fail(
    `Payout account is in the name of ${accountName.trim().toUpperCase()}, which is not ${cac.registeredName.trim()} or any of its directors or shareholders.`,
    bestScore,
  );
}
