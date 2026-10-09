import { defineConfig, devices } from "@playwright/test";
import { E2E } from "./tests/e2e/env";

/**
 * End-to-end tests (spec §136–137) against a production build on :3100 with a
 * separate database (vdo_e2e) — they never touch development data.
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: E2E.baseURL,
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: `npx next build && npx next start --port ${E2E.port}`,
    url: `${E2E.baseURL}/login`,
    timeout: 600_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    env: {
      ...(process.env as Record<string, string>),
      NEXT_DIST_DIR: E2E.distDir,
      DATABASE_URL: E2E.databaseUrl,
      APP_URL: E2E.baseURL,
      EMAIL_PROVIDER: "file",
      EMAIL_FILE_DIR: E2E.mailDir,
      EMBEDDED_WORKER: "true",
      // The acceptance scenario uses the simulated demo integrations, which production hides by default.
      SHOW_DEMO_INTEGRATIONS: "true",
      // The suite signs up several users from one machine; production limits stay unchanged.
      RATE_LIMIT_SCALE: "20",
      // No real AI calls in tests: employees use the offline demo model.
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      GOOGLE_API_KEY: "",
    },
  },
});
