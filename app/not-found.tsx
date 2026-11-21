import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { SiteShell } from "@/components/site-shell";

export const metadata: Metadata = { title: "Page not found · ProcureAI", robots: { index: false } };

/** Rendered per request (not prebuilt) so it carries the request's script nonce like every other page. */
export default async function NotFound() {
  await connection();
  return (
    <SiteShell signedIn={false}>
      <section className="account-narrow" style={{ paddingBottom: 96 }}>
        <h1 className="account-title">We couldn&apos;t find that page.</h1>
        <p className="note">The link may be old, or the page may have moved.</p>
        <p className="note">
          <Link href="/">Go to the homepage</Link>, <Link href="/market">browse the marketplace</Link> or <Link href="/buy">start a purchase</Link>.
        </p>
      </section>
    </SiteShell>
  );
}
