import { db } from "@/lib/db";
import { DEMO_VENDORS } from "./script";

/**
 * Makes the vendor directory exactly the three demo vendors (upsert by phone). Used by `npm run
 * demo:reset` and, in demo mode, by the first invite on an empty database, so a fresh deployment
 * works without anyone running a seed command against it.
 */
export async function ensureDemoDirectory(): Promise<void> {
  for (const v of DEMO_VENDORS) {
    // Demo vendors are registered on ProcureAI (their quotes reuse these details) except the ones marked otherwise.
    // Registration never skips Kora: every chosen vendor is still checked on every purchase.
    const profile = v.notOnProcureAI
      ? { registeredAt: null, rcNumber: null, bankCode: null, accountNumber: null, email: null }
      : { registeredAt: new Date("2026-10-01T09:00:00Z"), rcNumber: v.rcNumber, bankCode: v.bankCode, accountNumber: v.accountNumber, email: v.email };
    await db().vendorContact.upsert({
      where: { phone: v.phone },
      create: { businessName: v.businessName, phone: v.phone, category: v.tags, city: v.city, ...profile },
      update: { businessName: v.businessName, category: v.tags, city: v.city, ...profile },
    });
  }
}
