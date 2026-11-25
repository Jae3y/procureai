"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

const COOKIE = "pai_signup"; // SIGNUP_EVENT_COOKIE in lib/attribution.ts (kept apart: that module is server code)

/**
 * Sends GA4's `sign_up` event once after a new account is opened (email, Google, buyer or vendor). The server sets a
 * short-lived pai_signup=<method> cookie on the sign-up response; this reads it, clears it, and calls gtag, but only if
 * the GA tag is on the page. No new scripts, no personal data: the event carries the method only.
 */
export function fireSignUpEvent(): void {
  const match = document.cookie.match(/(?:^|;\s*)pai_signup=(email|google)(?:;|$)/);
  if (!match) return;
  const method = match[1];
  let tries = 0;
  const attempt = () => {
    if (window.gtag) {
      document.cookie = `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
      window.gtag("event", "sign_up", { method });
    } else if (++tries < 10) {
      // The GA tag loads after the page is interactive; give it a few seconds.
      window.setTimeout(attempt, 500);
    } else {
      document.cookie = `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`; // No GA on this site: nothing to send.
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
