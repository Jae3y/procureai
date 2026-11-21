import { defineConfig, devices } from "@playwright/test";

/**
 * E2E: the full happy path in a real browser. By default it runs against `npm run dev:offline`
 * (Kora test double, OFFLINE banner). Set E2E_BASE_URL to point at a server running `npm run dev`
 * with a Kora test key to run the same spec against the real sandbox.
 */
/** Its own port, not 3000: other projects on this machine use 3000, and the run must never test someone else's app. */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3200);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL, trace: "retain-on-failure", viewport: { width: 1920, height: 1080 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run dev:offline", url: baseURL, reuseExistingServer: true, timeout: 180_000, env: { PORT: String(E2E_PORT) } },
});
