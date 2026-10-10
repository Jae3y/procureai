import { db } from "@/lib/db";
import { DEMO_VENDORS } from "./script";

/**
 * Makes the vendor directory exactly the three demo vendors (upsert by phone). Used by `npm run
 * demo:reset` and, in demo mode, by the first invite on an empty database, so a fresh deployment
 * works without anyone running a seed command against it.
 */
export async function ensureDemoDirectory(): Promise<void> {
  for (const v of DEMO_VENDORS) {
    await db().vendorContact.upsert({
      where: { phone: v.phone },
      create: { businessName: v.businessName, phone: v.phone, category: v.tags, city: v.city },
      update: { businessName: v.businessName, category: v.tags, city: v.city },
    });
  }
}
