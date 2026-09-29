import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ quiet: true });

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

// E2E runs against TEST_DATABASE_URL, re-seeded by global setup.
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], viewport: { width: 375, height: 812 }, browserName: "chromium" },
    },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    // E2E_PROD=1 runs the suite against a production build (the service worker's
    // offline shell is only fully representative there).
    command: process.env.E2E_PROD === "1" ? `npx next build && npx next start --port ${PORT}` : `npx next dev --port ${PORT}`,
    url: `${baseURL}/sign-in`,
    reuseExistingServer: false,
    timeout: process.env.E2E_PROD === "1" ? 600_000 : 180_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      APP_URL: baseURL,
      DISABLE_RATE_LIMIT: "1",
      I18N_STRICT: "1",
      // Register the service worker in dev too, so offline behaviour is tested (Phase 9).
      NEXT_PUBLIC_SW: "1",
      // A production server refuses to start without secrets. The PIN secret must be
      // the one the test seed hashed PINs with (the dev fallback unless .env sets one).
      ...(process.env.E2E_PROD === "1"
        ? {
            BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-only-better-auth-secret-0123456789abcdef",
            PIN_HMAC_SECRET: process.env.PIN_HMAC_SECRET ?? "dev-only-insecure-pin_hmac_secret-change-me-0123456789",
          }
        : {}),
      RESEND_API_KEY: "",
    },
  },
});
