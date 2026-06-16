// E-034 follow-up — lazy pool with closeDb() for clean test teardown.
// The exported `db` is a Proxy that lazily opens the underlying postgres
// client on first property access and transparently reopens after closeDb().
// Backward-compatible with all existing `import { db } from "@engineerdad/store"`
// call sites; new code can use getDb() directly.
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { assertDbSafeForBranch } from "@engineerdad/shared";
import * as schema from "./schema.js";

const DATABASE_URL = process.env.DATABASE_URL
  ?? "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad";

let _client: ReturnType<typeof postgres> | undefined;
let _db: PostgresJsDatabase<typeof schema> | undefined;

function ensure(): PostgresJsDatabase<typeof schema> {
  if (!_db) {
    assertDbSafeForBranch(DATABASE_URL);
    _client = postgres(DATABASE_URL, { max: 10 });
    _db = drizzle(_client, { schema });
  }
  return _db;
}

export function getDb(): PostgresJsDatabase<typeof schema> {
  return ensure();
}

export async function closeDb(): Promise<void> {
  if (_client) await _client.end({ timeout: 5 });
  _client = undefined;
  _db = undefined;
}

export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(ensure(), prop, receiver);
  },
});

export type DB = PostgresJsDatabase<typeof schema>;
