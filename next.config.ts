import type { NextConfig } from "next";

/**
 * Pages get their Content-Security-Policy, with a per-request nonce, from proxy.ts. Everything else (API answers,
 * images, files) gets this one: nothing may be framed, run or loaded from it as a page.
 */
const NON_PAGE_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Recorded identity fixtures are read from disk at runtime (SIMULATE_IDENTITY); ship them with the server.
  outputFileTracingIncludes: {
    "/**": ["./lib/kora/fixtures/**/*.json"],
    // The record PNG embeds Inter (it has the ₦ glyph the image renderer's default font lacks).
    "/r/[signedId]/image": ["./node_modules/@fontsource/inter/files/inter-latin*-normal.woff"],
  },
  // This repo is the workspace root (silences the lockfile-outside-repo warning).
  turbopack: { root: import.meta.dirname },
  serverExternalPackages: ["pino", "pg"],
  /**
   * The old free address (procureai-six.vercel.app) sends people to procureai.com.ng. Kora's webhook
   * and the 10-minute cron job still call the old address until they are moved in their dashboards,
   * so those two paths keep answering there; everything else redirects.
   */
  async redirects() {
    return [
      // One address only. A browser keeps a separate sign-in for www and for the bare domain, and Google sign-in
      // always lands on the bare domain, so with both open a person could sign out of one and still be signed in on the other.
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.procureai.com.ng" }],
        destination: "https://procureai.com.ng/:path*",
        permanent: true,
      },
      {
        source: "/:path((?!api/webhooks/|api/cron/).*)",
        has: [{ type: "host", value: "procureai-six.vercel.app" }],
        destination: "https://procureai.com.ng/:path",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=(), usb=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: NON_PAGE_CSP }] },
    ];
  },
};

export default config;
