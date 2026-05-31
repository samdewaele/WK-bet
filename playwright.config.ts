import { defineConfig, devices } from "@playwright/test";

const BASE_URL = "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // SQLite can't handle concurrent writes; run tests serially
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // CI builds first (separate step), then starts the production server.
    // Locally, next dev is reused if already running.
    command: process.env.CI ? "npm start" : "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "file:./e2e.db",
      E2E_TEST: "true",
      AUTH_SECRET:
        process.env.AUTH_SECRET ?? "e2e-test-secret-min-32-chars-xxxxx",
      NEXT_PUBLIC_BASE_URL: BASE_URL,
    },
  },
});
