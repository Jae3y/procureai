import { describe, expect, it } from "vitest";
import { type CacOutcome, matchVendor, normalizeName } from "@/lib/domain/matching";
import cacFixture from "@/lib/kora/fixtures/documented/cac-RC00000011.json";

/** Kora's documented sandbox response for RC00000011 ("John Doe Inc", director MICHAEL DOE). */
const johnDoeInc: CacOutcome = {
  found: true,
  registeredName: cacFixture.body.data.name,
  companyStatus: cacFixture.body.data.company_status,
  keyPersonnel: cacFixture.body.data.key_personnel,
};

describe("normalizeName", () => {
  it.each([
    ["John Doe Inc", ["JOHN", "DOE"]],
    ["KWIK THREADS GARMENTS LIMITED", ["KWIK", "THREADS", "GARMENTS"]],
    ["Imole Apparel Ltd.", ["IMOLE", "APPAREL"]],
    ["A & B Ventures Nig. Ltd", ["A", "B"]],
    ["  mama   tobi, prints  ", ["MAMA", "TOBI", "PRINTS"]],
    ["Ọlá Enterprises NIGERIA PLC", ["ỌLÁ"]],
    ["Ltd", []],
  ])("%s → %j", (input, tokens) => {
    expect(normalizeName(input)).toEqual(tokens);
  });
});

describe("matching rule — required cases (§7A)", () => {
  it("'John Doe Inc' + 'MICHAEL JOHN DOE' (director MICHAEL DOE) → VERIFIED via DIRECTOR", () => {
    const r = matchVendor(johnDoeInc, "MICHAEL JOHN DOE");
    expect(r.verdict).toBe("VERIFIED");
    expect(r.matchMethod).toBe("DIRECTOR");
    expect(r.matchedPerson).toBe("MICHAEL DOE (director)");
    expect(r.matchScoreBp).toBe(6666); // {MICHAEL, DOE} ∩ {MICHAEL, JOHN, DOE} = 2 of 3
  });

  it("'John Doe Inc' + 'JOHN DOE INC' → VERIFIED via COMPANY", () => {
    const r = matchVendor(johnDoeInc, "JOHN DOE INC");
    expect(r.verdict).toBe("VERIFIED");
    expect(r.matchMethod).toBe("COMPANY");
    expect(r.matchScoreBp).toBe(10_000);
  });

  it("'John Doe Inc' + 'CHIDERA OKEKE' → FAILED with a readable reason", () => {
    const r = matchVendor(johnDoeInc, "CHIDERA OKEKE");
    expect(r.verdict).toBe("FAILED");
    expect(r.matchMethod).toBe("NONE");
    expect(r.failureReason).toBe(
      "Payout account is in the name of CHIDERA OKEKE, which is not John Doe Inc or any of its directors or shareholders.",
    );
  });

  it.each(["INACTIVE", "STRUCK OFF", "", null])("company_status %j → FAILED regardless of name", (status) => {
    const r = matchVendor({ ...johnDoeInc, companyStatus: status }, "JOHN DOE INC");
    expect(r.verdict).toBe("FAILED");
    expect(r.failureReason).toMatch(/not active/);
  });

  it("RC11111111 (invalid company) → FAILED", () => {
    const r = matchVendor({ found: false, reason: "Company registration could not be verified." }, "ANY NAME");
    expect(r.verdict).toBe("FAILED");
    expect(r.failureReason).toBe("Company registration could not be verified.");
  });
});

describe("matching rule — edges", () => {
  it("is order-insensitive and ignores punctuation and legal suffixes", () => {
    expect(matchVendor(johnDoeInc, "Doe, John (Inc.)").matchMethod).toBe("COMPANY");
    expect(matchVendor(johnDoeInc, "DOE MICHAEL").matchMethod).toBe("DIRECTOR");
  });

  it("does not let a personal account that merely contains the company name pass as the company", () => {
    const acme: CacOutcome = { found: true, registeredName: "Acme Ltd", companyStatus: "ACTIVE", keyPersonnel: [] };
    expect(matchVendor(acme, "ACME").matchMethod).toBe("COMPANY");
    const r = matchVendor({ ...johnDoeInc, keyPersonnel: [] }, "PETER JOHN DOE");
    expect(r.verdict).toBe("FAILED");
  });

  it("ignores witnesses, secretaries, and resigned directors", () => {
    expect(matchVendor(johnDoeInc, "PETER DOE").verdict).toBe("FAILED"); // WITNESS
    expect(matchVendor(johnDoeInc, "SUSAN DOE").verdict).toBe("FAILED"); // SECRETARY_COMPANY
    const resigned: CacOutcome = {
      found: true,
      registeredName: "Kwik Threads Garments Limited",
      companyStatus: "ACTIVE",
      keyPersonnel: [{ name: "Ada Obi", designation: "DIRECTOR", status: "RESIGNED" }],
    };
    expect(matchVendor(resigned, "ADA OBI").verdict).toBe("FAILED");
  });

  it("accepts shareholders and multi-word designations", () => {
    expect(matchVendor(johnDoeInc, "JOHN DOE").matchMethod).toBe("COMPANY"); // also shareholder JOHN DOE; company wins
    const md: CacOutcome = {
      found: true,
      registeredName: "Kwik Threads Garments Limited",
      companyStatus: "ACTIVE",
      keyPersonnel: [{ name: "Chinedu Okafor", designation: "MANAGING DIRECTOR" }],
    };
    expect(matchVendor(md, "OKAFOR CHINEDU EMEKA").matchMethod).toBe("DIRECTOR");
  });

  it("never verifies on a single shared token", () => {
    expect(matchVendor(johnDoeInc, "DOE").verdict).toBe("FAILED");
  });

  it("reports when Kora could not resolve the account name", () => {
    expect(matchVendor(johnDoeInc, null).failureReason).toMatch(/could not resolve/);
  });
});
