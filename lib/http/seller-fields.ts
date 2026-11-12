import { z } from "zod";

export const RC_PATTERN = /^(RC|BN|IT|LP|LLP)?\s?\d{4,10}$/i;

/** A CAC number is optional: plenty of good sellers are not registered. Left empty, the name on the bank account is needed instead. */
export const optionalRcNumber = z
  .string()
  .trim()
  .max(20)
  .refine((s) => s === "" || RC_PATTERN.test(s), "Use your CAC registration number, e.g. RC1482093, or leave it empty")
  .optional();

export const ownerNameField = z.string().trim().max(120).optional();

type Issuer = { addIssue: (issue: { code: "custom"; path: (string | number)[]; message: string }) => void };

/** Without a CAC number there is nothing to check the bank account against but the seller's own name, so ask for it (two words at least). */
export function requireOwnerNameWithoutRc(v: { rcNumber?: string | undefined; ownerName?: string | undefined }, ctx: Issuer): void {
  if (v.rcNumber && v.rcNumber.trim() !== "") return;
  const words = (v.ownerName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) ctx.addIssue({ code: "custom", path: ["ownerName"], message: "Enter your full name as it appears on your bank account" });
}
