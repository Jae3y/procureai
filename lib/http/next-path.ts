/** Only same-site paths may follow a sign-in, so a crafted link can't bounce someone to another site. */
export function safeNext(raw: unknown, fallback = "/account"): string {
  if (typeof raw !== "string") return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw.slice(0, 300);
}
