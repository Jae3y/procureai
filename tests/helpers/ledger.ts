import { expect } from "vitest";
import { db } from "@/lib/db";

/** Signed sum (debits +, credits −) of an order's ledger. Must be 0. */
export async function ledgerNet(orderId: string): Promise<bigint> {
  const rows = await db().ledgerEntry.findMany({ where: { orderId } });
  return rows.reduce((acc, r) => acc + (r.direction === "DEBIT" ? r.amountKobo : -r.amountKobo), 0n);
}

/** HELD balance = credits − debits on HELD. Never negative. */
export async function heldBalance(orderId: string): Promise<bigint> {
  const rows = await db().ledgerEntry.findMany({ where: { orderId, account: "HELD" } });
  return rows.reduce((acc, r) => acc + (r.direction === "CREDIT" ? r.amountKobo : -r.amountKobo), 0n);
}

export async function successfulPayouts(orderId: string): Promise<bigint> {
  const rows = await db().payout.findMany({ where: { orderId, status: "SUCCESS" } });
  return rows.reduce((acc, r) => acc + r.amountKobo, 0n);
}

export async function expectMoneyInvariants(orderId: string): Promise<void> {
  const order = await db().order.findUniqueOrThrow({ where: { id: orderId } });
  expect(await ledgerNet(orderId)).toBe(0n);
  expect((await heldBalance(orderId)) >= 0n).toBe(true);
  expect((await successfulPayouts(orderId)) <= order.amountAcceptedKobo).toBe(true);
}
