import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:8000";
// Protected Vercel previews let automated tests through with this secret
const bypassSecret = process.env.VERCEL_BYPASS;

export default defineConfig({
  testDir: "./tests",
  // Tests share the e2e-test-user account and reset it, so they must not run concurrently
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    extraHTTPHeaders: bypassSecret
      ? {
          "x-vercel-protection-bypass": bypassSecret,
          // Sets a cookie so later requests from the page (fetches, assets) are let through too
          "x-vercel-set-bypass-cookie": "samesitenone",
        }
      : undefined,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
