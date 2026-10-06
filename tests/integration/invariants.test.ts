import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db, transaction } from "@/lib/db";
import { allTransitions, IllegalTransitionError, lockOrder, transition } from "@/lib/domain/state";
import {
  fundOrder,
  insertPayout,
  makeOrderFixture,
  makeRequest,
  makeVendor,
  makeVerification,
  makeQuote,
  moveOrder,
  postPayIn,
} from "../helpers/factories";

/**
 * §2 invariants. Each test attacks the database directly — raw SQL or Prisma writes that skip the
 * domain services — and asserts Postgres refuses. Passing these is the P3-entry gate.
 */

describe("I1 — a payout never references a vendor whose latest verification is not VERIFIED", () => {
  it("rejects an order approved against a FAILED verification", async () => {
    const request = await makeRequest();
    const vendor = await makeVendor(request.id);
    const failed = await makeVerification(vendor.id, "FAILED");
    const quote = await makeQuote(request.id, vendor.id);
    await expect(
      db().order.create({
        data: { requestId: request.id, quoteId: quote.id, vendorId: vendor.id, verificationId: failed.id, amountKobo: 126_000_000n },
      }),
    ).rejects.toThrow(/I1:/);
  });

  it("rejects a payout once a newer FAILED verification supersedes the VERIFIED one", async () => {
    const { order, vendor, verification } = await makeOrderFixture();
    await fundOrder(order.id, order.amountKobo);
    // Bypass I4's freeze by writing a new verification row (the only legal way to change details).
    await makeVerification(vendor.id, "FAILED");
    await expect(
      transaction((tx) => insertPayout(tx, { orderId: order.id, verificationId: verification.id, stage: "STAGE_1", amountKobo: 37_800_000n })),
    ).rejects.toThrow(/I1:.*latest verification/);
  });

  it("rejects a payout whose destination is not the verified account", async () => {
    const { order, verification } = await makeOrderFixture();
    await fundOrder(order.id, order.amountKobo);
    await expect(
      transaction((tx) =>
        insertPayout(tx, { orderId: order.id, verificationId: verification.id, stage: "STAGE_1", amountKobo: 37_800_000n, bank: "044", account: "1111111111" }),
      ),
    ).rejects.toThrow(/I1: payout destination must be the verified account/);
  });

  it("only allows Kora's documented sandbox accounts on the sandbox route", async () => {
    const { order, verification } = await makeOrderFixture();
    await fundOrder(order.id, order.amountKobo);
    await expect(
      transaction((tx) =>
        insertPayout(tx, { orderId: order.id, verificationId: verification.id, stage: "STAGE_1", amountKobo: 37_800_000n, route: "SANDBOX_TEST_ACCOUNT", bank: "044", account: "1111111111" }),
      ),
    ).rejects.toThrow(/I1_sandbox_route_accounts/);
    const ok = await transaction((tx) =>
      insertPayout(tx, { orderId: order.id, verificationId: verification.id, stage: "STAGE_1", amountKobo: 37_800_000n, route: "SANDBOX_TEST_ACCOUNT", bank: "035", account: "0000000000" }),
    );
    expect(ok.route).toBe("SANDBOX_TEST_ACCOUNT");
  });

  it("rejects a payout that uses a different verification than the order was approved with", async () => {
    const { order, vendor } = await makeOrderFixture();
    await fundOrder(order.id, order.amountKobo);
    const newer = await makeVerification(vendor.id, "VERIFIED");
    await expect(
      transaction((tx) => insertPayout(tx, { orderId: order.id, verificationId: newer.id, stage: "STAGE_1", amountKobo: 37_800_000n })),
    ).rejects.toThrow(/I1: payout must use the verification the order was approved with/);
  });
});

describe("I2 — payout references are unique; one live payout per (order, stage)", () => {
  it("rejects a duplicate reference", async () => {
    const { order, verification } = await makeOrderFixture();
    await fundOrder(order.id, order.amountKobo);
    await transaction((tx) => insertPayout(tx, { orderId: order.id, verificationId: verification.id, stage: "STAGE_1", amountKobo: 1_000n, reference: "PO-dup-ref" }));
    await expect(
      transaction((tx) => insertPayout(tx, { orderId: order.id, verificationId: verification.id, stage: "STAGE_2", amountKobo: 1_000n, reference: "PO-dup-ref" })),
    ).rejects.toThrow(/Unique constraint|unique/i);
  });

  it("rejects a second live payout for the same stage, and allows it once the first FAILED", async () => {
    const { order, verification } = await makeOrderFixture();
    await fundOrder(order.id, order.amountKobo);
    const first = await transaction((tx) => insertPayout(tx, { orderId: order.id, verificationId: verification.id, stage: "STAGE_1", amountKobo: 37_800_000n }));
    await expect(
      transaction((tx) => insertPayout(tx, { orderId: order.id, verificationId: verification.id, stage: "STAGE_1", amountKobo: 37_800_000n })),
    ).rejects.toThrow(/I2_one_live_payout_per_stage|Unique constraint/i);
    await db().payout.update({ where: { id: first.id }, data: { status: "FAILED", koraResponse: { status: "failed" } } });
    const retry = await transaction((tx) =>
      insertPayout(tx, { orderId: order.id, verificationId: verification.id, stage: "STAGE_1", amountKobo: 37_800_000n, retryOfId: first.id, attempt: 2 }),
    );
    expect(retry.retryOfId).toBe(first.id);
  });
});

describe("I3 — successful payouts never exceed the accepted amount", () => {
  it("rejects a payout above what Kora accepted", async () => {
    const { order, verification } = await makeOrderFixture();
    await fundOrder(order.id, 100_000_000n); // underpaid: accepted ₦1,000,000 of ₦1,260,000
    await expect(
      transaction((tx) => insertPayout(tx, { orderId: order.id, verificationId: verification.id, stage: "STAGE_1", amountKobo: 100_000_001n })),
    ).rejects.toThrow(/I3:/);
  });

  it("rejects stage payouts that together exceed the accepted amount", async () => {
    const { order, verification } = await makeOrderFixture();
    await fundOrder(order.id, order.amountKobo);
    await transaction((tx) => insertPayout(tx, { orderId: order.id, verificationId: verification.id, stage: "STAGE_1", amountKobo: 37_800_000n }));
    await expect(
      transaction((tx) => insertPayout(tx, { orderId: order.id, verificationId: verification.id, stage: "STAGE_2", amountKobo: 88_200_001n })),
    ).rejects.toThrow(/I3:/);
  });

  it("rejects payouts on an order with nothing accepted, even when racing", async () => {
    const { order, verification } = await makeOrderFixture();
    await moveOrder(order.id, ["AWAITING_PAYMENT"]);
    const attempts = await Promise.allSettled(
      [1, 2, 3].map(() => transaction((tx) => insertPayout(tx, { orderId: order.id, verificationId: verification.id, stage: "STAGE_1", amountKobo: 1n }))),
    );
    expect(attempts.every((a) => a.status === "rejected")).toBe(true);
  });

  it("refuses to lower the accepted amount below committed payouts", async () => {
    const { order, verification } = await makeOrderFixture();
    await fundOrder(order.id, order.amountKobo);
    await transaction((tx) => insertPayout(tx, { orderId: order.id, verificationId: verification.id, stage: "STAGE_1", amountKobo: 37_800_000n }));
    await expect(db().order.update({ where: { id: order.id }, data: { amountAcceptedKobo: 1n } })).rejects.toThrow(/I3:/);
  });
});

describe("I4 — payout destinations and verified bank details are immutable", () => {
  it("rejects editing a verified vendor's bank details", async () => {
    const request = await makeRequest();
    const vendor = await makeVendor(request.id);
    await makeVerification(vendor.id, "VERIFIED");
    await expect(db().vendor.update({ where: { id: vendor.id }, data: { accountNumber: "9999999999" } })).rejects.toThrow(/I4:/);
    await expect(db().vendor.update({ where: { id: vendor.id }, data: { bankCode: "044" } })).rejects.toThrow(/I4:/);
  });

  it("allows editing details before verification", async () => {
    const request = await makeRequest();
    const vendor = await makeVendor(request.id);
    const updated = await db().vendor.update({ where: { id: vendor.id }, data: { accountNumber: "1234567890" } });
    expect(updated.accountNumber).toBe("1234567890");
  });

  it("rejects rewriting a verification row (corrections are new rows)", async () => {
    const request = await makeRequest();
    const vendor = await makeVendor(request.id);
    const v = await makeVerification(vendor.id, "VERIFIED");
    await expect(db().vendorVerification.update({ where: { id: v.id }, data: { accountNumber: "9999999999" } })).rejects.toThrow(/I4:/);
    await expect(db().vendorVerification.delete({ where: { id: v.id } })).rejects.toThrow(/I4:/);
  });

  it("rejects changing a payout's destination or amount after it is written", async () => {
    const { order, verification } = await makeOrderFixture();
    await fundOrder(order.id, order.amountKobo);
    const p = await transaction((tx) => insertPayout(tx, { orderId: order.id, verificationId: verification.id, stage: "STAGE_1", amountKobo: 37_800_000n }));
    await expect(db().payout.update({ where: { id: p.id }, data: { destinationAccount: "0000000000" } })).rejects.toThrow(/I4:/);
    await expect(db().payout.update({ where: { id: p.id }, data: { amountKobo: 1n } })).rejects.toThrow(/I4:/);
  });

  it("rejects moving a resolved payout to another status", async () => {
    const { order, verification } = await makeOrderFixture();
    await fundOrder(order.id, order.amountKobo);
    const p = await transaction((tx) => insertPayout(tx, { orderId: order.id, verificationId: verification.id, stage: "STAGE_1", amountKobo: 37_800_000n }));
    await db().payout.update({ where: { id: p.id }, data: { status: "SUCCESS", koraResponse: { status: "success" } } });
    await expect(db().payout.update({ where: { id: p.id }, data: { status: "FAILED" } })).rejects.toThrow(/already SUCCESS/);
  });
});

describe("I5 — order transitions follow the state machine", () => {
  it("rejects an illegal transition written straight to the table", async () => {
    const { order } = await makeOrderFixture();
    await expect(db().$executeRaw`UPDATE "Order" SET "status" = 'COMPLETE' WHERE "id" = ${order.id}`).rejects.toThrow(/I5: illegal order transition CREATED -> COMPLETE/);
  });

  it("rejects a legal transition that skips the audit (i.e. bypasses transition())", async () => {
    const { order } = await makeOrderFixture();
    await expect(db().order.update({ where: { id: order.id }, data: { status: "AWAITING_PAYMENT" } })).rejects.toThrow(/I5: .*no OrderTransition audit row/);
  });

  it("transition() throws IllegalTransitionError and rolls back", async () => {
    const { order } = await makeOrderFixture();
    await expect(
      transaction(async (tx) => {
        const o = await lockOrder(tx, order.id);
        const moved = await transition(tx, o, "AWAITING_PAYMENT", { type: "SYSTEM", id: "t" });
        await transition(tx, moved, "COMPLETE", { type: "SYSTEM", id: "t" });
      }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);
    const after = await db().order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("CREATED"); // the legal first step rolled back with the illegal second
    expect(await db().orderTransition.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("orders must be created in CREATED", async () => {
    const { request, vendor, verification, quote } = await makeOrderFixture();
    await expect(
      db().$executeRaw`INSERT INTO "Order" ("id","requestId","quoteId","vendorId","verificationId","amountKobo","status","updatedAt")
        VALUES ('o-bad', ${request.id + "x"}, ${quote.id}, ${vendor.id}, ${verification.id}, 100, 'HELD', now())`,
    ).rejects.toThrow(/I5: orders start in CREATED|violates/);
  });

  it("the DB rule table equals lib/domain/state.ts", async () => {
    const rows = await db().orderTransitionRule.findMany();
    const sql = rows.map((r) => `${r.fromState}->${r.toState}`).sort();
    const ts = allTransitions().map(([a, b]) => `${a}->${b}`).sort();
    expect(sql).toEqual(ts);
  });
});

describe("I6 — Kora events are unique on (type, reference, idempotency hash)", () => {
  it("rejects a second copy of the same event", async () => {
    const data = { type: "charge.success", reference: "PA-x", source: "WEBHOOK" as const, idempotencyHash: "h1", payload: { a: 1 } };
    await db().koraEvent.create({ data });
    await expect(db().koraEvent.create({ data })).rejects.toThrow(/Unique constraint|unique/i);
  });

  it("rejects rewriting what Kora sent", async () => {
    const e = await db().koraEvent.create({
      data: { type: "charge.success", reference: "PA-y", source: "WEBHOOK", idempotencyHash: "h2", payload: { a: 1 }, signatureValid: false },
    });
    await expect(db().koraEvent.update({ where: { id: e.id }, data: { signatureValid: true } })).rejects.toThrow(/I6:/);
    await expect(db().koraEvent.update({ where: { id: e.id }, data: { payload: { a: 2 } } })).rejects.toThrow(/I6:/);
    const processed = await db().koraEvent.update({ where: { id: e.id }, data: { processedAt: new Date() } });
    expect(processed.processedAt).not.toBeNull();
  });
});

describe("I7 — money is BIGINT kobo; no floats on the server", () => {
  it("rejects negative and zero money where money moves", async () => {
    const { order, verification } = await makeOrderFixture();
    await fundOrder(order.id, order.amountKobo);
    await expect(
      transaction((tx) => insertPayout(tx, { orderId: order.id, verificationId: verification.id, stage: "STAGE_1", amountKobo: 0n })),
    ).rejects.toThrow(/I7_payout_amount/);
    await expect(
      db().ledgerEntry.create({
        data: { orderId: order.id, account: "FEE", direction: "DEBIT", amountKobo: -5n, koraReference: "x", sourceType: "T", sourceId: "neg" },
      }),
    ).rejects.toThrow(/I7_ledger_amount/);
  });

  it("every money column is int8 (bigint)", async () => {
    const cols = await db().$queryRaw<Array<{ table_name: string; column_name: string; data_type: string }>>`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name ILIKE '%kobo%'`;
    expect(cols.length).toBeGreaterThan(10);
    for (const c of cols) expect(`${c.table_name}.${c.column_name}:${c.data_type}`).toMatch(/:bigint$/);
  });

  it("server code never parses money with floats", async () => {
    const offenders: string[] = [];
    const scan = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return [];
        throw e;
      });
      for (const entry of entries) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "generated") await scan(p);
        } else if (/\.tsx?$/.test(entry.name)) {
          // Comments may *warn against* float maths; only code counts.
          const src = (await readFile(p, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
          if (/parseFloat\(|\.toFixed\(|Number\([^)]*[Kk]obo|[Kk]obo\w*\s*\/\s*100(?!n)/.test(src)) offenders.push(p);
        }
      }
    };
    await scan(path.join(process.cwd(), "lib"));
    await scan(path.join(process.cwd(), "app"));
    expect(offenders).toEqual([]);
  });
});

describe("I8 — rows from Kora calls keep the reference and raw response", () => {
  it("rejects a VERIFIED verification without Kora references or raw responses", async () => {
    const request = await makeRequest();
    const vendor = await makeVendor(request.id);
    await expect(
      db().vendorVerification.create({
        data: {
          vendorId: vendor.id, rcNumber: "RC1", directors: [], bankCode: "058", accountNumber: "0123456789",
          matchMethod: "COMPANY", matchScoreBp: 10000, verdict: "VERIFIED", simulated: false,
          companyStatus: "ACTIVE", rawCac: { ok: true },
        },
      }),
    ).rejects.toThrow(/I8_verified_has_refs/);
  });

  it("rejects resolving a payout without storing Kora's response", async () => {
    const { order, verification } = await makeOrderFixture();
    await fundOrder(order.id, order.amountKobo);
    const p = await transaction((tx) => insertPayout(tx, { orderId: order.id, verificationId: verification.id, stage: "STAGE_1", amountKobo: 37_800_000n }));
    await expect(db().payout.update({ where: { id: p.id }, data: { status: "SUCCESS" } })).rejects.toThrow(/I8_payout_resolved_has_raw/);
  });
});

describe("Ledger — balanced per order, HELD never negative", () => {
  it("rejects an unbalanced posting at commit", async () => {
    const { order } = await makeOrderFixture();
    await expect(
      transaction(async (tx) => {
        await tx.ledgerEntry.create({
          data: { orderId: order.id, account: "BUYER_PAYIN", direction: "DEBIT", amountKobo: 100n, koraReference: "PA-1", sourceType: "PAYIN", sourceId: "p1" },
        });
      }),
    ).rejects.toThrow(/LEDGER: .*unbalanced/);
  });

  it("rejects a debit that would take HELD below zero", async () => {
    const { order } = await makeOrderFixture();
    await expect(
      transaction(async (tx) => {
        await tx.ledgerEntry.createMany({
          data: [
            { orderId: order.id, account: "HELD", direction: "DEBIT", amountKobo: 1n, koraReference: "PO-1", sourceType: "PAYOUT", sourceId: "x" },
            { orderId: order.id, account: "VENDOR_PAYOUT", direction: "CREDIT", amountKobo: 1n, koraReference: "PO-1", sourceType: "PAYOUT", sourceId: "x" },
          ],
        });
      }),
    ).rejects.toThrow(/LEDGER: HELD .* would go negative/);
  });

  it("accepts a balanced pay-in and is append-only", async () => {
    const { order } = await makeOrderFixture();
    await transaction((tx) => postPayIn(tx, order.id, "payin-1", "PA-1", 500n));
    const entry = await db().ledgerEntry.findFirstOrThrow({ where: { orderId: order.id } });
    await expect(db().ledgerEntry.update({ where: { id: entry.id }, data: { amountKobo: 1n } })).rejects.toThrow(/append-only/);
  });
});
