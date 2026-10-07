/**
 * The demo scenario from the brief (§12). Kora's sandbox only verifies its own test identities, so
 * Vendors B and C both use the documented valid test data (RC00000011 + 058/0123456789 → "John Doe
 * Inc", director MICHAEL DOE), and Vendor A uses the documented invalid RC (RC11111111). Business
 * names and phone numbers are the handoff's illustrative placeholders; ProcureAI never calls or
 * messages them.
 */

export const DEMO_BUYER = { name: "Tolu Adebayo", email: "tolu.adebayo@example.com" } as const;

export const DEMO_REQUEST_TEXT = "300 branded T-shirts, under ₦1.5m, delivered by 23 October";

/** What the buyer asked for; the scripted vendors answer *this*, whatever it is. */
export type DemoAsk = { item: string; quantity: number; budgetKobo: bigint };

export type DemoVendor = {
  businessName: string;
  phone: string;
  category: string;
  city: string;
  /** How the vendor writes back. Prices are a share of the buyer's own per-unit budget. */
  reply: (ask: DemoAsk) => string;
  rcNumber: string;
  bankCode: string;
  accountNumber: string;
  email: string;
};

/**
 * Whole-naira unit price at `percent` of the buyer's per-unit budget, rounded to the nearest ₦50
 * (never below ₦50). 78% / 84% / 90% reproduces the original T-shirt demo: ₦3,900 / ₦4,200 / ₦4,500
 * against ₦5,000 a shirt. All maths stays in bigint.
 */
export function demoUnitNaira(ask: DemoAsk, percent: bigint): bigint {
  const perUnit = ask.budgetKobo / 100n / BigInt(Math.max(1, ask.quantity));
  const raw = (perUnit * percent) / 100n;
  const rounded = ((raw + 25n) / 50n) * 50n;
  return rounded < 50n ? 50n : rounded;
}

function withCommas(n: bigint): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export const DEMO_VENDORS: readonly DemoVendor[] = [
  {
    businessName: "Mama Tobi Trading",
    phone: "+234 803 412 7781",
    category: "general supplies",
    city: "Lagos",
    reply: (ask) =>
      `boss good evening. ${ask.quantity} ${ask.item.toLowerCase()} i go do am ${demoUnitNaira(ask, 78n)} per one, na full payment before we start o. 2 days e don ready. i go deliver myself`,
    rcNumber: "RC11111111",
    bankCode: "058",
    accountNumber: "0123456789",
    email: "mamatobitrading@example.com",
  },
  {
    businessName: "Kwik Supplies",
    phone: "+234 816 090 2214",
    category: "general supplies",
    city: "Lagos",
    reply: (ask) => `I fit do am ${withCommas(demoUnitNaira(ask, 84n))} each, delivery na free for Lagos, 60% upfront, ready Thursday`,
    rcNumber: "RC00000011",
    bankCode: "058",
    accountNumber: "0123456789",
    email: "orders@kwiksupplies.example.com",
  },
  {
    businessName: "Imole Wholesale Ltd",
    phone: "+234 909 551 3046",
    category: "general supplies",
    city: "Lagos",
    reply: (ask) =>
      `Good afternoon. Our price is N${withCommas(demoUnitNaira(ask, 90n))} per unit. 50% deposit to commence. Lead time 7 working days. Delivery within Lagos is free.`,
    rcNumber: "RC00000011",
    bankCode: "058",
    accountNumber: "0123456789",
    email: "sales@imolewholesale.example.com",
  },
];
