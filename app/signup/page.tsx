import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth-forms";
import { SiteShell } from "@/components/site-shell";
import { googleEnabled } from "@/lib/auth/google";
import { turnstileEnabled } from "@/lib/auth/turnstile";
import { env } from "@/lib/env";
import { pageAccount } from "@/lib/http/page-auth";
import { safeNext } from "@/lib/http/next-path";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create an account · ProcureAI" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await pageAccount()) redirect(next);
  return (
    <SiteShell signedIn={false}>
      <SignupForm next={next} google={googleEnabled()} turnstileSiteKey={turnstileEnabled() ? env().TURNSTILE_SITE_KEY : ""} />
    </SiteShell>
  );
}
