/**
 * Vendor sourcing: from the whole directory, pick the vendors worth asking for THIS purchase.
 * Each directory entry carries space-separated tags (what it sells); an item matches when its words
 * appear in those tags. Best matches first (most overlapping words), oldest entry first on ties,
 * capped so the buyer gets a comparable shortlist rather than a flood.
 */

export const MAX_SHORTLIST = 8;
/** Fewer matches than this and the broad "general" merchants are added so a niche item still gets quotes. */
const MIN_SHORTLIST = 3;

export type Sourceable = { id: string; category: string; createdAt: Date };

const FILLER = new Set(["and", "the", "for", "with", "per", "pcs", "piece", "pieces", "unit", "units", "branded", "custom", "of"]);

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("es") && /(ch|sh|x|s)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !FILLER.has(w))
    .map(stem);
}

export function shortlist<T extends Sourceable>(contacts: readonly T[], item: string, max = MAX_SHORTLIST): T[] {
  const wanted = new Set(wordsOf(item));
  const scored = contacts.map((c) => {
    const tags = new Set(wordsOf(c.category));
    let score = 0;
    for (const w of wanted) if (tags.has(w)) score += 1;
    return { c, score, general: tags.has("general") };
  });
  const byScore = (a: (typeof scored)[number], b: (typeof scored)[number]) => b.score - a.score || a.c.createdAt.getTime() - b.c.createdAt.getTime();
  const matched = scored.filter((s) => s.score > 0).sort(byScore);
  if (matched.length < MIN_SHORTLIST) {
    for (const g of scored.filter((s) => s.general && s.score === 0).sort(byScore)) {
      if (matched.length >= MIN_SHORTLIST) break;
      matched.push(g);
    }
  }
  return matched.slice(0, max).map((s) => s.c);
}
