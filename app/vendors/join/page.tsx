import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { VendorJoin } from "@/components/vendor-join";
import { pageAccount } from "@/lib/http/page-auth";
import { isProviderError, payments } from "@/lib/payments";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sell on ProcureAI" };

/** /vendors/join — a vendor registers once; from then on a quote is just the reply in their own words. */
export default async function VendorJoinPage() {
  const account = await pageAccount();
  if (account?.vendorContactId) redirect("/vendor");
  let banks: Array<{ name: string; code: string }> = [];
  let banksError: string | null = null;
  try {
    const list = await payments().banks();
    banks = [...list.banks].sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    if (!isProviderError(err)) throw err;
    log.warn({ err: err.message }, "could not load Kora's bank list for vendor registration");
    banksError = err.userMessage;
  }
  return <VendorJoin banks={banks} banksError={banksError} signedInEmail={account?.email ?? null} />;
}
