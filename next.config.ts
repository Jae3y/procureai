import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Recorded identity fixtures are read from disk at runtime (SIMULATE_IDENTITY); ship them with the server.
  outputFileTracingIncludes: { "/**": ["./lib/kora/fixtures/**/*.json"] },
  serverExternalPackages: ["pino", "pg"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
