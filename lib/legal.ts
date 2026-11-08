/**
 * The legal pages' facts in one place. The pages are working drafts until a Nigerian lawyer has
 * reviewed them; LEGAL_REVIEWED switches off the draft notice once that has happened.
 */
export const LEGAL_REVIEWED = false;
export const LEGAL_UPDATED = "7 November 2026";
export const SUPPORT_EMAIL = "hello@procureai.com.ng";

export type LegalSection = { heading: string; paragraphs: string[] };

export const TERMS: LegalSection[] = [
  {
    heading: "What ProcureAI is",
    paragraphs: [
      "ProcureAI helps a buyer get quotes from vendors, checks each vendor's business registration and bank account, and pays the chosen vendor in two stages: 30% once the buyer's money is held, and 70% on delivery.",
      "We are not a party to the sale. The contract for the goods is between the buyer and the vendor. We arrange the checks and the payments, and keep a record of both.",
    ],
  },
  {
    heading: "Who moves the money",
    paragraphs: [
      "Payments are collected and paid out by a payment processor licensed by the Central Bank of Nigeria; the privacy policy names it. Your transfer goes to an account the processor opens for that one purchase. We never hold your money in a ProcureAI bank account, and we never earn interest on it.",
      "The payment processor's own terms apply to the payment itself.",
    ],
  },
  {
    heading: "Your account",
    paragraphs: [
      "Keep your password to yourself. You are responsible for what is done with your account until you tell us it has been misused.",
      "Vendors must give true business details. We check them on every purchase a vendor is considered for, and we remove vendors who give false details.",
    ],
  },
  {
    heading: "Fees",
    paragraphs: ["ProcureAI is free while we run pilots. Before we charge anything, we will show the fee on the screen before you approve a purchase. Vendors cannot pay to be ranked higher."],
  },
  {
    heading: "What we are not responsible for",
    paragraphs: [
      "We check that a vendor is a registered business and that the payout account belongs to it. We do not inspect goods. Use the delivery code, the photos and the problem report to protect yourself, as described on the refunds page.",
      "The AI that reads quotes can make mistakes. Read the vendor's own words, which we always show next to our reading of them.",
    ],
  },
  {
    heading: "Contact",
    paragraphs: [`Write to ${SUPPORT_EMAIL}.`],
  },
];

export const PRIVACY: LegalSection[] = [
  {
    heading: "What we collect",
    paragraphs: [
      "Buyers: your name, email, what you ask to buy, and the messages and photos you add to an order.",
      "Vendors: business name, phone number, city, what you sell, CAC registration number, business bank account and email, your quotes, and the messages and photos you add to an order.",
      "From our payment processor: the results of business and bank account checks, and the status of every payment.",
    ],
  },
  {
    heading: "Why we use it",
    paragraphs: [
      "To run the purchase you asked for: send requests to vendors, check vendors, move the money, and keep a record both sides can rely on.",
      "To tell you when something needs you, in the app and, if email is turned on, by email. We do not send marketing, and we do not sell your data.",
    ],
  },
  {
    heading: "Who sees it",
    paragraphs: [
      "Our payment processor, Kora (Korapay), to verify businesses and move money. Our AI provider sees the text of requests and quotes to read them, never bank details. Our hosting and database providers store it.",
      "A buyer sees the business details of vendors who quote; a vendor sees the request and, once chosen, the buyer's messages. The shareable record shows what was bought and the payment trail, not bank account numbers.",
    ],
  },
  {
    heading: "How long we keep it",
    paragraphs: ["Payment records are kept for as long as Nigerian law requires. Everything else is deleted when you ask us to delete your account, unless we need it to settle a dispute that is still open."],
  },
  {
    heading: "Your rights",
    paragraphs: [
      "You can download everything we hold about you from your account page, correct it, or ask us to delete your account. These rights come from the Nigeria Data Protection Act 2023.",
      `Questions or complaints: ${SUPPORT_EMAIL}. You can also complain to the Nigeria Data Protection Commission.`,
    ],
  },
];

export const REFUNDS: LegalSection[] = [
  {
    heading: "How the money is protected",
    paragraphs: [
      "Your money is held by our licensed payment processor once you pay. The vendor gets 30% to start the order. The other 70% is released only when you enter the six-digit delivery code, or when the vendor marks the order delivered and you don't report a problem within the window shown on the order (72 hours unless stated otherwise).",
    ],
  },
  {
    heading: "If something goes wrong",
    paragraphs: [
      "Report a problem on the order page before Stage 2 is released. That stops the release. Both sides can add photos and notes, and a person at ProcureAI decides from that evidence.",
      "The decision can be to release Stage 2 to the vendor or to refund the held part to you. The 30% already paid to the vendor is a matter between you and the vendor.",
    ],
  },
  {
    heading: "Paying too much or too little",
    paragraphs: [
      "If your transfer is short, the order waits for the rest; nothing is paid out. If you send more than the amount due, the extra is returned to the account it came from.",
    ],
  },
  {
    heading: "How refunds reach you",
    paragraphs: [`Refunds go back to the bank account the payment came from, through our payment processor. If a refund hasn't arrived within five working days, write to ${SUPPORT_EMAIL} with your order number.`],
  },
];
