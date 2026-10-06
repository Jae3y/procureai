import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": root } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/setup/env.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/setup/env.ts", "tests/setup/integration.ts"],
          globalSetup: ["tests/setup/global-db.ts"],
          // One shared test database: files run one at a time; tests inside a file run in order.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: "sandbox",
          include: ["tests/sandbox/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/setup/sandbox-env.ts", "tests/setup/integration.ts"],
          globalSetup: ["tests/setup/global-db.ts"],
          fileParallelism: false,
          testTimeout: 180_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
