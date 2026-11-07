import { SiteShell } from "./site-shell";
import { LEGAL_REVIEWED, LEGAL_UPDATED, type LegalSection } from "@/lib/legal";

export function LegalPage({ title, sections, signedIn }: { title: string; sections: LegalSection[]; signedIn: boolean }) {
  return (
    <SiteShell signedIn={signedIn}>
      <article className="account-narrow legal">
        <h1 className="account-title">{title}</h1>
        <p className="note">Last updated {LEGAL_UPDATED}.</p>
        {LEGAL_REVIEWED ? null : (
          <p className="legal-draft" role="note">
            Draft: this page is being reviewed by a lawyer and may change. It already describes how ProcureAI actually works.
          </p>
        )}
        {sections.map((s) => (
          <section key={s.heading}>
            <h2>{s.heading}</h2>
            {s.paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </section>
        ))}
      </article>
    </SiteShell>
  );
}
