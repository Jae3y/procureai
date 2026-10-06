/** Display helpers shared by the view models (server-side). Times and dates are Lagos-local. */

const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long" });
const dayYearFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric" });

export function lagosTime(d: Date): string {
  return timeFmt.format(d);
}

/** "23 October" */
export function lagosDay(d: Date): string {
  return dayFmt.format(d);
}

/** For @db.Date values (UTC midnight): "23 October". */
export function civilDay(d: Date | string): string {
  const iso = typeof d === "string" ? d : d.toISOString().slice(0, 10);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(`${iso}T00:00:00Z`));
}

/** "5–15 October 2026" or "28 September – 3 October 2026" */
export function dayRange(a: Date, b: Date): string {
  const [ad, am, ay] = dayYearFmt.format(a).split(" ");
  const [bd, bm, by] = dayYearFmt.format(b).split(" ");
  if (am === bm && ay === by) return ad === bd ? `${ad} ${am} ${ay}` : `${ad}–${bd} ${bm} ${by}`;
  return `${ad} ${am} – ${bd} ${bm} ${by}`;
}

/** "902 441 7368" */
export function spacedAccount(n: string | null | undefined): string | null {
  if (!n) return null;
  return n.replace(/^(\d{3})(\d{3})(\d+)$/, "$1 $2 $3");
}

/** "481 906" */
export function spacedCode(c: string): string {
  return c.replace(/^(\d{3})(\d{3})$/, "$1 $2");
}

export function orderRef(number: number): string {
  return `PA-${String(number).padStart(4, "0")}`;
}

export function longOrderRef(number: number, created: Date): string {
  return `PA-${created.getUTCFullYear()}-${String(number).padStart(4, "0")}`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Lower-cases the first letter unless it starts an acronym/brand like "T-shirts". */
export function itemPhrase(quantity: number, item: string): string {
  const lowered = /^[A-Z][a-z]/.test(item) ? item.charAt(0).toLowerCase() + item.slice(1) : item;
  return `${quantity.toLocaleString("en-NG")} ${lowered}`;
}
