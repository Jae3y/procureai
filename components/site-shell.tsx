import Link from "next/link";
import { Logo } from "./ui";

/** The frame for account, vendor and legal pages: logo, a few links, and the footer with the legal pages. */
export function SiteShell({ signedIn, children }: { signedIn: boolean; children: React.ReactNode }) {
  return (
    <main className="page">
      <header className="header">
        <div className="header-in">
          <Logo />
          <nav className="site-nav" aria-label="Account">
            {signedIn ? (
              <Link href="/account" className="btn-text" style={{ textDecoration: "none" }}>
                Your account
              </Link>
            ) : (
              <Link href="/login" className="btn-text" style={{ textDecoration: "none" }}>
                Sign in
              </Link>
            )}
            <Link href="/buy" className="btn btn-sm">
              Start a purchase
            </Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="site-foot">
        <span>ProcureAI · Lagos</span>
        <span style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/refunds">Refunds and disputes</Link>
          <span>Payments and identity checks by Kora</span>
        </span>
      </footer>
    </main>
  );
}
