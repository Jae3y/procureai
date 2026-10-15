import { db } from "@/lib/db";
import { MESSAGE_MAX_CHARS } from "@/lib/domain/messages";
import { NotFoundError } from "@/lib/domain/errors";
import { lagosDay, lagosTime } from "./format";

export type Viewer = "buyer" | "vendor" | "admin";

export type ThreadMessage = {
  id: string;
  from: "buyer" | "vendor";
  /** "You", or the other party's name. */
  who: string;
  text: string;
  when: string;
  mine: boolean;
};

/** The order's message thread as `viewer` sees it. `with` names the other party. */
export type Thread = { messages: ThreadMessage[]; maxChars: number; with: string };

/** With `afterId`, only messages newer than it (what the 3-second poll asks for). */
export async function buildThreadView(orderId: string, viewer: Viewer, afterId?: string | null): Promise<Thread> {
  const after = afterId && /^\d{1,18}$/.test(afterId) ? BigInt(afterId) : null;
  const [order, rows] = await Promise.all([
    db().order.findUnique({
      where: { id: orderId },
      select: { vendor: { select: { name: true, label: true } }, request: { select: { buyer: { select: { name: true } } } } },
    }),
    db().orderMessage.findMany({ where: { orderId, ...(after !== null ? { id: { gt: after } } : {}) }, orderBy: { id: "asc" }, take: 200 }),
  ]);
  if (!order) throw new NotFoundError("Order");
  const names = { buyer: order.request.buyer.name, vendor: order.vendor.name ?? `Vendor ${order.vendor.label}` };
  return {
    maxChars: MESSAGE_MAX_CHARS,
    with: viewer === "vendor" ? names.buyer : names.vendor,
    messages: rows.map((m) => {
      const from = m.sender === "BUYER" ? "buyer" : "vendor";
      const mine = from === viewer;
      return {
        id: m.id.toString(),
        from,
        who: mine ? "You" : names[from],
        text: m.body,
        when: `${lagosDay(m.createdAt)}, ${lagosTime(m.createdAt)}`,
        mine,
      };
    }),
  };
}
