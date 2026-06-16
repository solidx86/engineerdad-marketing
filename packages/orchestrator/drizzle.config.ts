import { defineConfig } from "drizzle-kit";

const DATABASE_URL = process.env.DATABASE_URL
  ?? "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["orchestrator"],
  // Distinct journal table in the neutral `drizzle` schema (see store/drizzle.config.ts).
  // Must NOT live in the "orchestrator" schema this package's 0000 migration creates —
  // drizzle-kit pre-creates the journal schema, which would collide with that CREATE SCHEMA.
  migrations: { schema: "drizzle", table: "__drizzle_migrations_orchestrator" },
  dbCredentials: { url: DATABASE_URL },
});
