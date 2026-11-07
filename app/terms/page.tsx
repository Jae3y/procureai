import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { pageAccount } from "@/lib/http/page-auth";
import { TERMS } from "@/lib/legal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Terms of use · ProcureAI" };

export default async function Page() {
  return <LegalPage title="Terms of use" sections={TERMS} signedIn={Boolean(await pageAccount())} />;
}
