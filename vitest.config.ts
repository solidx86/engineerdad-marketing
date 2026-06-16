import { defineConfig } from "vitest/config";
import { readFileSync, existsSync } from "node:fs";

// Load .env.local if present so that `pnpm db:sandbox` DATABASE_URL is picked
// up automatically. Shell exports still win (process.env is only set when unset).
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 1 || line.startsWith("#")) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
}

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["**/*.{test,spec}.{ts,mjs}"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/tests/e2e/**"],
    passWithNoTests: true,
    pool: "forks",
    // E-034: truncate-all tests require serial execution across the whole
    // suite. singleFork keeps everything in one worker; concurrent:false
    // disables within-file parallelism.
    poolOptions: { forks: { singleFork: true } },
    sequence: { concurrent: false },
  },
});
