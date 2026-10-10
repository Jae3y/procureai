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
  /** What the vendor sells, space-separated; the sourcing step matches the buyer's item against these. */
  tags: string;
  city: string;
  /** How the vendor writes back (prices are a share of the buyer's own per-unit budget); null = never replies. */
  reply: (ask: DemoAsk) => string | null;
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

/** The three general merchants stock a bit of everything, so any request reaches them (and Vendor A/B/C stay stable). */
const GENERAL_TAGS =
  "general wholesale supplies merchants apparel clothing shirt tshirt uniform printing food drink grocery noodle rice provision office stationery electronic packaging building";

const naira = (n: bigint) => `N${withCommas(n)}`;
const pidgin = (percent: bigint) => (ask: DemoAsk) =>
  `oga good day, ${ask.quantity} ${ask.item.toLowerCase()} i fit supply am at ${demoUnitNaira(ask, percent)} each. 70% first, balance when e reach. 3 days.`;
const casual = (percent: bigint) => (ask: DemoAsk) =>
  `Hi, we can do ${ask.quantity} ${ask.item.toLowerCase()} at ${naira(demoUnitNaira(ask, percent))} per unit. Delivery within Lagos free, 50% upfront, ready in 4 days.`;
const formal = (percent: bigint) => (ask: DemoAsk) =>
  `Dear customer, thank you for your enquiry. For ${ask.quantity} ${ask.item.toLowerCase()} our unit price is ${naira(demoUnitNaira(ask, percent))}, inclusive of handling. 40% deposit, balance on delivery. Lead time 5 working days.`;
const declines = (ask: DemoAsk) => `Sorry boss, we no get ${ask.item.toLowerCase()} for that quantity now. Try us next week.`;
const silent = () => null;

const VALID = { rcNumber: "RC00000011", bankCode: "058", accountNumber: "0123456789" } as const;
const UNREGISTERED = { rcNumber: "RC11111111", bankCode: "058", accountNumber: "0123456789" } as const;
const mail = (name: string) => `${name}@example.com`;

/** The wider market: found by sourcing only when they sell what was asked. Kora's sandbox verifies its own test identities. */
const MARKET_VENDORS: readonly DemoVendor[] = [
  { businessName: "Mile 12 Bulk Provisions", phone: "+234 802 331 4410", tags: "food grocery provision noodle rice bean oil beverage drink carton bulk", city: "Lagos", reply: pidgin(88n), ...VALID, email: mail("mile12provisions") },
  { businessName: "Alaba Foods & Beverages Ltd", phone: "+234 805 207 9983", tags: "food beverage drink noodle carton wholesale", city: "Lagos", reply: formal(91n), ...VALID, email: mail("alabafoods") },
  { businessName: "Ariaria Traders Co-op", phone: "+234 703 118 6652", tags: "food grocery noodle provision apparel clothing shirt footwear", city: "Aba", reply: casual(86n), ...UNREGISTERED, email: mail("ariariatraders") },
  { businessName: "Kano Grain & Provisions", phone: "+234 806 540 2271", tags: "food rice bean grain noodle provision", city: "Kano", reply: silent, ...VALID, email: mail("kanograin") },
  { businessName: "Eko Fresh Distributors", phone: "+234 810 664 3905", tags: "food grocery noodle drink", city: "Lagos", reply: declines, ...VALID, email: mail("ekofresh") },
  { businessName: "Balogun Garments Hub", phone: "+234 807 922 1146", tags: "apparel clothing shirt tshirt uniform", city: "Lagos", reply: casual(87n), ...VALID, email: mail("balogungarments") },
  { businessName: "Yaba Print & Merch", phone: "+234 809 455 7728", tags: "printing branded shirt tshirt cap merch", city: "Lagos", reply: formal(92n), ...VALID, email: mail("yabaprint") },
  { businessName: "Onitsha Textile Mart", phone: "+234 704 389 0517", tags: "apparel fabric clothing shirt uniform", city: "Onitsha", reply: silent, ...VALID, email: mail("onitshatextile") },
  { businessName: "Abuja Office & Supplies", phone: "+234 813 276 4402", tags: "office stationery paper printing supplies", city: "Abuja", reply: pidgin(90n), ...VALID, email: mail("abujaoffice") },
  { businessName: "Computer Village Direct", phone: "+234 816 803 5519", tags: "electronic laptop phone accessory computer", city: "Lagos", reply: formal(93n), ...VALID, email: mail("computervillage") },
  { businessName: "Lekki Build Materials", phone: "+234 815 740 2236", tags: "building cement tile paint material", city: "Lagos", reply: casual(89n), ...VALID, email: mail("lekkibuild") },
  { businessName: "PackRight Nigeria", phone: "+234 802 651 8874", tags: "packaging carton box bag", city: "Ibadan", reply: formal(94n), ...VALID, email: mail("packright") },
];

const CORE_VENDORS: readonly DemoVendor[] = [
  {
    businessName: "Mama Tobi Trading",
    phone: "+234 803 412 7781",
    tags: GENERAL_TAGS,
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
    tags: GENERAL_TAGS,
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
    tags: GENERAL_TAGS,
    city: "Lagos",
    reply: (ask) =>
      `Good afternoon. Our price is N${withCommas(demoUnitNaira(ask, 90n))} per unit. 50% deposit to commence. Lead time 7 working days. Delivery within Lagos is free.`,
    rcNumber: "RC00000011",
    bankCode: "058",
    accountNumber: "0123456789",
    email: "sales@imolewholesale.example.com",
  },
];

/** Directory order matters: the general merchants come first (Vendor A, B, C); the wider market follows. */
export const DEMO_VENDORS: readonly DemoVendor[] = [...CORE_VENDORS, ...MARKET_VENDORS];
