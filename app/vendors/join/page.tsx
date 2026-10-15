import type { Metadata } from "next";
import { VendorJoin } from "@/components/vendor-join";
import { kora } from "@/lib/kora/client";
import { isKoraError } from "@/lib/kora/errors";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sell on ProcureAI" };

/** /vendors/join — a vendor registers once; from then on a quote is just the reply in their own words. */
export default async function VendorJoinPage() {
  let banks: Array<{ name: string; code: string }> = [];
  let banksError: string | null = null;
  try {
    const list = await kora().bankPickerList();
    banks = list.banks.map((b) => ({ name: b.name, code: b.code })).sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    if (!isKoraError(err)) throw err;
    log.warn({ err: err.message }, "could not load Kora's bank list for vendor registration");
    banksError = err.userMessage;
  }
  return <VendorJoin banks={banks} banksError={banksError} />;
}
