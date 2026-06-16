import { defineConfig } from "drizzle-kit";

const DATABASE_URL = process.env.DATABASE_URL
  ?? "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Per-package migration journal. All three packages (store/orchestrator/analytics)
  // share one Postgres DB; with the default shared `drizzle.__drizzle_migrations`,
  // `drizzle-kit migrate` silently skips the later packages' migrations once store has
  // populated the journal. Give each a DISTINCT journal table in the neutral `drizzle`
  // schema (NOT the package's own schema — drizzle-kit pre-creates the journal schema,
  // which would then collide with the migration's own `CREATE SCHEMA`).
  migrations: { schema: "drizzle", table: "__drizzle_migrations_store" },
  dbCredentials: { url: DATABASE_URL },
});
