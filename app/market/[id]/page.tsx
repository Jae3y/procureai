import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { priceLine, StandingBadge, TrustNote } from "@/components/market-cards";
import { ListingRequestForm } from "@/components/marketplace";
import { SiteShell } from "@/components/site-shell";
import { publicListing, standingOf } from "@/lib/domain/listings";
import { pageAccount } from "@/lib/http/page-auth";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const l = await publicListing((await params).id);
  if (!l) return { title: "Marketplace · ProcureAI" };
  return { title: `${l.title} · ${l.contact.businessName} · ProcureAI`, description: `${priceLine(l.priceKobo, l.unit)}. ${l.description.slice(0, 140)}` };
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [account, l] = await Promise.all([pageAccount(), publicListing(id)]);
  if (!l) notFound();
  const standing = (await standingOf([l.contact.id])).get(l.contact.id) ?? null;
  const own = account?.vendorContactId === l.contact.id;
  const back = encodeURIComponent(`/market/${l.id}`);
  return (
    <SiteShell signedIn={Boolean(account)}>
      <section className="mk-wrap">
        <p className="note" style={{ marginTop: 0 }}>
          <Link href="/market">Marketplace</Link> · <Link href={`/market?category=${encodeURIComponent(l.category)}`}>{l.category}</Link>
        </p>
        <div className="mk-detail">
          <div className="mk-detail-photo">
            {l.photoType ? (
              <img src={`/api/market/listings/${l.id}/photo`} alt={l.title} />
            ) : (
              <span className="mk-photo-empty" aria-hidden="true">
                {l.title.slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          <div>
            <h1 className="account-title" style={{ marginBottom: 8 }}>
              {l.title}
            </h1>
            <div className="mk-price mono" style={{ fontSize: 22 }}>
              {priceLine(l.priceKobo, l.unit)}
            </div>
            {l.minOrder > 1 ? (
              <p className="note">
                Minimum order: {l.minOrder.toLocaleString("en-NG")} {l.unit}
              </p>
            ) : null}
            {l.description ? <p className="mk-desc">{l.description}</p> : null}
            <div className="mk-seller">
              <div>
                <Link href={`/sellers/${l.contact.id}`}>
                  <strong>{l.contact.businessName}</strong>
                </Link>
                {l.contact.city ? <span className="note"> · {l.contact.city}</span> : null}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <StandingBadge standing={standing} />
                {l.contact.foundingNumber ? <span className="founding-badge">Founding vendor #{l.contact.foundingNumber}</span> : null}
              </div>
            </div>
            <div style={{ marginTop: 28 }}>
              {own ? (
                <p className="note">
                  This is your product. Edit it from <Link href="/vendor">your vendor dashboard</Link>.
                </p>
              ) : account ? (
                <ListingRequestForm listingId={l.id} minOrder={l.minOrder} unit={l.unit} priceKobo={l.priceKobo === null ? null : l.priceKobo.toString()} />
              ) : (
                <div>
                  <Link className="btn" href={`/login?next=${back}`}>
                    Sign in to request this
                  </Link>
                  <p className="note">
                    New here? <Link href={`/signup?next=${back}`}>Create a free account</Link>.
                  </p>
                </div>
              )}
            </div>
            <TrustNote />
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
