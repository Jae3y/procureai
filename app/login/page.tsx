import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth-forms";
import { SiteShell } from "@/components/site-shell";
import { googleEnabled } from "@/lib/auth/google";
import { pageAccount } from "@/lib/http/page-auth";
import { safeNext } from "@/lib/http/next-path";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in · ProcureAI" };

const ERRORS: Record<string, string> = {
  google_off: "Signing in with Google isn't available yet. Use your email and password.",
  google_cancelled: "Google sign-in was cancelled.",
  google_expired: "That Google sign-in took too long or was opened in another browser. Try again.",
  google_failed: "Google sign-in didn't work. Try again, or use your email and password.",
  google_mismatch: "This email is already linked to a different Google account. Sign in with that one, or with your password.",
  too_many: "Too many attempts. Wait a few minutes and try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; step?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await pageAccount()) redirect(next);
  return (
    <SiteShell signedIn={false}>
      <LoginForm next={next} google={googleEnabled()} error={sp.error ? (ERRORS[sp.error] ?? null) : null} startAtCode={sp.step === "code"} />
    </SiteShell>
  );
}
