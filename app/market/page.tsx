import type { Metadata } from "next";
import Link from "next/link";
import { ListingCard, TrustNote } from "@/components/market-cards";
import { SiteShell } from "@/components/site-shell";
import { CATEGORIES, searchListings, standingOf } from "@/lib/domain/listings";
import { pageAccount } from "@/lib/http/page-auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Marketplace · ProcureAI",
  description: "Browse what Nigerian sellers offer, with prices and photos. Every purchase is protected: ProcureAI checks the seller and holds your money until delivery.",
};

type Params = { q?: string; category?: string; city?: string; page?: string };

function href(p: Params): string {
  const s = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as Array<[string, string]>).toString();
  return s ? `/market?${s}` : "/market";
}

export default async function MarketPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const [account, result] = await Promise.all([pageAccount(), searchListings({ q: p.q, category: p.category, city: p.city, page: Number(p.page) || 1 })]);
  const standing = await standingOf([...new Set(result.rows.map((r) => r.contact.id))]);
  return (
    <SiteShell signedIn={Boolean(account)}>
      <section className="mk-wrap">
        <h1 className="account-title">Marketplace</h1>
        <p className="note" style={{ maxWidth: 720 }}>
          What sellers across Nigeria offer, with prices and photos. Found something? Request it from the seller, or let ProcureAI ask several sellers and compare for you.
        </p>
        <form className="mk-search" action="/market" method="get" role="search">
          <label className="sr-only" htmlFor="mk-q">Search</label>
          <input id="mk-q" className="input" name="q" defaultValue={p.q ?? ""} placeholder="What do you need? e.g. T-shirts, cement, chin chin" />
          <label className="sr-only" htmlFor="mk-city">City</label>
          <input id="mk-city" className="input" name="city" defaultValue={p.city ?? ""} placeholder="City (optional)" />
          {p.category ? <input type="hidden" name="category" value={p.category} /> : null}
          <button type="submit" className="btn btn-sm">Search</button>
        </form>
        <nav className="mk-cats" aria-label="Categories">
          <Link href={href({ q: p.q, city: p.city })} className={`mk-cat${p.category ? "" : " on"}`}>All</Link>
          {CATEGORIES.map((c) => (
            <Link key={c} href={href({ q: p.q, city: p.city, category: c })} className={`mk-cat${p.category === c ? " on" : ""}`}>
              {c}
            </Link>
          ))}
        </nav>
        <TrustNote />
        {result.rows.length === 0 ? (
          <div className="mk-empty">
            <p className="note">
              {p.q || p.category || p.city ? "Nothing listed matches that yet." : "Sellers are adding their products now."} You can still{" "}
              <Link href={p.q ? `/buy?text=${encodeURIComponent(p.q)}` : "/buy"}>describe what you need</Link> and ProcureAI will ask sellers for quotes.
            </p>
            <p className="note">
              Sell something? <Link href="/vendors/join">List your products for free</Link>.
            </p>
          </div>
        ) : (
          <>
            <p className="mk-count note">
              {result.total.toLocaleString("en-NG")} {result.total === 1 ? "product" : "products"}
            </p>
            <ul className="mk-grid">
              {result.rows.map((r) => (
                <ListingCard key={r.id} l={{ ...r, seller: r.contact }} standing={standing.get(r.contact.id) ?? null} />
              ))}
            </ul>
            {result.pages > 1 ? (
              <nav className="mk-pages" aria-label="Pages">
                {result.page > 1 ? <Link href={href({ ...p, page: String(result.page - 1) })}>← Previous</Link> : <span />}
                <span className="note">
                  Page {result.page} of {result.pages}
                </span>
                {result.page < result.pages ? <Link href={href({ ...p, page: String(result.page + 1) })}>Next →</Link> : <span />}
              </nav>
            ) : null}
          </>
        )}
      </section>
    </SiteShell>
  );
}
