import { db } from "./db.js";
import { makeCrud } from "./crud.js";
import { scanProps } from "./compliance.js";

export const store = makeCrud(db, { complianceScan: scanProps });

export * from "./schema.js";
export * from "./crud.js";
export * from "./filters.js";
export { db, getDb, closeDb } from "./db.js";
// Re-export drizzle's sql tag so consumers (mcp-store tests, future stages)
// can run raw fragments without a direct drizzle-orm dependency.
export { sql } from "drizzle-orm";
