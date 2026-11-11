import { DomainError } from "@/lib/domain/errors";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

/** Cloudflare Turnstile: a free, mostly invisible check that a real person is signing up. Off until both keys are set. */
export function turnstileEnabled(): boolean {
  const e = env();
  return Boolean(e.TURNSTILE_SITE_KEY && e.TURNSTILE_SECRET_KEY);
}

export async function verifyTurnstile(token: string | undefined, ip: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!turnstileEnabled()) return;
  const refuse = () => new DomainError("bot_check_failed", "We couldn't confirm you're a person. Refresh the page and try again.", 400);
  if (!token) throw refuse();
  try {
    const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: env().TURNSTILE_SECRET_KEY, response: token, ...(ip && ip !== "local" ? { remoteip: ip } : {}) }).toString(),
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await res.json()) as { success?: boolean };
    if (!res.ok || body.success !== true) throw refuse();
  } catch (err) {
    if (err instanceof DomainError) throw err;
    log.warn({ err: String(err) }, "turnstile check could not be completed");
    throw refuse();
  }
}
