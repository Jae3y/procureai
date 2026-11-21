import { type NextRequest, NextResponse } from "next/server";

/**
 * A fresh nonce on every page request, so the Content-Security-Policy can allow exactly Next's own scripts and
 * nothing injected: no 'unsafe-inline' for scripts. 'strict-dynamic' lets those trusted scripts load what they
 * need (the Cloudflare sign-up check). Styles keep 'unsafe-inline' because the pages use style attributes,
 * which nonces don't cover; a style can't run code.
 *
 * Pages must render per request for this to work; they all do (force-dynamic, or they read cookies/params).
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com${dev ? " 'unsafe-eval'" : ""}`,
    "frame-src https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not the API, Next's static files, images, or the machine-readable files.
      source: "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|opengraph-image).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
