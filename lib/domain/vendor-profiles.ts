import { db } from "@/lib/db";
import { DomainError } from "./errors";

/**
 * Vendors who register on ProcureAI once. Their profile joins the directory that sourcing searches,
 * and their quotes reuse the saved business details, so a quote is just the reply in their own words.
 * Registration never replaces Kora: every vendor is still verified on every purchase they're chosen for.
 *
 * A profile can't be overwritten through this form (there are no logins yet, so a second sign-up with
 * the same phone could otherwise redirect someone else's payouts). Changing details goes through support.
 */

export type VendorRegistration = {
  businessName: string;
  phone: string;
  sells: string;
  city: string;
  rcNumber: string;
  bankCode: string;
  accountNumber: string;
  email: string;
  consent: boolean;
};

/** "08034127781", "2348034127781", "+234 803 412 7781" → "+234 803 412 7781". */
export function normalizeNigerianPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const local = digits.startsWith("234") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  if (!/^[789]\d{9}$/.test(local)) throw new DomainError("phone_invalid", "Use a Nigerian mobile number, e.g. 0803 412 7781.", 400);
  return `+234 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
}

export async function registerVendor(input: VendorRegistration): Promise<{ id: string; businessName: string }> {
  if (!input.consent) throw new DomainError("consent_required", "Tick the box to let ProcureAI check your business with Kora.", 400);
  const phone = normalizeNigerianPhone(input.phone);
  const profile = {
    businessName: input.businessName.trim(),
    category: input.sells.trim().toLowerCase().replace(/[,;/]+/g, " ").replace(/\s+/g, " "),
    city: input.city.trim(),
    rcNumber: input.rcNumber.trim().toUpperCase().replace(/\s+/g, ""),
    bankCode: input.bankCode.trim(),
    accountNumber: input.accountNumber.trim(),
    email: input.email.trim().toLowerCase(),
    registeredAt: new Date(),
  };
  const taken = () => new DomainError("already_registered", "This phone number is already registered on ProcureAI. To change your details, contact ProcureAI support.", 409);
  const existing = await db().vendorContact.findUnique({ where: { phone } });
  if (existing) {
    // Only an unregistered directory entry can be claimed, and only once (the WHERE makes two racing sign-ups converge).
    const { count } = await db().vendorContact.updateMany({ where: { id: existing.id, registeredAt: null }, data: profile });
    if (count === 0) throw taken();
    return { id: existing.id, businessName: profile.businessName };
  }
  try {
    const created = await db().vendorContact.create({ data: { ...profile, phone } });
    return { id: created.id, businessName: created.businessName };
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") throw taken();
    throw err;
  }
}
