import Link from "next/link";
import { Logo } from "./ui";

/** Full-page empty / error states in the handoff's language. */
export function PageMessage({ title, body, action }: { title: string; body: string; action?: { href: string; label: string } }) {
  return (
    <main className="page">
      <header className="header">
        <div className="header-in">
          <Logo />
        </div>
      </header>
      <section className="request" aria-live="polite">
        <div className="eyebrow">ProcureAI</div>
        <h1 className="headline" style={{ maxWidth: "16ch" }}>
          {title}
        </h1>
        <p className="body-lg muted" style={{ maxWidth: "52ch", marginTop: 32 }}>
          {body}
        </p>
        {action ? (
          <div style={{ marginTop: 40 }}>
            <Link className="btn" href={action.href}>
              {action.label} <span className="arrow">→</span>
            </Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
