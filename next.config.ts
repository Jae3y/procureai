import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/** Next's own bootstrap scripts are inline, hence 'unsafe-inline'; nothing loads from another origin. */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`,
  "frame-src https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

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
          { key: "Content-Security-Policy", value: CSP },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), payment=()" },
        ],
      },
    ];
  },
};

export default config;
