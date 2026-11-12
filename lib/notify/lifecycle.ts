import { signSession, verifySession } from "@/lib/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import type { Account } from "@/lib/generated/prisma/client";
import { type Email, emailEnabled, sendEmail } from "./email";
import type { EmailContent } from "./email-template";

/**
 * Warm, rare, human emails. The rules, which are also the product promise:
 *  • Service-style notes (a welcome, a "did it all arrive well?" after a completed purchase) go to anyone with an account, once.
 *  • Everything else (the "hope you're doing well" note, the occasional tip) goes ONLY to people who ticked the box at sign-up.
 *  • Never more than one marketing email a week to a person, never a repeat of the same one, never at night (they go out in the
 *    daily 7 a.m. Lagos pass), and never to an account that has asked to be deleted or has unsubscribed.
 *  • Every one carries a one-click unsubscribe, which turns the box off at once.
 *  • At most MAX_PER_PASS a day, which also keeps us inside the email provider's free daily limit.
 */

export const MAX_PER_PASS = 40;
export const MARKETING_GAP_DAYS = 7;
const DAY = 86_400_000;

export type LifecycleKind = "welcome" | "checkin" | "hello" | "tip";
const MARKETING: readonly LifecycleKind[] = ["hello", "tip"];

export const TIPS: ReadonlyArray<{ heading: string; body: string[] }> = [
  {
    heading: "One thing that makes quotes better",
    body: [
      "The sellers who win orders on ProcureAI do one simple thing: they say what's included. Delivery, branding, a spare in case of a defect.",
      "If you're asking for quotes, naming what matters most to you (speed, price, a particular material) helps sellers give you a quote that fits, not a guess.",
    ],
  },
  {
    heading: "Buying in bulk? Ask for a smaller first order",
    body: [
      "If you've never bought from a seller before, a smaller first order is a sensible way to learn how they work, and sellers usually agree happily.",
      "Your money stays protected either way: 30% goes to the seller when your payment is confirmed, and 70% only when you confirm delivery.",
    ],
  },
  {
    heading: "The delivery code is yours to keep",
    body: [
      "When your order arrives, check it before you share the delivery code. The code is what releases the last 70% to the seller, so it's your say-so.",
      "If something isn't right, report a problem from your order page and the money stays held while we look at both sides.",
    ],
  },
];

export function unsubscribeUrl(accountId: string): string {
  return `${env().APP_BASE_URL}/unsubscribe?t=${encodeURIComponent(signSession("unsubscribe", accountId, 400 * 86_400))}`;
}

/** The account an unsubscribe link belongs to, or null if it was altered or is too old. */
export function accountFromUnsubscribeToken(token: string | null | undefined): string | null {
  return verifySession("unsubscribe", token ?? undefined);
}

function firstName(a: Pick<Account, "name">): string {
  return a.name.trim().split(/\s+/)[0] ?? "there";
}

type Draft = { kind: LifecycleKind; ref: string; subject: string; content: EmailContent };

function welcome(a: Account): Draft {
  const seller = a.intent === "SELL";
  const base = env().APP_BASE_URL;
  return {
    kind: "welcome",
    ref: "",
    subject: `Welcome to ProcureAI, ${firstName(a)}`,
    content: {
      heading: `Welcome, ${firstName(a)}`,
      paragraphs: seller
        ? [
            "We're really glad you're here. ProcureAI is built so good sellers get found and get paid properly: 30% when a buyer's payment is confirmed, and the rest when the goods arrive.",
            "The best first step is to add what you sell, with a clear photo and a price. It takes a few minutes, and it's free.",
          ]
        : [
            "We're really glad you're here. ProcureAI is built so buying from a seller you haven't met doesn't feel like a gamble: we check the seller, hold your money, and release it as the goods arrive.",
            "You can browse what sellers offer, or tell us what you need in one sentence and we'll ask sellers for quotes.",
          ],
      button: seller ? { label: "Add what you sell", url: `${base}/vendor` } : { label: "Browse the marketplace", url: `${base}/market` },
      footnote: "If you ever have a question, just reply to this email. A real person reads it.",
    },
  };
}

function checkin(a: Account, order: { id: string; number: number }, item: string): Draft {
  return {
    kind: "checkin",
    ref: order.id,
    subject: `Did your ${item} arrive well?`,
    content: {
      heading: "Hope everything arrived well",
      paragraphs: [
        `Hi ${firstName(a)}, your order for ${item} is complete, and we just wanted to check in. We hope it arrived the way you wanted.`,
        "If something wasn't right, tell us and we'll look into it. If it was great, a kind word to the seller goes a long way.",
      ],
      button: { label: "See your order", url: `${env().APP_BASE_URL}/orders/${order.id}` },
    },
  };
}

function hello(a: Account): Draft {
  return {
    kind: "hello",
    ref: "",
    subject: "Hope you're doing well",
    content: {
      heading: `Hi ${firstName(a)}, hope you're doing well`,
      paragraphs: [
        "It's been a little while, and we just wanted to say hello. We hope business and life are treating you kindly.",
        "Whenever you need something sourced or want to see what sellers have added lately, we're here. No rush, and nothing you need to do.",
      ],
      button: { label: "See what's new", url: `${env().APP_BASE_URL}/market` },
    },
  };
}

function tip(a: Account, month: string): Draft {
  const n = Number.parseInt(month.replace("-", ""), 10);
  const t = TIPS[n % TIPS.length] ?? TIPS[0]!;
  return { kind: "tip", ref: month, subject: t.heading, content: { heading: t.heading, paragraphs: [`Hi ${firstName(a)},`, ...t.body], button: { label: "Open ProcureAI", url: `${env().APP_BASE_URL}/market` } } };
}

/** Lagos is UTC+1 all year. */
function lagosHour(now: Date): number {
  return (now.getUTCHours() + 1) % 24;
}

/** Who is due what right now. Pure reads; sending and recording happen in runLifecycle. */
export async function dueLifecycleEmails(now = new Date()): Promise<Array<{ account: Account; draft: Draft }>> {
  const out: Array<{ account: Account; draft: Draft }> = [];
  const live = { deletionRequestedAt: null, emailsOffAt: null };
  const month = now.toISOString().slice(0, 7);

  // 1. Welcome: new accounts, an hour after sign-up and not after two weeks (a late welcome would feel odd).
  const fresh = await db().account.findMany({
    where: { ...live, createdAt: { lte: new Date(now.getTime() - 3_600_000), gte: new Date(now.getTime() - 14 * DAY) }, lifecycleEmails: { none: { kind: "welcome" } } },
    take: MAX_PER_PASS,
  });
  for (const account of fresh) out.push({ account, draft: welcome(account) });

  // 2. Check-in: three days after an order completes, to its buyer, once per order.
  const done = await db().order.findMany({
    where: { status: "COMPLETE", updatedAt: { lte: new Date(now.getTime() - 3 * DAY), gte: new Date(now.getTime() - 30 * DAY) } },
    take: MAX_PER_PASS,
    include: { request: { select: { buyerId: true, item: true } } },
  });
  for (const o of done) {
    const account = await db().account.findUnique({ where: { buyerId: o.request.buyerId } });
    if (!account || account.deletionRequestedAt || account.emailsOffAt) continue;
    const sent = await db().lifecycleEmail.findUnique({ where: { accountId_kind_ref: { accountId: account.id, kind: "checkin", ref: o.id } } });
    if (!sent) out.push({ account, draft: checkin(account, o, o.request.item) });
  }

  // 3 and 4. Marketing, only with consent, at most one a week, and never a repeat.
  const consented = await db().account.findMany({
    where: { ...live, marketingConsentAt: { not: null }, emailVerifiedAt: { not: null } },
    include: { lifecycleEmails: { where: { sentAt: { gte: new Date(now.getTime() - 60 * DAY) } } } },
    take: 500,
  });
  for (const account of consented) {
    const recent = account.lifecycleEmails;
    const lastMarketing = recent.filter((e) => MARKETING.includes(e.kind as LifecycleKind)).sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
    if (lastMarketing && now.getTime() - lastMarketing.sentAt.getTime() < MARKETING_GAP_DAYS * DAY) continue;
    const idle = !account.lastLoginAt || now.getTime() - account.lastLoginAt.getTime() > 60 * DAY;
    const oldEnough = now.getTime() - account.createdAt.getTime() > 14 * DAY;
    if (idle && oldEnough && !(await db().lifecycleEmail.findFirst({ where: { accountId: account.id, kind: "hello", sentAt: { gte: new Date(now.getTime() - 90 * DAY) } } }))) {
      out.push({ account, draft: hello(account) });
      continue;
    }
    // A tip at most once a month, and only to people who've been around a month.
    const tippedThisMonth = recent.some((e) => e.kind === "tip" && e.ref === month);
    const tippedLately = recent.some((e) => e.kind === "tip" && now.getTime() - e.sentAt.getTime() < 28 * DAY);
    if (!tippedThisMonth && !tippedLately && now.getTime() - account.createdAt.getTime() > 21 * DAY) out.push({ account, draft: tip(account, month) });
  }
  return out;
}

let lastPass = 0;

/** One daily pass: send what is due, record each so it can never repeat. Safe to call often; it self-limits. */
export async function runLifecycle(now = new Date(), opts: { force?: boolean } = {}): Promise<{ sent: number; skipped: number }> {
  if (!emailEnabled()) return { sent: 0, skipped: 0 };
  if (!opts.force) {
    const h = lagosHour(now);
    if (h < 7 || h >= 19) return { sent: 0, skipped: 0 }; // never at night
    if (now.getTime() - lastPass < 3_600_000) return { sent: 0, skipped: 0 };
  }
  lastPass = now.getTime();
  const due = await dueLifecycleEmails(now);
  let sent = 0;
  let skipped = 0;
  for (const { account, draft } of due.slice(0, MAX_PER_PASS)) {
    // Record first (the unique key is the lock), send second: a crash can cost one email, never send two.
    try {
      await db().lifecycleEmail.create({ data: { accountId: account.id, kind: draft.kind, ref: draft.ref } });
    } catch {
      skipped += 1;
      continue;
    }
    const mail: Email = { to: account.email, subject: draft.subject, content: { ...draft.content, unsubscribeUrl: unsubscribeUrl(account.id) } };
    if (await sendEmail(mail)) sent += 1;
    else {
      // Provider refused: free the slot so tomorrow's pass can try again.
      await db().lifecycleEmail.deleteMany({ where: { accountId: account.id, kind: draft.kind, ref: draft.ref } });
      skipped += 1;
    }
  }
  if (sent || skipped) log.info({ sent, skipped }, "lifecycle emails");
  return { sent, skipped };
}

/** Turns the marketing box off for this account. Returns false if the link isn't valid. */
export async function unsubscribe(token: string | null | undefined): Promise<boolean> {
  const id = accountFromUnsubscribeToken(token);
  if (!id) return false;
  await db().account.updateMany({ where: { id }, data: { marketingConsentAt: null, emailsOffAt: new Date() } });
  return true;
}
