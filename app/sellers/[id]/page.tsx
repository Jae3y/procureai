import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListingCard, StandingBadge, TrustNote } from "@/components/market-cards";
import { SiteShell } from "@/components/site-shell";
import { publicSeller, standingOf } from "@/lib/domain/listings";
import { pageAccount } from "@/lib/http/page-auth";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const s = await publicSeller((await params).id);
  return { title: s ? `${s.businessName} · ProcureAI marketplace` : "Seller · ProcureAI" };
}

export default async function SellerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [account, s] = await Promise.all([pageAccount(), publicSeller(id)]);
  if (!s) notFound();
  const standing = (await standingOf([s.id])).get(s.id) ?? null;
  return (
    <SiteShell signedIn={Boolean(account)}>
      <section className="mk-wrap">
        <p className="note" style={{ marginTop: 0 }}>
          <Link href="/market">Marketplace</Link>
        </p>
        <h1 className="account-title" style={{ marginBottom: 8 }}>
          {s.businessName}
        </h1>
        <p className="note" style={{ marginTop: 0 }}>
          {[s.city, s.category].filter(Boolean).join(" · ")}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <StandingBadge standing={standing} />
          {s.foundingNumber ? <span className="founding-badge">Founding vendor #{s.foundingNumber}</span> : null}
        </div>
        <TrustNote />
        {s.listings.length === 0 ? (
          <p className="note">No products listed yet.</p>
        ) : (
          <ul className="mk-grid">
            {s.listings.map((l) => (
              <ListingCard key={l.id} l={l} />
            ))}
          </ul>
        )}
      </section>
    </SiteShell>
  );
}
