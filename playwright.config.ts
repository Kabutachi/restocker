import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

// Short persist path: wrangler's local D1 fails on Windows when the path is too long (260 chars).
export const PERSIST = path.join(os.tmpdir(), "rs-e2e");
const PORT = 8799;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1, // tests share one local D1 database and reset it
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    storageState: "e2e/.auth/state.json",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      `npx wrangler d1 migrations apply resale --local --persist-to "${PERSIST}" && ` +
      `npx wrangler dev --port ${PORT} --persist-to "${PERSIST}"`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
