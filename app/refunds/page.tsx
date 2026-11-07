import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { pageAccount } from "@/lib/http/page-auth";
import { REFUNDS } from "@/lib/legal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Refunds and disputes · ProcureAI" };

export default async function Page() {
  return <LegalPage title="Refunds and disputes" sections={REFUNDS} signedIn={Boolean(await pageAccount())} />;
}
