import { redirect } from "next/navigation";
import { RequestComposer } from "@/components/request-composer";
import { env } from "@/lib/env";
import { initialsOf, pageAccount } from "@/lib/http/page-auth";

export const dynamic = "force-dynamic";

/** Signed in: a real purchase. Not signed in: the demo if this deployment offers one, otherwise sign in. */
export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ text?: string }> }) {
  const { text } = await searchParams;
  const initialText = typeof text === "string" ? text.slice(0, 500) : "";
  const account = await pageAccount();
  if (!account && !env().DEMO_MODE) redirect(`/login?next=${encodeURIComponent(`/buy${initialText ? `?text=${encodeURIComponent(initialText)}` : ""}`)}`);
  return <RequestComposer mode={account ? "real" : "demo"} testMode={env().koraMode === "test"} initialText={initialText} initials={account ? initialsOf(account.name) : undefined} />;
}
