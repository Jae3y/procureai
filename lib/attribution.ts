/**
 * First-touch attribution: where a visitor first came from, kept in a first-party cookie for 30 days
 * and copied onto the account when they sign up. Only the campaign tags and the referring site's host
 * are kept (never a full URL, which can carry personal data in its query string).
 *
 * No imports: proxy.ts uses this on every page request, before the app's env is validated.
 */

export const ATTRIBUTION_COOKIE = "pai_ft";
export const ATTRIBUTION_MAX_AGE = 60 * 60 * 24 * 30;

/** A short-lived, script-readable flag: "a new account was just opened by <method>", read once by the GA sign_up event. */
export const SIGNUP_EVENT_COOKIE = "pai_signup";

export type Attribution = { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; referrerHost: string | null };

const EMPTY: Attribution = { utmSource: null, utmMedium: null, utmCampaign: null, referrerHost: null };

/** Lower-cased, trimmed to 64 characters of letters, digits and . _ - ~ + (spaces become _). Anything else is dropped. */
export function cleanTag(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9._~+-]/g, "").slice(0, 64);
  return v || null;
}

/** The referring site's host, without "www.", when it is another site; null for our own pages or an unreadable header. */
export function referrerHostOf(referer: string | null | undefined, ownHost: string | null | undefined): string | null {
  if (!referer) return null;
  try {
    const host = new URL(referer).hostname.toLowerCase().replace(/^www\./, "");
    const own = (ownHost ?? "").toLowerCase().split(":")[0]!.replace(/^www\./, "");
    if (!host || host === own) return null;
    return cleanTag(host);
  } catch {
    return null;
  }
}

/** What this landing says about where the visitor came from, or null when it says nothing (a direct visit or an internal click). */
export function attributionFromLanding(url: URL, referer: string | null, ownHost: string | null): Attribution | null {
  const a: Attribution = {
    utmSource: cleanTag(url.searchParams.get("utm_source")),
    utmMedium: cleanTag(url.searchParams.get("utm_medium")),
    utmCampaign: cleanTag(url.searchParams.get("utm_campaign")),
    referrerHost: null,
  };
  if (a.utmSource || a.utmMedium || a.utmCampaign) return a;
  const host = referrerHostOf(referer, ownHost);
  return host ? { ...EMPTY, referrerHost: host } : null;
}

export function encodeAttribution(a: Attribution): string {
  const p = new URLSearchParams();
  if (a.utmSource) p.set("s", a.utmSource);
  if (a.utmMedium) p.set("m", a.utmMedium);
  if (a.utmCampaign) p.set("c", a.utmCampaign);
  if (a.referrerHost) p.set("r", a.referrerHost);
  return p.toString();
}

/** Reads the cookie value back. Every field is cleaned again: the cookie is visitor-controlled. */
export function decodeAttribution(value: string | null | undefined): Attribution {
  if (!value) return EMPTY;
  try {
    const p = new URLSearchParams(value);
    return { utmSource: cleanTag(p.get("s")), utmMedium: cleanTag(p.get("m")), utmCampaign: cleanTag(p.get("c")), referrerHost: cleanTag(p.get("r")) };
  } catch {
    return EMPTY;
  }
}

function cookieFrom(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(v.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** The first touch saved in this browser, if any. */
export function attributionFrom(req: Request): Attribution {
  return decodeAttribution(cookieFrom(req, ATTRIBUTION_COOKIE));
}

/** Readable by the page's script (no HttpOnly) for a few minutes, so the GA sign_up event fires once on the next page. */
export function signupEventCookie(method: "email" | "google", secure: boolean): string {
  return `${SIGNUP_EVENT_COOKIE}=${method}; Path=/; SameSite=Lax; Max-Age=300${secure ? "; Secure" : ""}`;
}
