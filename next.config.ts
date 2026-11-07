import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/** Next's own bootstrap scripts are inline, hence 'unsafe-inline'; nothing loads from another origin. */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
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
