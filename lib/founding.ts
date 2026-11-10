import { db } from "@/lib/db";

/**
 * Founding Vendors: the first FOUNDING_VENDOR_LIMIT real businesses to register get a permanent badge.
 * It is recognition only. It never changes how a vendor is ranked or recommended: ranking stays
 * verification, price and fit, and no vendor can pay for position.
 */
export const FOUNDING_VENDOR_LIMIT = 100;

export async function foundingSpotsTaken(): Promise<number> {
  return db().vendorContact.count({ where: { foundingNumber: { not: null } } });
}

function isNumberRace(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message} ${(err as { code?: string }).code ?? ""}` : "";
  return text.includes("23505") || text.includes("P2002") || text.includes("foundingNumber");
}

/**
 * Gives a newly registered real business the next number, if any are left. One statement decides the
 * number and the cap together. Two businesses registering at the same instant can pick the same
 * number; the unique index refuses the second, which simply asks again.
 */
export async function claimFoundingSpot(contactId: string): Promise<number | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const rows = await db().$queryRaw<Array<{ foundingNumber: number }>>`
        UPDATE "VendorContact"
        SET "foundingNumber" = (SELECT COALESCE(MAX("foundingNumber"), 0) + 1 FROM "VendorContact")
        WHERE "id" = ${contactId}
          AND "foundingNumber" IS NULL
          AND "isDemo" = false
          AND "registeredAt" IS NOT NULL
          AND (SELECT COUNT("foundingNumber") FROM "VendorContact") < ${FOUNDING_VENDOR_LIMIT}
        RETURNING "foundingNumber"`;
      if (rows[0]) return rows[0].foundingNumber;
      const existing = await db().vendorContact.findUnique({ where: { id: contactId }, select: { foundingNumber: true } });
      return existing?.foundingNumber ?? null;
    } catch (err) {
      if (!isNumberRace(err) || attempt === 3) throw err;
    }
  }
  return null;
}
