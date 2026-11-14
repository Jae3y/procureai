import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { NEW_SELLER_STAGE1_BP, STANDARD_STAGE1_BP, stage1ShareFor } from "@/lib/domain/approve";
import { approveLargePayout, dispatchStage, OWNER_APPROVAL_ABOVE_KOBO, SAFETY_HOLD_ABOVE_KOBO } from "@/lib/domain/payouts";
import { splitStages } from "@/lib/money";
import { fundOrder, makeOrderFixture, moveOrder } from "../helpers/factories";
import { useKoraDouble } from "../helpers/kora";

const double = useKoraDouble();
const user = { type: "USER" as const, id: "buyer-test" };
const NAIRA = 100n;

async function heldOrder(amountKobo: bigint, stage1Bp = STANDARD_STAGE1_BP) {
  const f = await makeOrderFixture({ amountKobo, stage1Bp });
  await fundOrder(f.order.id, amountKobo);
  double.availableKobo = amountKobo;
  return f;
}

describe("new sellers: smaller first payout until 3 completed orders", () => {
  it("a seller with no track record gets 10%; after 3 completed orders, 30%", async () => {
    const f = await makeOrderFixture();
    const contact = await db().vendorContact.create({ data: { businessName: "Track Record Ltd", phone: `+234 803 ${String(Date.now()).slice(-7, -4)} ${String(Date.now()).slice(-4)}`, category: "t-shirts", city: "Lagos" } });
    expect(await stage1ShareFor({ contactId: null })).toBe(NEW_SELLER_STAGE1_BP);
    expect(await stage1ShareFor({ contactId: contact.id })).toBe(NEW_SELLER_STAGE1_BP);
    // Three completed orders for this seller.
    for (let i = 0; i < 3; i++) {
      const o = await makeOrderFixture();
      await db().vendor.update({ where: { id: o.vendor.id }, data: { contactId: contact.id } });
      await moveOrder(o.order.id, ["AWAITING_PAYMENT", "HELD", "STAGE_1_PAID", "CODE_VERIFIED", "RELEASED", "COMPLETE"]);
    }
    expect(await stage1ShareFor({ contactId: contact.id })).toBe(STANDARD_STAGE1_BP);
    expect(f).toBeTruthy();
  });

  it("the first payout of a new seller's order is exactly 10%, and the second 90%", async () => {
    const amount = 1_000_000n * NAIRA;
    const f = await heldOrder(amount, NEW_SELLER_STAGE1_BP);
    await dispatchStage(f.order.id, "STAGE_1", user);
    const s1 = await db().payout.findMany({ where: { orderId: f.order.id, stage: "STAGE_1" } });
    expect(s1.reduce((a, p) => a + p.amountKobo, 0n)).toBe(100_000n * NAIRA);
    expect(splitStages(amount, NEW_SELLER_STAGE1_BP).stage2).toBe(900_000n * NAIRA);
  });

  it("the share can't be changed once the order exists", async () => {
    const f = await makeOrderFixture();
    await expect(db().order.update({ where: { id: f.order.id }, data: { stage1Bp: NEW_SELLER_STAGE1_BP } })).rejects.toThrow(/I1/);
  });
});

describe("large orders: a person checks before the first payout", () => {
  it("above ₦5M the first payout waits for the owner, and the owner is told once", async () => {
    const amount = OWNER_APPROVAL_ABOVE_KOBO + 100n * NAIRA;
    const f = await heldOrder(amount);
    const r1 = await dispatchStage(f.order.id, "STAGE_1", user);
    expect(r1).toMatchObject({ kind: "blocked", reason: "awaiting-owner-approval" });
    await dispatchStage(f.order.id, "STAGE_1", user);
    expect(await db().orderEvent.count({ where: { orderId: f.order.id, title: "Waiting for ProcureAI's approval" } })).toBe(1);
    expect(await db().payout.count({ where: { orderId: f.order.id } })).toBe(0);
    expect(double.callsTo("POST /transactions/disburse")).toBe(0);

    const r2 = await approveLargePayout(f.order.id, { type: "ADMIN", id: "owner" });
    expect(r2.kind).toBe("sent");
    expect((await db().order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("STAGE_1_PAID");
  });

  it("above ₦20M it also waits 24 hours after payment, even once approved", async () => {
    const amount = SAFETY_HOLD_ABOVE_KOBO + 100n * NAIRA;
    const f = await heldOrder(amount);
    const r = await approveLargePayout(f.order.id, { type: "ADMIN", id: "owner" });
    expect(r).toMatchObject({ kind: "blocked", reason: "safety-hold" });
    expect(double.callsTo("POST /transactions/disburse")).toBe(0);
    // A day later the background job's retry sends it.
    const tomorrow = new Date(Date.now() + 25 * 60 * 60 * 1000);
    expect((await dispatchStage(f.order.id, "STAGE_1", user, tomorrow)).kind).toBe("sent");
  });

  it("ordinary orders are not delayed", async () => {
    const f = await heldOrder(500_000n * NAIRA);
    expect((await dispatchStage(f.order.id, "STAGE_1", user)).kind).toBe("sent");
  });
});
