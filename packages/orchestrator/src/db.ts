// E-034 — singleton Drizzle client over postgres.js.
// One pool per process, shared across orchestrator.runs / .run_steps / .step_results.
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { assertDbSafeForBranch } from "@engineerdad/shared";
import * as schema from "./schema.js";

let cachedClient: ReturnType<typeof postgres> | undefined;
let cachedDb: PostgresJsDatabase<typeof schema> | undefined;

function url(): string {
  const u = process.env.DATABASE_URL;
  if (!u) {
    throw new Error(
      "DATABASE_URL not set; @engineerdad/orchestrator requires Postgres. " +
        "Run `pnpm store:up` and export DATABASE_URL.",
    );
  }
  return u;
}

/** Module-cached Drizzle client. Lazy — never opens a pool until first call. */
export function getDb(): PostgresJsDatabase<typeof schema> {
  if (cachedDb) return cachedDb;
  assertDbSafeForBranch(url());
  cachedClient = postgres(url(), { max: 5 });
  cachedDb = drizzle(cachedClient, { schema });
  return cachedDb;
}

/** Raw postgres.js client backing getDb() — for ad-hoc sql`...` callers like postgres.ts. */
export function getSql(): ReturnType<typeof postgres> {
  if (!cachedClient) getDb();
  return cachedClient!;
}

/** Close the pool. Tests call this in afterAll. */
export async function closeDb(): Promise<void> {
  if (cachedClient) await cachedClient.end({ timeout: 5 });
  cachedClient = undefined;
  cachedDb = undefined;
}

/** Test helper — reset the module cache without closing. Rarely needed; tests
 *  prefer truncatePg() + a fresh getDb() call. */
export function resetDbCache(): void {
  cachedClient = undefined;
  cachedDb = undefined;
}
