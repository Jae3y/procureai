"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

const COOKIE = "pai_signup"; // SIGNUP_EVENT_COOKIE in lib/attribution.ts (kept apart: that module is server code)

/** Set while a send waits for the GA tag, so overlapping calls can't send the same sign-up twice. */
let pending = false;

/**
 * Sends GA4's `sign_up` event once after a new account is opened (email, Google, buyer or vendor). The server sets a
 * short-lived pai_signup=<method> cookie on the sign-up response; this reads it, clears it, and calls gtag, but only if
 * the GA tag is on the page. No new scripts, no personal data: the event carries the method only.
 *
 * `fallback`: the caller knows an account was just opened even without the cookie (an idempotent replay of the
 * vendor form returns the stored body but not the original cookies).
 */
export function fireSignUpEvent(fallback?: "email" | "google"): void {
  if (pending) return;
  const method = document.cookie.match(/(?:^|;\s*)pai_signup=(email|google)(?:;|$)/)?.[1] ?? fallback;
  if (!method) return;
  const clear = () => {
    document.cookie = `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  };
  // Cleared before sending: a later page load or call then finds nothing to send.
  clear();
  pending = true;
  let tries = 0;
  const attempt = () => {
    if (window.gtag) {
      pending = false;
      window.gtag("event", "sign_up", { method });
    } else if (++tries < 10) {
      // The GA tag loads after the page is interactive; give it a few seconds.
      window.setTimeout(attempt, 500);
    } else {
      pending = false; // No GA on this site: nothing to send.
    }
  };
  attempt();
}

export function SignUpEvent() {
  const pathname = usePathname();
  useEffect(() => {
    fireSignUpEvent();
  }, [pathname]);
  return null;
}
