import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3025);

/**
 * E2E runs against a PRODUCTION build in a separate dist dir on port 3025, so it never
 * clobbers a dev server on the default port 3015. Build first: `NEXT_DIST_DIR=.next-verify npm run build`.
 */
export default defineConfig({
  testDir: "tests/e2e",
  testIgnore: /launcher\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { NEXT_DIST_DIR: ".next-verify" },
  },
});
