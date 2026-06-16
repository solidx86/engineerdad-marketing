import { defineConfig } from "@playwright/test";

// Base URL = WEBAPP_URL (legacy REVIEW_UI_URL still honored by webappUrl()).
const WEBAPP_URL = process.env.WEBAPP_URL ?? process.env.REVIEW_UI_URL ?? "http://localhost:3030";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: WEBAPP_URL, trace: "retain-on-failure" },
  webServer: {
    command: "pnpm dev",
    url: WEBAPP_URL,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test",
    },
    timeout: 60_000,
  },
});
