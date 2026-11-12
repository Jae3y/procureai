import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notifications, SignOutButton, VendorInvitations, VendorProfileForm } from "@/components/account-dashboard";
import { ListingsManager } from "@/components/marketplace";
import { SiteShell } from "@/components/site-shell";
import { CATEGORIES } from "@/lib/domain/listings";
import { pageAccount } from "@/lib/http/page-auth";
import { isProviderError, payments } from "@/lib/payments";
import { log } from "@/lib/log";
import { buildVendorDashboard } from "@/lib/views/account-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Vendor dashboard · ProcureAI" };

export default async function VendorDashboardPage() {
  const account = await pageAccount();
  if (!account) redirect("/login?next=/vendor");
  const contactId = account.vendorContactId;
  if (!contactId) redirect("/vendors/join");
  const v = await buildVendorDashboard({ ...account, vendorContactId: contactId });
  let banks: Array<{ name: string; code: string }> = [];
  let banksError: string | null = null;
  try {
    const list = await payments().banks();
    banks = [...list.banks].sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    if (!isProviderError(err)) throw err;
    log.warn({ err: err.message }, "vendor dashboard: Kora bank list unavailable");
    banksError = err.userMessage;
  }
  return (
    <SiteShell signedIn>
      <section className="account-wide">
        <div className="account-block-head">
          <h1 className="account-title">{v.profile.businessName}</h1>
          {v.profile.foundingNumber ? <span className="founding-badge">Founding vendor #{v.profile.foundingNumber}</span> : null}
          <SignOutButton />
        </div>
        <p className="note">
          You&apos;re paid through ProcureAI: 30% when the buyer&apos;s money is held, 70% on delivery. <Link href="/account">Your buyer account</Link>
        </p>
        <Notifications rows={v.notifications} />
        <VendorInvitations v={v} />
        <ListingsManager listings={v.listings} categories={CATEGORIES} />
        <VendorProfileForm profile={v.profile} pendingBank={v.pendingBank} twoStepOn={v.twoStepOn} banks={banks} banksError={banksError} />
      </section>
    </SiteShell>
  );
}
