import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Playwright specs (tests/e2e/**) are driven by `pnpm test:e2e`, not vitest.
    exclude: ["node_modules/**", ".next/**", "tests/e2e/**"],
  },
  resolve: {
    alias: {
      // server-only throws outside Next.js; stub it for vitest
      "server-only": new URL("./src/__mocks__/server-only.ts", import.meta.url).pathname,
    },
  },
});
