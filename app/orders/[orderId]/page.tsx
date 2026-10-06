import { OrderFlow } from "@/components/order-flow";
import { PageMessage } from "@/components/states";
import { db } from "@/lib/db";
import { initialsOf, pageCanSeeOrder, pageIsAdmin } from "@/lib/http/page-auth";
import { buildOrderView } from "@/lib/views/order-view";

export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const access = await pageCanSeeOrder(orderId);
  if (access === "missing") return <PageMessage title="Order not found." body="This link doesn't match an order on ProcureAI." action={{ href: "/buy", label: "Start a purchase" }} />;
  if (access === "forbidden") return <PageMessage title="Not your order." body="Open ProcureAI on the device you made this purchase from." />;
  const view = await buildOrderView(orderId, (await pageIsAdmin()) ? "admin" : "buyer");
  const buyer = await db().order.findUniqueOrThrow({ where: { id: orderId }, select: { request: { select: { buyer: { select: { name: true } } } } } });
  return <OrderFlow initial={view} initials={initialsOf(buyer.request.buyer.name)} />;
}
