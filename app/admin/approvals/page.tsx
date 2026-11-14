import type { Metadata } from "next";
import Link from "next/link";
import { AdminLogin } from "@/components/admin-console";
import { ApprovePayoutButton } from "@/components/moderation";
import { SiteShell } from "@/components/site-shell";
import { db } from "@/lib/db";
import { OWNER_APPROVAL_ABOVE_KOBO, SAFETY_HOLD_ABOVE_KOBO } from "@/lib/domain/payouts";
import { pageIsAdmin } from "@/lib/http/page-auth";
import { formatNaira, stage1Percent } from "@/lib/money";
import { lagosDay, lagosTime } from "@/lib/views/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Approvals · Admin · ProcureAI", robots: { index: false } };

/** Large orders whose money is held and whose first payout waits for the owner. */
export default async function ApprovalsPage() {
  if (!(await pageIsAdmin())) return <AdminLogin />;
  const waiting = await db().order.findMany({
    where: { status: "HELD", amountKobo: { gt: OWNER_APPROVAL_ABOVE_KOBO }, payoutApprovedAt: null },
    include: { request: { select: { item: true, quantity: true } }, vendor: { select: { name: true, label: true, contactPhone: true } }, verification: { select: { matchMethod: true, registeredName: true, accountName: true } } },
    orderBy: { createdAt: "asc" },
  });
  return (
    <SiteShell signedIn>
      <section className="account-wide">
        <h1 className="account-title">Large orders waiting for you</h1>
        <p className="note">
          Orders above {formatNaira(OWNER_APPROVAL_ABOVE_KOBO)} wait for your approval before the first payout. Above {formatNaira(SAFETY_HOLD_ABOVE_KOBO)} they also wait 24 hours after
          payment, even once approved. Look at the seller, the quote and the order before approving.
        </p>
        {waiting.length === 0 ? <p className="note">Nothing waiting.</p> : null}
        <ul className="account-list">
          {waiting.map((o) => (
            <li key={o.id} style={{ display: "block" }}>
              <strong>
                <Link href={`/orders/${o.id}`}>
                  {o.request.quantity.toLocaleString("en-NG")} × {o.request.item}
                </Link>
              </strong>{" "}
              <span className="mono">{formatNaira(o.amountKobo)}</span>
              <div className="note" style={{ fontSize: 14 }}>
                Seller: {o.vendor.name ?? o.vendor.label} · {o.vendor.contactPhone} · checked as{" "}
                {o.verification.matchMethod === "ACCOUNT_OWNER" ? `bank-verified (${o.verification.accountName ?? ""})` : `registered business (${o.verification.registeredName ?? ""})`} · first payout {stage1Percent(o.stage1Bp)} · ordered{" "}
                {lagosDay(o.createdAt)} {lagosTime(o.createdAt)}
              </div>
              <ApprovePayoutButton orderId={o.id} />
            </li>
          ))}
        </ul>
      </section>
    </SiteShell>
  );
}
