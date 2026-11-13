import type { Metadata } from "next";
import { SiteShell } from "@/components/site-shell";
import { UnsubscribeButton } from "@/components/unsubscribe-button";
import { accountFromUnsubscribeToken } from "@/lib/notify/lifecycle";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Stop these emails · ProcureAI", robots: { index: false } };

/** The page asks first, so an email scanner that opens links can't unsubscribe anyone by accident. */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const valid = Boolean(accountFromUnsubscribeToken(t));
  return (
    <SiteShell signedIn={false}>
      <section className="account-wide" style={{ maxWidth: 560 }}>
        <h1 className="account-title">Stop these emails</h1>
        {valid && t ? (
          <>
            <p className="note">
              We&apos;ll stop sending you check-ins and tips. You&apos;ll still get the emails that keep your account and your orders safe, like sign-in alerts and payment updates.
            </p>
            <UnsubscribeButton token={t} />
          </>
        ) : (
          <p className="note">This link isn&apos;t valid any more. Reply to any of our emails and we&apos;ll stop them for you.</p>
        )}
      </section>
    </SiteShell>
  );
}
