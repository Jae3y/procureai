import { z } from "zod";
import { CATEGORIES } from "@/lib/domain/listings";
import { decimalToKobo } from "@/lib/money";

/** "4,200", "₦4,200.50", "" → kobo or null. Anything else fails validation with a message the form can show. */
const naira = (label: string, required: boolean) =>
  z
    .string()
    .trim()
    .max(20)
    .transform((s, ctx) => {
      const clean = s.replace(/[₦\s]/g, "");
      if (!clean) {
        if (required) ctx.addIssue({ code: "custom", message: `Enter ${label}` });
        return null;
      }
      try {
        const kobo = decimalToKobo(clean);
        if (kobo <= 0n) throw new Error("not positive");
        if (kobo > 100_000_000_000n) throw new Error("too big");
        return kobo;
      } catch {
        ctx.addIssue({ code: "custom", message: `Enter ${label} in naira, e.g. 4,200` });
        return null;
      }
    });

export const ListingBody = z.object({
  title: z.string().trim().min(3, "Give it a name of at least 3 letters").max(100),
  description: z.string().trim().max(2000).default(""),
  category: z.enum(CATEGORIES, { error: "Choose a category" }),
  price: naira("a price", false),
  unit: z.string().trim().min(1, "Say what the price is for, e.g. piece, carton, bag").max(30),
  minOrder: z.coerce.number().int("Use a whole number").min(1, "At least 1").max(1_000_000),
  photo: z.object({ type: z.string().max(40), base64: z.string().min(1).max(1_000_000) }).nullish(),
  removePhoto: z.boolean().optional(),
});
export type ListingBodyT = z.output<typeof ListingBody>;

export const ListingRequestBody = z.object({
  quantity: z.coerce.number().int("Use a whole number").min(1, "At least 1").max(10_000_000),
  budget: naira("your budget", true),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  alsoAskOthers: z.boolean().default(true),
});
