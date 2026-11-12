import Link from "next/link";
import type { SellerStanding } from "@/lib/domain/listings";
import { formatNaira } from "@/lib/money";

/** Server-rendered pieces of the marketplace: no hooks, so pages stay fast and indexable. */

export function priceLine(priceKobo: bigint | null, unit: string): string {
  return priceKobo === null ? "Price on request" : `${formatNaira(priceKobo)} / ${unit}`;
}

export function StandingBadge({ standing }: { standing: SellerStanding }) {
  if (standing === "VERIFIED_BUSINESS") return <span className="mk-badge">✓ Verified business</span>;
  if (standing === "BANK_VERIFIED") return <span className="mk-badge">✓ Bank-verified seller</span>;
  return null;
}

export type CardListing = {
  id: string;
  title: string;
  priceKobo: bigint | null;
  unit: string;
  minOrder: number;
  photoType: string | null;
  seller?: { id: string; businessName: string; city: string } | undefined;
};

export function ListingCard({ l, standing }: { l: CardListing; standing?: SellerStanding }) {
  return (
    <li className="mk-card">
      <Link href={`/market/${l.id}`} className="mk-card-link">
        <div className="mk-photo">
          {l.photoType ? (
            <img src={`/api/market/listings/${l.id}/photo`} alt="" loading="lazy" />
          ) : (
            <span className="mk-photo-empty" aria-hidden="true">{l.title.slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div className="mk-card-body">
          <div className="mk-title">{l.title}</div>
          <div className="mk-price mono">{priceLine(l.priceKobo, l.unit)}</div>
          {l.minOrder > 1 ? <div className="mk-meta">Minimum {l.minOrder.toLocaleString("en-NG")}</div> : null}
          {l.seller ? (
            <div className="mk-meta">
              {l.seller.businessName}
              {l.seller.city ? ` · ${l.seller.city}` : ""}
            </div>
          ) : null}
          {standing ? <StandingBadge standing={standing} /> : null}
        </div>
      </Link>
    </li>
  );
}

export function TrustNote() {
  return (
    <p className="note mk-trust">
      You never pay a seller directly. When you buy, ProcureAI checks the seller with the bank (and CAC, if they&apos;re registered), holds your money, and pays them 30% when
      your payment is confirmed and 70% when you confirm delivery.
    </p>
  );
}
