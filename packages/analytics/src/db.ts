// E-034 — analytics's PG-resident state. Same public API (getDb, resetDbCache);
// internals now Drizzle over postgres.js. DEFAULT_DB_PATH removed.
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
      "DATABASE_URL not set; @engineerdad/analytics requires Postgres. " +
        "Run `pnpm store:up` and export DATABASE_URL.",
    );
  }
  return u;
}

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (cachedDb) return cachedDb;
  assertDbSafeForBranch(url());
  cachedClient = postgres(url(), { max: 5 });
  cachedDb = drizzle(cachedClient, { schema });
  return cachedDb;
}

export function getSql(): ReturnType<typeof postgres> {
  if (!cachedClient) getDb();
  return cachedClient!;
}

export async function closeDb(): Promise<void> {
  if (cachedClient) await cachedClient.end({ timeout: 5 });
  cachedClient = undefined;
  cachedDb = undefined;
}

export function resetDbCache(): void {
  cachedClient = undefined;
  cachedDb = undefined;
}
