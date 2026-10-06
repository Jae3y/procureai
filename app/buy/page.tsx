import { RequestComposer } from "@/components/request-composer";
import { env } from "@/lib/env";
import { pageBuyerId } from "@/lib/http/page-auth";

export const dynamic = "force-dynamic";

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ text?: string }> }) {
  const { text } = await searchParams;
  const buyerId = await pageBuyerId();
  return <RequestComposer needsBuyer={!buyerId && !env().DEMO_MODE} initialText={typeof text === "string" ? text.slice(0, 500) : ""} />;
}
