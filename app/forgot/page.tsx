import type { Metadata } from "next";
import { ForgotForm } from "@/components/auth-forms";
import { SiteShell } from "@/components/site-shell";
import { SUPPORT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = { title: "Reset your password · ProcureAI" };

export default function ForgotPage() {
  return (
    <SiteShell signedIn={false}>
      <ForgotForm support={SUPPORT_EMAIL} />
    </SiteShell>
  );
}
