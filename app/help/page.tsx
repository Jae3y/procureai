import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site-shell";
import { env } from "@/lib/env";
import { pageAccount } from "@/lib/http/page-auth";
import { SUPPORT_EMAIL } from "@/lib/legal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Help · ProcureAI",
  description: "How paying, delivery, refunds and seller payouts work on ProcureAI, and how to reach us.",
};

interface Question {
  q: string;
  a: React.ReactNode;
}

/** Plain answers to the questions buyers and sellers ask most, and how to reach a person. Every answer describes what the product does today. */
export default async function HelpPage() {
  const signedIn = Boolean(await pageAccount());
  const graceHours = env().DELIVERY_GRACE_HOURS;

  const buying: Question[] = [
    {
      q: "How do I pay?",
      a: "After you approve a vendor, ProcureAI opens a bank account for that purchase only. Send the exact amount from any Nigerian bank app before the timer runs out. The account closes after one payment. If it closes before your money arrives, nothing is taken and a fresh account appears on your order page.",
    },
    {
      q: "I sent less than the amount shown.",
      a: "Your order page shows what has arrived and what is still due. Send the rest to the account shown there. Nothing goes to the vendor until the full amount is held.",
    },
    {
      q: "I sent more than the amount shown.",
      a: `Write to us with your order number. Anything you paid above the order total is returned to the account it came from.`,
    },
    {
      q: "When does the vendor get my money?",
      a: "Your money is held first. Once it is held, the vendor receives a first part (30%, or 10% for a seller new to ProcureAI) so they can start. The rest is paid only when delivery is confirmed.",
    },
    {
      q: "How is delivery confirmed?",
      a: `Your order page shows a 6-digit delivery code. Give it to the vendor only when you have what you ordered. If the vendor instead uploads proof of delivery, you have ${graceHours} hours to report a problem before the rest is paid.`,
    },
    {
      q: "Something is wrong with my order.",
      a: "Open the order and choose “Something’s wrong”. Payouts freeze straight away, both sides can add evidence, and a person at ProcureAI decides what happens to the money still held.",
    },
    {
      q: "How long does a refund take?",
      a: `Refunds go back to the bank account the payment came from. If one hasn't arrived within five working days, write to ${SUPPORT_EMAIL} with your order number.`,
    },
    {
      q: "How are vendors checked?",
      a: "Before you can pay a vendor, ProcureAI checks their business against Corporate Affairs Commission records and checks that their payout account belongs to the business or one of its directors. A seller without a CAC number is checked by their bank account instead: the name on it must match the name they gave us. A vendor that fails the checks can't be chosen.",
    },
  ];

  const selling: Question[] = [
    {
      q: "How do I start selling?",
      a: (
        <>
          Create an account, then add your business on the <Link href="/vendors/join">seller page</Link>: your business name, what you sell, your CAC number if you have one, and the bank account you want to be paid into.
        </>
      ),
    },
    {
      q: "When do I get paid?",
      a: "When the buyer's money is held, you receive the first part (30%, or 10% for your first three completed orders). You receive the rest once the buyer enters the delivery code, or once the waiting period after your proof of delivery passes without a complaint.",
    },
    {
      q: "Can I pay to appear higher?",
      a: "No. Buyers see vendors ranked by price, the checks and the order details, never by payment.",
    },
    {
      q: "Can I change my payout account?",
      a: "Yes, from your account page. You need two-step sign-in turned on, the change waits 24 hours before it takes effect, and we alert you, so nobody can quietly redirect your money.",
    },
  ];

  const account: Question[] = [
    {
      q: "I forgot my password.",
      a: (
        <>
          Use <Link href="/forgot">Forgot your password</Link> on the sign-in page. If you signed up with Google, choose Continue with Google instead.
        </>
      ),
    },
    {
      q: "How do I delete my account?",
      a: "Sign in, open Your account, then Settings, then Delete my account. Payment records are kept for as long as Nigerian law requires; everything else is deleted, unless it is needed to settle a dispute that is still open. You can also download everything we hold about you from the same page.",
    },
    {
      q: "How do I stop emails?",
      a: "Check-ins and tips can be switched off with the link at the bottom of those emails, or under Settings on your account page. Emails about your sign-ins, payments and orders always come, because they keep your account and money safe.",
    },
  ];

  return (
    <SiteShell signedIn={signedIn}>
      <article className="account-narrow legal">
        <h1 className="account-title">Help</h1>
        <section aria-labelledby="contact">
          <h2 id="contact">Talk to a person</h2>
          <p>
            Write to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. If it is about a purchase, include the order number (it starts with PA-) from the top of your
            order page, so we can find it straight away.
          </p>
        </section>
        <FaqGroup id="buying" title="Buying" items={buying} />
        <FaqGroup id="selling" title="Selling" items={selling} />
        <FaqGroup id="account" title="Your account" items={account} />
        <p className="note">
          The full rules are in the <Link href="/terms">terms</Link>, the <Link href="/privacy">privacy policy</Link> and{" "}
          <Link href="/refunds">refunds and disputes</Link>.
        </p>
      </article>
    </SiteShell>
  );
}

function FaqGroup({ id, title, items }: { id: string; title: string; items: Question[] }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {items.map((it) => (
        <details key={it.q} className="faq">
          <summary>{it.q}</summary>
          <p>{it.a}</p>
        </details>
      ))}
    </section>
  );
}
