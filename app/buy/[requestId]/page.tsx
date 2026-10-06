import { redirect } from "next/navigation";
import { RequestFlow } from "@/components/request-flow";
import { PageMessage } from "@/components/states";
import { db } from "@/lib/db";
import { initialsOf, pageCanSeeRequest, pageIsAdmin } from "@/lib/http/page-auth";
import { buildRequestView } from "@/lib/views/request-view";

export const dynamic = "force-dynamic";

export default async function RequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const access = await pageCanSeeRequest(requestId);
  if (access === "missing") return <PageMessage title="Request not found." body="This link doesn't match a purchase on ProcureAI." action={{ href: "/buy", label: "Start a purchase" }} />;
  if (access === "forbidden") return <PageMessage title="Not your request." body="Open ProcureAI on the device you started this purchase from." action={{ href: "/buy", label: "Start a purchase" }} />;

  const view = await buildRequestView(requestId, { includeInvites: await pageIsAdmin() });
  if (view.orderId) redirect(`/orders/${view.orderId}`);
  const buyer = await db().request.findUniqueOrThrow({ where: { id: requestId }, select: { buyer: { select: { name: true } } } });
  return <RequestFlow initial={view} initials={initialsOf(buyer.buyer.name)} />;
}
