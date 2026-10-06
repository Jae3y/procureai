/**
 * The demo scenario from the brief (§12). Kora's sandbox only verifies its own test identities, so
 * Vendors B and C both use the documented valid test data (RC00000011 + 058/0123456789 → "John Doe
 * Inc", director MICHAEL DOE), and Vendor A uses the documented invalid RC (RC11111111). Business
 * names and phone numbers are the handoff's illustrative placeholders; ProcureAI never calls or
 * messages them.
 */

export const DEMO_BUYER = { name: "Tolu Adebayo", email: "tolu.adebayo@example.com" } as const;

export const DEMO_REQUEST_TEXT = "300 branded T-shirts, under ₦1.5m, delivered by 23 October";

export type DemoVendor = {
  businessName: string;
  phone: string;
  category: string;
  city: string;
  reply: string;
  rcNumber: string;
  bankCode: string;
  accountNumber: string;
  email: string;
};

export const DEMO_VENDORS: readonly DemoVendor[] = [
  {
    businessName: "Mama Tobi Prints",
    phone: "+234 803 412 7781",
    category: "apparel",
    city: "Lagos",
    reply: "boss good evening. 300 pcs i go do am 3900 per one, na full payment before we start o. 2 days e don ready. i go deliver myself",
    rcNumber: "RC11111111",
    bankCode: "058",
    accountNumber: "0123456789",
    email: "mamatobiprints@example.com",
  },
  {
    businessName: "Kwik Threads",
    phone: "+234 816 090 2214",
    category: "apparel",
    city: "Lagos",
    reply: "I fit do am 4,200 each, delivery na free for Lagos, 60% upfront, ready Thursday",
    rcNumber: "RC00000011",
    bankCode: "058",
    accountNumber: "0123456789",
    email: "orders@kwikthreads.example.com",
  },
  {
    businessName: "Imole Apparel Ltd",
    phone: "+234 909 551 3046",
    category: "apparel",
    city: "Lagos",
    reply:
      "Good afternoon. Our price is N4,500 per unit inclusive of 2-colour print. 50% deposit to commence. Lead time 7 working days. Delivery within Lagos is free.",
    rcNumber: "RC00000011",
    bankCode: "058",
    accountNumber: "0123456789",
    email: "sales@imoleapparel.example.com",
  },
];
