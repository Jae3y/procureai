import type { Metadata } from "next";
import { PageMessage } from "@/components/states";
import { verifyEmail } from "@/lib/domain/accounts";
import { DomainError } from "@/lib/domain/errors";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm your email · ProcureAI" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (typeof token !== "string" || token.length < 20) {
    return <PageMessage title="This link isn't complete." body="Open the link from the email again." action={{ href: "/account", label: "Go to your account" }} />;
  }
  try {
    await verifyEmail(token);
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    return <PageMessage title="This link has expired." body={err.userMessage} action={{ href: "/account", label: "Go to your account" }} />;
  }
  return <PageMessage title="Email confirmed." body="Thanks. Receipts and alerts will reach you there." action={{ href: "/account", label: "Go to your account" }} />;
}
