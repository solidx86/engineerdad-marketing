import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // resolve.test.ts and integration.test.ts both touch
    // orchestrator.step_results on the same Postgres database. Running
    // them in parallel races TRUNCATE against in-flight INSERTs and
    // SELECTs. Run files sequentially in a single fork so the writes
    // each test makes survive the test that made them.
    fileParallelism: false,
  },
});
