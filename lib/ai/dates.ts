/**
 * Calendar maths for quotes. All dates are civil dates in Lagos (WAT, UTC+1, no DST), represented
 * as "YYYY-MM-DD" strings and stored as @db.Date. Relative phrases ("ready Thursday", "next
 * tuesday", "7 working days") resolve against the REQUEST's creation date, not today.
 */

export type CivilDate = string; // YYYY-MM-DD

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

export function lagosDate(instant: Date): CivilDate {
  return new Date(instant.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

function toUtc(d: CivilDate): Date {
  return new Date(`${d}T00:00:00Z`);
}

export function addDays(d: CivilDate, n: number): CivilDate {
  const t = toUtc(d);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function weekday(d: CivilDate): number {
  return toUtc(d).getUTCDay();
}

export function addBusinessDays(d: CivilDate, n: number): CivilDate {
  let cur = d;
  let left = n;
  while (left > 0) {
    cur = addDays(cur, 1);
    const w = weekday(cur);
    if (w !== 0 && w !== 6) left--;
  }
  return cur;
}

/** First `target` weekday strictly after `from`. */
export function nextWeekday(from: CivilDate, target: number): CivilDate {
  const diff = (target - weekday(from) + 7) % 7 || 7;
  return addDays(from, diff);
}

/**
 * "next <weekday>": the occurrence in the following Monday–Sunday week. Said on Monday 5 October,
 * "Tuesday" is 6 October but "next Tuesday" is 13 October.
 */
export function nextWeekWeekday(from: CivilDate, target: number): CivilDate {
  const plain = nextWeekday(from, target);
  const mondayOf = (d: CivilDate) => addDays(d, -((weekday(d) + 6) % 7));
  return mondayOf(plain) === mondayOf(from) ? addDays(plain, 7) : plain;
}

export function parseWeekday(word: string): number | null {
  return WEEKDAY_ALIASES[word.toLowerCase()] ?? null;
}

/** "23 October", "Oct 23", "23rd of October" → the next such date on or after `from`. */
export function parseDayMonth(text: string, from: CivilDate): CivilDate | null {
  const a = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\b/.exec(text);
  const b = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(text);
  const pick = (dayRaw: string, monRaw: string): CivilDate | null => {
    const month = MONTHS[monRaw.toLowerCase()];
    const day = Number.parseInt(dayRaw, 10);
    if (!month || day < 1 || day > 31) return null;
    let year = Number.parseInt(from.slice(0, 4), 10);
    let candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (toUtc(candidate).toISOString().slice(0, 10) !== candidate) return null; // 31 February
    if (candidate < from) {
      year += 1;
      candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    return candidate;
  };
  if (a?.[1] && a[2]) {
    const r = pick(a[1], a[2]);
    if (r) return r;
  }
  if (b?.[1] && b[2]) return pick(b[2], b[1]);
  return null;
}

/** A ready/lead-time phrase in a vendor reply → a date, relative to `from`. */
export function resolveReadyPhrase(text: string, from: CivilDate): CivilDate | null {
  const t = text.toLowerCase();

  const working = /\b(\d{1,2})\s*(?:working|business)\s*days?\b/.exec(t);
  if (working?.[1]) return addBusinessDays(from, Number.parseInt(working[1], 10));

  const weeks = /\b(?:in\s+)?(\d{1,2}|a|one|two|three)\s*weeks?\b/.exec(t);
  const days = /\b(\d{1,2}|one|two|three|four|five|six|seven)\s*days?\b/.exec(t);
  const words: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
  if (days?.[1]) return addDays(from, words[days[1]] ?? Number.parseInt(days[1], 10));
  if (weeks?.[1]) return addDays(from, 7 * (words[weeks[1]] ?? Number.parseInt(weeks[1], 10)));

  if (/\btomorrow\b|\btmrw\b|\btmr\b/.test(t)) return addDays(from, 1);
  if (/\btoday\b/.test(t)) return from;

  const next = /\bnext\s+(sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)[a-z]*\b/.exec(t);
  if (next?.[1]) {
    const w = parseWeekday(next[1]);
    if (w !== null) return nextWeekWeekday(from, w);
  }
  const plain = /\b(sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday|sday)?\b/.exec(t);
  if (plain?.[1]) {
    const w = parseWeekday(plain[1]);
    if (w !== null) return nextWeekday(from, w);
  }
  return parseDayMonth(text, from);
}

export function formatCivilDate(d: CivilDate): string {
  const [y, m, day] = d.split("-").map((x) => Number.parseInt(x, 10));
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${day} ${names[(m ?? 1) - 1]}${y && y !== new Date().getUTCFullYear() ? ` ${y}` : ""}`;
}

export { WEEKDAYS };
