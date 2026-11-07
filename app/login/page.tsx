import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth-forms";
import { SiteShell } from "@/components/site-shell";
import { pageAccount } from "@/lib/http/page-auth";
import { safeNext } from "@/lib/http/next-path";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in · ProcureAI" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await pageAccount()) redirect(next);
  return (
    <SiteShell signedIn={false}>
      <LoginForm next={next} />
    </SiteShell>
  );
}
