import { defineConfig } from "@playwright/test";

/** Boots the app through the real one-command launcher (non-interactive) and smoke-tests it. */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /launcher\.spec\.ts/,
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3035" },
  webServer: {
    command: "./run.sh < /dev/null",
    url: "http://127.0.0.1:3035/api/health",
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    env: { PORT: "3035", NEXT_DIST_DIR: ".next-verify", DOODLELAB_NO_OPEN: "1" },
  },
});
