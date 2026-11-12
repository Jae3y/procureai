import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { assertPayableInStages } from "@/lib/domain/approve";
import { dispatchStage, reconcilePayout, retryPayout, stage1IsPaid } from "@/lib/domain/payouts";
import { fundOrder, makeOrderFixture, moveOrder } from "../helpers/factories";
import { useKoraDouble } from "../helpers/kora";
import { expectMoneyInvariants } from "../helpers/ledger";

const double = useKoraDouble();
const user = { type: "USER" as const, id: "buyer-test" };
const poller = { type: "POLLER" as const, id: "t" };
const NAIRA = 100n;
const HUNDRED_MILLION = 100_000_000n * NAIRA;

async function heldOrder(amountKobo: bigint) {
  assertPayableInStages(amountKobo);
  const f = await makeOrderFixture({ amountKobo });
  await fundOrder(f.order.id, amountKobo);
  double.availableKobo = amountKobo; // the Kora wallet holds the buyer's money
  return f.order.id;
}

async function payoutsOf(orderId: string, stage: "STAGE_1" | "STAGE_2") {
  return db().payout.findMany({ where: { orderId, stage }, orderBy: [{ part: "asc" }, { attempt: "asc" }] });
}

describe("a NGN 100,000,000 order: each stage is paid in several transfers", () => {
  it("Stage 1 (30%) goes out as 3 transfers of NGN 10,000,000, Stage 2 (70%) as 7, and the order completes only after the last", async () => {
    const orderId = await heldOrder(HUNDRED_MILLION);
    const order = () => db().order.findUniqueOrThrow({ where: { id: orderId } });

    // Stage 1
    const r1 = await dispatchStage(orderId, "STAGE_1", user);
    expect(r1.kind).toBe("sent");
    const s1 = await payoutsOf(orderId, "STAGE_1");
    expect(s1.map((p) => p.part)).toEqual([1, 2, 3]);
    expect(s1.every((p) => p.amountKobo === 10_000_000n * NAIRA)).toBe(true);
    expect(s1.map((p) => p.reference)).toEqual([`PO-${orderId}-S1`, `PO-${orderId}-S1-P2`, `PO-${orderId}-S1-P3`]);
    expect(double.callsTo("POST /transactions/disburse")).toBe(3);
    expect((await order()).status).toBe("STAGE_1_PAID");

    // Two of three parts landed: the stage is NOT paid, so the vendor can't be told "delivered" yet.
    for (const p of s1.slice(0, 2)) await reconcilePayout(p.reference, poller);
    expect(await db().$transaction((tx) => stage1IsPaid(tx as never, orderId, HUNDRED_MILLION))).toBe(false);
    await reconcilePayout((s1[2] as { reference: string }).reference, poller);
    expect(await db().$transaction((tx) => stage1IsPaid(tx as never, orderId, HUNDRED_MILLION))).toBe(true);

    // Stage 2
    await moveOrder(orderId, ["CODE_VERIFIED"]);
    const r2 = await dispatchStage(orderId, "STAGE_2", user);
    expect(r2.kind).toBe("sent");
    const s2 = await payoutsOf(orderId, "STAGE_2");
    expect(s2).toHaveLength(7);
    expect(s2.reduce((a, p) => a + p.amountKobo, 0n)).toBe(70_000_000n * NAIRA);
    expect(s2.every((p) => p.amountKobo <= 10_000_000n * NAIRA)).toBe(true);
    expect((await order()).status).toBe("RELEASED");

    for (const p of s2.slice(0, 6)) await reconcilePayout(p.reference, poller);
    expect((await order()).status).toBe("RELEASED"); // six of seven parts is not complete
    await reconcilePayout((s2[6] as { reference: string }).reference, poller);
    expect((await order()).status).toBe("COMPLETE");
    await expectMoneyInvariants(orderId);
  });

  it("every transfer sent to Kora is within Kora's NGN 10,000,000 limit, and the total paid out is exactly the order", async () => {
    const orderId = await heldOrder(HUNDRED_MILLION);
    await dispatchStage(orderId, "STAGE_1", user);
    const sent = double.calls.filter((c) => c.path === "/transactions/disburse").map((c) => (c.body as { destination: { amount: number } }).destination.amount);
    expect(sent).toHaveLength(3);
    expect(Math.max(...sent)).toBeLessThanOrEqual(10_000_000);
    expect(sent.reduce((a, b) => a + b, 0)).toBe(30_000_000);
  });

  it("one failed part puts the order in PAYOUT_FAILED; a retry resends ONLY that part, under a new reference, and never pays the others twice", async () => {
    const orderId = await heldOrder(HUNDRED_MILLION);
    double.next("POST /transactions/disburse", { status: 400, body: { status: false, message: "Invalid account", data: null } }); // part 1 is refused
    const r = await dispatchStage(orderId, "STAGE_1", user);
    expect(r.kind).toBe("failed");
    const first = await payoutsOf(orderId, "STAGE_1");
    expect(first.map((p) => p.status)).toEqual(["FAILED", "PENDING", "PENDING"]);
    expect((await db().order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PAYOUT_FAILED");

    for (const p of first.slice(1)) await reconcilePayout(p.reference, poller); // parts 2 and 3 land

    const before = double.callsTo("POST /transactions/disburse");
    const retry = await retryPayout(orderId, user);
    expect(retry.kind).toBe("sent");
    expect(double.callsTo("POST /transactions/disburse") - before).toBe(1); // exactly one new transfer
    const all = await payoutsOf(orderId, "STAGE_1");
    const retried = all.find((p) => p.attempt === 2);
    expect(retried).toMatchObject({ part: 1, reference: `PO-${orderId}-S1-R2`, amountKobo: 10_000_000n * NAIRA });
    expect((await db().order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("STAGE_1_PAID");

    await reconcilePayout((retried as { reference: string }).reference, poller);
    expect(await db().$transaction((tx) => stage1IsPaid(tx as never, orderId, HUNDRED_MILLION))).toBe(true);
    const paid = (await payoutsOf(orderId, "STAGE_1")).filter((p) => p.status === "SUCCESS").reduce((a, p) => a + p.amountKobo, 0n);
    expect(paid).toBe(30_000_000n * NAIRA);
    await expectMoneyInvariants(orderId);
  });

  it("the database refuses a second live payout for the same part, but allows different parts", async () => {
    const orderId = await heldOrder(HUNDRED_MILLION);
    await dispatchStage(orderId, "STAGE_1", user);
    const one = (await payoutsOf(orderId, "STAGE_1"))[0];
    await expect(
      db().payout.create({
        data: {
          orderId,
          verificationId: one?.verificationId ?? "",
          stage: "STAGE_1",
          part: 1,
          reference: `dup-${orderId}`,
          amountKobo: 100n,
          route: one?.route ?? "SANDBOX_TEST_ACCOUNT",
          destinationBankCode: one?.destinationBankCode ?? "",
          destinationAccount: one?.destinationAccount ?? "",
        },
      }),
    ).rejects.toThrow(/I2_one_live_payout_per_stage_part|Unique constraint|I3/);
  });

  it("an ordinary order is still one transfer per stage, with the original references", async () => {
    const orderId = await heldOrder(126_000_000n);
    await dispatchStage(orderId, "STAGE_1", user);
    const s1 = await payoutsOf(orderId, "STAGE_1");
    expect(s1).toHaveLength(1);
    expect(s1[0]?.reference).toBe(`PO-${orderId}-S1`);
    expect(s1[0]?.part).toBe(1);
  });
});
