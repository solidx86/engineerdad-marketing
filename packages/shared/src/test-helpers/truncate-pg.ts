const _dbUrl = process.env.DATABASE_URL ?? "";
const _dbSafe = /_test$/.test(_dbUrl) || /engineerdad_sb_/.test(_dbUrl);
if (!_dbSafe) {
  throw new Error(
    `truncatePg() refuses to run against '${_dbUrl || "(unset)"}'. ` +
      `DATABASE_URL must end with _test or contain engineerdad_sb_. ` +
      `Run \`pnpm db:sandbox\` to set up your branch sandbox.`,
  );
}

// Single canonical truncate helper for all PG-touching tests.
// Owns the table list — add new tables here when schemas grow.
// Safe to call from any test file's beforeEach; uses one shared
// postgres.js client (max: 2) lazily over DATABASE_URL.
import postgres from "postgres";

let sql: ReturnType<typeof postgres> | undefined;

function client() {
  if (sql) return sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL not set; truncatePg() requires Postgres. " +
        "Run `pnpm store:up` and export DATABASE_URL.",
    );
  }
  sql = postgres(url, { max: 2 });
  return sql;
}

/** Truncate every table across all three schemas; restart sequences. */
export async function truncatePg(): Promise<void> {
  await client().unsafe(`
    TRUNCATE
      public.briefs,
      public.scripts,
      public.authority_articles,
      public.creative_variants,
      public.experiments,
      public.performance_reports,
      public.hypotheses,
      public.learnings,
      public.distributions,
      orchestrator.runs,
      orchestrator.run_steps,
      orchestrator.step_results,
      analytics.meta_insights,
      analytics.creatives,
      analytics.events,
      analytics.angle_tags,
      analytics.creative_signals
    RESTART IDENTITY CASCADE
  `);
}

/** Close the helper's pool. Call from afterAll in test files that import truncatePg. */
export async function closeTruncatePg(): Promise<void> {
  if (sql) {
    await sql.end({ timeout: 5 });
    sql = undefined;
  }
}
