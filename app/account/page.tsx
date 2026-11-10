import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountSettings, ConfirmEmailBanner, Notifications, Purchases, SecuritySettings, SignOutButton } from "@/components/account-dashboard";
import { SiteShell } from "@/components/site-shell";
import { env } from "@/lib/env";
import { pageAccount } from "@/lib/http/page-auth";
import { buildAccountView } from "@/lib/views/account-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your account · ProcureAI" };

export default async function AccountPage() {
  const account = await pageAccount();
  if (!account) redirect("/login?next=/account");
  const v = await buildAccountView(account);
  return (
    <SiteShell signedIn>
      <section className="account-wide">
        <div className="account-block-head">
          <h1 className="account-title">Hello, {v.name.split(" ")[0]}.</h1>
          <SignOutButton />
        </div>
        <ConfirmEmailBanner v={v} />
        {env().koraMode === "test" ? <p className="note">Kora test mode: purchases run end to end, but no real money moves yet.</p> : null}
        <p className="note">
          {v.isVendor ? <Link href="/vendor">Open your vendor dashboard</Link> : <>Do you sell? <Link href="/vendors/join">Register your business</Link> to receive buyers&apos; requests.</>}
        </p>
        <Notifications rows={v.notifications} />
        <Purchases rows={v.purchases} />
        <SecuritySettings v={v} />
        <AccountSettings v={v} />
      </section>
    </SiteShell>
  );
}
