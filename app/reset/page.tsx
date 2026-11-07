import type { Metadata } from "next";
import { ResetForm } from "@/components/auth-forms";
import { SiteShell } from "@/components/site-shell";
import { PageMessage } from "@/components/states";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Choose a new password · ProcureAI" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (typeof token !== "string" || token.length < 20) {
    return <PageMessage title="This link isn't complete." body="Open the link from the email again, or ask for a new one." action={{ href: "/forgot", label: "Ask for a new link" }} />;
  }
  return (
    <SiteShell signedIn={false}>
      <ResetForm token={token} />
    </SiteShell>
  );
}
