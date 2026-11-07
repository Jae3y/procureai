import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { pageAccount } from "@/lib/http/page-auth";
import { PRIVACY } from "@/lib/legal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Privacy policy · ProcureAI" };

export default async function Page() {
  return <LegalPage title="Privacy policy" sections={PRIVACY} signedIn={Boolean(await pageAccount())} />;
}
