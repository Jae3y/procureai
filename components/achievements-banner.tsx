import { ACHIEVEMENTS } from "@/lib/achievements";

/**
 * A slow rolling banner of ProcureAI's real wins. Pauses on hover or focus, stands still for people who
 * ask their device for less motion, and is read once by screen readers (the repeats are hidden from them).
 */
export function AchievementsBanner() {
  return (
    <section className="ticker" aria-label="ProcureAI news">
      <div className="ticker-track">
        {/* An even number of identical sets: the track slides by exactly half, so the loop is seamless, and
            three sets per half keep even very wide screens filled. */}
        {[0, 1, 2, 3, 4, 5].map((copy) => (
          <ul key={copy} className="ticker-set" aria-hidden={copy > 0 ? "true" : undefined}>
            {ACHIEVEMENTS.map((a) => (
              <li key={a.text}>
                <span className="ticker-tag">{a.tag}</span>
                {a.text}
              </li>
            ))}
          </ul>
        ))}
      </div>
    </section>
  );
}
