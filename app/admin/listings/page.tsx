import type { Metadata } from "next";
import Link from "next/link";
import { AdminLogin } from "@/components/admin-console";
import { priceLine } from "@/components/market-cards";
import { ModerateListing } from "@/components/moderation";
import { SiteShell } from "@/components/site-shell";
import { moderationQueue, REASON_WORDS, type ReportReason } from "@/lib/domain/moderation";
import { pageIsAdmin } from "@/lib/http/page-auth";
import { lagosDay } from "@/lib/views/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Listings · Admin · ProcureAI", robots: { index: false } };

/** The owner's moderation page: reported listings first, then the newest listings. */
export default async function AdminListingsPage() {
  if (!(await pageIsAdmin())) return <AdminLogin />;
  const { reported, recent } = await moderationQueue();
  return (
    <SiteShell signedIn>
      <section className="account-wide">
        <h1 className="account-title">Marketplace listings</h1>
        <p className="note">Reported listings come first. Taking one down hides it at once and tells the seller your reason. Three open reports pause a listing automatically.</p>

        <div className="account-block">
          <div className="account-block-head">
            <h2>Reported ({reported.length})</h2>
          </div>
          {reported.length === 0 ? <p className="note">Nothing reported.</p> : null}
          <ul className="account-list">
            {reported.map((l) => (
              <li key={l.id} style={{ display: "block" }}>
                <strong>
                  <Link href={`/market/${l.id}`}>{l.title}</Link>
                </strong>{" "}
                <span className="note">
                  · {l.contact.businessName} · {l.contact.phone} · {priceLine(l.priceKobo, l.unit)} · {l.status.toLowerCase()}
                </span>
                <ul style={{ margin: "6px 0 0 18px" }}>
                  {l.reports.map((r) => (
                    <li key={r.id} className="note" style={{ fontSize: 14, margin: 0 }}>
                      {lagosDay(r.createdAt)}: {REASON_WORDS[r.reason as ReportReason] ?? r.reason}
                      {r.note ? ` · "${r.note}"` : ""}
                    </li>
                  ))}
                </ul>
                <ModerateListing listingId={l.id} removed={l.status === "REMOVED"} />
              </li>
            ))}
          </ul>
        </div>

        <div className="account-block">
          <div className="account-block-head">
            <h2>Newest listings</h2>
          </div>
          <ul className="account-list">
            {recent.map((l) => (
              <li key={l.id} style={{ display: "block" }}>
                <strong>
                  <Link href={`/market/${l.id}`}>{l.title}</Link>
                </strong>{" "}
                <span className="note">
                  · {l.contact.businessName} · {priceLine(l.priceKobo, l.unit)} · {l.status.toLowerCase()}
                  {l.removedByAdminAt ? ` · taken down: ${l.moderationNote ?? ""}` : ""}
                </span>
                <ModerateListing listingId={l.id} removed={l.status === "REMOVED"} />
              </li>
            ))}
          </ul>
        </div>
      </section>
    </SiteShell>
  );
}
