# E-034 — Sunset SQLite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete every SQLite read/write in the repo. Migrate orchestrator run state, analytics signals, and experiment readouts to Postgres in one DB across three schemas (`public`, `orchestrator`, `analytics`), all defined in Drizzle. Standardize tests on a single truncate-all helper; force the whole suite serial.

**Architecture:** Clean-break migration in seven staged commits on branch `e-034-sunset-sqlite`. Each commit leaves `pnpm -r build` + `pnpm test` green. Squash-merge to `main`. No data migration — local `data/engineerdad.sqlite` is dev fixture only and gets deleted in commit 7.

**Tech Stack:** Postgres 16 (Docker), Drizzle ORM 0.36, `postgres.js` 3.4, Vitest 2.x (fork pool, forced single-fork), TypeScript ESM workspace.

**Spec:** `docs/superpowers/specs/2026-05-26-e-034-sunset-sqlite-design.html`

---

## File Structure

### New files
- `packages/shared/src/test-helpers/truncate-pg.ts` — single canonical truncate helper, knows all 16 tables
- `packages/shared/src/test-helpers/index.ts` — barrel
- `packages/orchestrator/src/schema.ts` — Drizzle pgSchema for `orchestrator.*`
- `packages/orchestrator/src/db.ts` — Drizzle client singleton
- `packages/orchestrator/drizzle.config.ts` — drizzle-kit config (orchestrator schema only)
- `packages/analytics/src/schema.ts` — Drizzle pgSchema for `analytics.*`
- `packages/analytics/src/db.ts` — replaces today's SQLite version, same exports
- `packages/analytics/drizzle.config.ts` — drizzle-kit config (analytics schema only)
- `docs/decisions/025-postgres-only.md` — new ADR

### Modified files (high-level)
- `packages/orchestrator/src/state.ts` — gutted, Postgres internals, same public API
- `packages/orchestrator/src/postgres.ts` — shares `getDb().$client`; `closePostgres` deprecated → `closeDb`
- `packages/orchestrator/package.json` — add Drizzle deps, swap `db:push` script
- `packages/orchestrator/src/index.ts` — remove `DEFAULT_DB_PATH` re-export
- `packages/orchestrator/src/state.test.ts`, `engine.test.ts`, `engine.integration.test.ts`, `engine.gate.integration.test.ts`, `postgres.test.ts` — switch to `truncatePg()`
- `packages/analytics/src/{bandit,ingest-meta-insights,ingest-meta-organic,creative-signals,cost-per-angle,decay-curve,top-creatives,tools}.ts` — rewrite SQL via Drizzle / `sql\`...\`` tag
- `packages/analytics/src/index.ts` — drop `DEFAULT_DB_PATH` export
- `packages/analytics/src/bandit.test.ts`, `src/__tests__/*.test.ts` — switch to `truncatePg()`
- `packages/experiment/src/db.ts`, `src/readout.ts`, `src/readout.test.ts` — thin shim over analytics `getDb()`; PG queries
- `packages/experiment/package.json` — add `@engineerdad/analytics` workspace dep
- `packages/store/src/{crud,compliance,filters}.test.ts` — switch local `truncateAll` to shared `truncatePg()`
- `apps/webapp/src/app/lib/orchestrator.ts` — drop `getDb`/`DEFAULT_DB_PATH` imports + `ensureDbPrimed` shim
- `apps/webapp/tests/e2e/fixtures.ts`, `apps/webapp/playwright.config.ts` — swap SQLite file copy for `truncatePg()` + PG seed
- `mcp-servers/experiment/src/index.ts` — drop SQLite path resolution
- `mcp-servers/orchestrator/src/integration.test.ts`, `eager.test.ts`, `resolve.test.ts` — switch to `truncatePg()`
- `vitest.config.ts` — remove `node:sqlite` external; add `singleFork: true` + `sequence.concurrent: false`
- `package.json` (root) — `db:push` aggregate
- `.gitignore` — drop `data/*.sqlite*` lines
- `ARCHITECTURE.md`, `README.md`, `RESUME.md`, `TASKS.md` — text edits
- `docs/decisions/008-analytics-and-bandit.md`, `021-local-store-supersedes-notion.md`, `022-claim-check-worker-output.md` — append "Superseded by E-034" footer

### Deleted files
- `packages/orchestrator/src/migrations/001_orchestrator.sql`
- `packages/orchestrator/src/migrations/postgres/001_step_results.sql`
- `packages/orchestrator/src/migrations/postgres/002_input_refs.sql`
- `packages/analytics/src/migrations/001_init.sql`
- `data/engineerdad.sqlite`, `data/engineerdad.sqlite-shm`, `data/engineerdad.sqlite-wal` (filesystem only)

---

## Pre-flight

- [ ] **Step 0a: Confirm branch and clean working tree**

```bash
git branch --show-current
git status --short
```
Expected: `e-034-sunset-sqlite`, clean tree (the spec doc commit `cdc0fc2` already landed).

- [ ] **Step 0b: Confirm Postgres is up and both DBs exist**

```bash
docker ps --format '{{.Names}}' | grep engineerdad-postgres
docker exec -i engineerdad-postgres psql -U engineerdad -lqt | grep -E "engineerdad(_test)?"
```
Expected: container running; both `engineerdad` and `engineerdad_test` listed. If missing: `pnpm store:up`.

- [ ] **Step 0c: Confirm baseline tests pass before any changes**

```bash
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test pnpm test 2>&1 | tail -5
```
Expected: most tests pass; the two pre-existing failures from the baseline (one `static-renderer` flake, one `mcp-servers/orchestrator` integration assertion) are acknowledged starting state — NOT caused by this branch.

---

## COMMIT 1 — Introduce truncate-pg helper; migrate existing PG tests

Lands the shared helper, migrates the four existing PG-touching test files off owned-id cleanup, and flips the root vitest config to serial. No SQLite changes yet — pure standardization.

### Task 1.1: Create the truncate-pg helper

**Files:**
- Create: `packages/shared/src/test-helpers/truncate-pg.ts`
- Create: `packages/shared/src/test-helpers/index.ts`
- Modify: `packages/shared/src/index.ts` (add re-export)
- Modify: `packages/shared/package.json` (add `postgres` dep, add `./test-helpers` export)
- Modify: `packages/shared/tsconfig.json` if `composite: true` needs path updates (likely no change)

- [ ] **Step 1.1.1: Add the helper file**

Create `packages/shared/src/test-helpers/truncate-pg.ts`:

```ts
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
```

NOTE: tables in the `orchestrator` and `analytics` schemas do not exist yet at this commit. The helper will FAIL at runtime if called before commits 2 + 4 create them. That is fine — the only tests that import the helper *in commit 1* are store and orchestrator-postgres tests, and the TRUNCATE statement is one transaction; if any referenced table is missing PG aborts the whole statement.

**Mitigation in commit 1:** ship a shorter table list now, expand it in commits 2 and 4.

- [ ] **Step 1.1.2: Restrict the table list to what exists in commit 1**

Edit `packages/shared/src/test-helpers/truncate-pg.ts` so the TRUNCATE only references tables that exist today:

```ts
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
      orchestrator.step_results
    RESTART IDENTITY CASCADE
  `);
```

Commits 2, 4 will add lines back as schemas land.

- [ ] **Step 1.1.3: Create the barrel**

Create `packages/shared/src/test-helpers/index.ts`:

```ts
export { truncatePg, closeTruncatePg } from "./truncate-pg.js";
```

- [ ] **Step 1.1.4: Wire the export**

Modify `packages/shared/package.json` to add `postgres` dep and a `./test-helpers` export.

Add to `dependencies`:
```json
"postgres": "^3.4.5",
```

Add to `exports`:
```json
"./test-helpers": {
  "types": "./dist/test-helpers/index.d.ts",
  "import": "./dist/test-helpers/index.js"
}
```

- [ ] **Step 1.1.5: Install + build shared**

```bash
pnpm install
pnpm --filter @engineerdad/shared build
```
Expected: `dist/test-helpers/{truncate-pg,index}.js` exist.

- [ ] **Step 1.1.6: Smoke-test the helper directly**

```bash
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test \
  node -e "import('@engineerdad/shared/test-helpers').then(m => m.truncatePg().then(() => m.closeTruncatePg()).then(() => console.log('OK')))"
```
Expected: `OK` printed; no PG errors.

### Task 1.2: Migrate store tests off local truncateAll

**Files:**
- Modify: `packages/store/src/crud.test.ts`
- Modify: `packages/store/src/compliance.test.ts`
- Modify: `packages/store/src/filters.test.ts`
- Modify: `packages/store/package.json` (add `@engineerdad/shared` workspace dep if not present)

- [ ] **Step 1.2.1: Confirm shared is a dep of store**

```bash
grep -A2 '"dependencies"' packages/store/package.json
```
If `@engineerdad/shared` is not listed, add it: `"@engineerdad/shared": "workspace:*",` and `pnpm install`.

- [ ] **Step 1.2.2: Replace the local truncateAll in crud.test.ts**

In `packages/store/src/crud.test.ts`, replace the existing `truncateAll` helper + `beforeEach` block (lines 1-18 approximately) with:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "./db.js";
import { makeCrud } from "./crud.js";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";

beforeEach(async () => {
  await truncatePg();
});

afterAll(async () => {
  await closeTruncatePg();
});
```

Remove the now-unused `import { sql } from "drizzle-orm";` if `sql` is not referenced elsewhere in the file. Check with `grep -n "sql\`" packages/store/src/crud.test.ts` — if any `sql\`...\`` template usage remains, keep the import.

- [ ] **Step 1.2.3: Repeat for compliance.test.ts and filters.test.ts**

Apply the same change to `packages/store/src/compliance.test.ts` and `packages/store/src/filters.test.ts`. Each likely has its own `truncateAll` clone or inline TRUNCATE — replace with the helper.

- [ ] **Step 1.2.4: Run store tests**

```bash
pnpm --filter @engineerdad/store test 2>&1 | tail -10
```
Expected: all store tests pass.

### Task 1.3: Migrate orchestrator-postgres test off owned-id cleanup

**Files:**
- Modify: `packages/orchestrator/src/postgres.test.ts`
- Modify: `packages/orchestrator/package.json` (add `@engineerdad/shared` if absent)

- [ ] **Step 1.3.1: Confirm shared is a dep**

```bash
grep '"@engineerdad/shared"' packages/orchestrator/package.json
```
Already present per current package.json — proceed.

- [ ] **Step 1.3.2: Rewrite the test setup**

In `packages/orchestrator/src/postgres.test.ts`, replace the existing import block + `OWNED_RUN_IDS` + `cleanOwned()` + `beforeEach`/`afterAll` (roughly lines 1-45) with:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  writeStepResult,
  loadPayload,
  closePostgres,
  StepResultNotFoundError,
  getOrchestratorSql,
} from "./postgres.js";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";

beforeEach(async () => {
  await truncatePg();
});

afterAll(async () => {
  await closeTruncatePg();
  await closePostgres();
});
```

Delete `OWNED_RUN_IDS`, `admin` client, `cleanOwned()`. The body of each `it(...)` should remain unchanged.

- [ ] **Step 1.3.3: Run postgres.test.ts**

```bash
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test \
  pnpm vitest run packages/orchestrator/src/postgres.test.ts 2>&1 | tail -10
```
Expected: all tests pass.

### Task 1.4: Flip root vitest config to serial

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 1.4.1: Read current config**

```bash
cat vitest.config.ts
```

- [ ] **Step 1.4.2: Add singleFork + concurrent:false**

Edit `vitest.config.ts` to:

```ts
import { defineConfig } from "vitest/config";

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
    // disables within-file parallelism. Removing the node:sqlite external
    // is deferred to commit 7 to keep this commit a pure test refactor.
    poolOptions: { forks: { singleFork: true } },
    sequence: { concurrent: false },
    server: {
      deps: {
        external: ["node:sqlite", /^node:/],
      },
    },
  },
});
```

- [ ] **Step 1.4.3: Run full suite**

```bash
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test \
  pnpm test 2>&1 | tail -10
```
Expected: same pass/fail count as baseline (1 pre-existing failure in `mcp-servers/orchestrator/integration.test.ts`, 1 `apps/webapp/orchestrator.test.ts` server-only failure). Total wall-clock now ~17-20s vs baseline ~14s.

### Task 1.5: Commit 1

- [ ] **Step 1.5.1: Stage + commit**

```bash
git add packages/shared packages/store/src/{crud,compliance,filters}.test.ts \
        packages/orchestrator/src/postgres.test.ts \
        packages/orchestrator/package.json \
        vitest.config.ts pnpm-lock.yaml
git status
```

Then:
```bash
git commit -m "$(cat <<'EOF'
chore(test): introduce truncate-pg helper; migrate existing PG tests

Adds packages/shared/src/test-helpers/truncate-pg.ts as the single
canonical TRUNCATE helper. Migrates store + orchestrator-postgres
tests off owned-id cleanup and onto the helper.

Flips root vitest config to singleFork:true + sequence.concurrent:false
so truncate-all is safe across the whole suite. The node:sqlite external
stays for now — removed in commit 7.

No SQLite code changes. Pure test standardization.

Refs: E-034 spec §6 commit 1.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## COMMIT 2 — Drizzle schema for orchestrator (runs, run_steps + port step_results)

Add `packages/orchestrator/src/schema.ts` + `src/db.ts`. Port `step_results` from raw SQL to Drizzle. Delete the three raw `.sql` migrations. `state.ts` still on SQLite at this commit — only the PG schema surface changes.

### Task 2.1: Add Drizzle dev deps to orchestrator

**Files:**
- Modify: `packages/orchestrator/package.json`

- [ ] **Step 2.1.1: Add deps**

Add to `packages/orchestrator/package.json`:

```json
"dependencies": {
  ...existing...,
  "drizzle-orm": "^0.36.0"
},
"devDependencies": {
  "drizzle-kit": "^0.28.0"
}
```

Swap the `db:push` script from the raw psql loop to:

```json
"push": "drizzle-kit push",
"db:push": "drizzle-kit push"
```

(Keep `db:push` name for compatibility with root `pnpm orchestrator:push`.)

- [ ] **Step 2.1.2: Install**

```bash
pnpm install
```

### Task 2.2: Author the Drizzle schema

**Files:**
- Create: `packages/orchestrator/src/schema.ts`

- [ ] **Step 2.2.1: Write the schema**

Create `packages/orchestrator/src/schema.ts`:

```ts
// E-034 — orchestrator's PG-resident state. Single source of truth for
// the orchestrator schema; consumed by db.ts (runtime) and drizzle-kit
// (migrations).
import {
  pgSchema, text, integer, jsonb, timestamp, bigint, uniqueIndex, index, primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const orchestratorSchema = pgSchema("orchestrator");

/** Run header — created at run start, mutated by setRunStage. */
export const runs = orchestratorSchema.table("runs", {
  id: text("id").primaryKey(),
  stage: text("stage").notNull(),
  status: text("status").notNull(),
  params: jsonb("params"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Per-step state, keyed (runId, stepId). Upserted by the engine. */
export const runSteps = orchestratorSchema.table(
  "run_steps",
  {
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    stepId: text("step_id").notNull(),
    stage: text("stage").notNull(),
    status: text("status").notNull(),
    result: jsonb("result"),
    problems: jsonb("problems").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    attempts: integer("attempts").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.runId, t.stepId] }),
    runIdx: index("run_steps_run_idx").on(t.runId),
  }),
);

/** Claim-check store — ADR-022 (output) + ADR-024 (input). Schema unchanged
 *  from the raw SQL migrations; re-expressed in Drizzle so push owns it. */
export const stepResults = orchestratorSchema.table(
  "step_results",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    stepId: text("step_id").notNull(),
    unitIndex: integer("unit_index"),
    payload: jsonb("payload").notNull(),
    payloadKind: text("payload_kind"),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    runStepIdx: index("step_results_run_step_idx").on(t.runId, t.stepId),
    // Partial unique index for input idempotency (ADR-024). Drizzle's
    // .where() on uniqueIndex generates the partial predicate.
    inputIdempotency: uniqueIndex("step_results_input_idempotency_idx")
      .on(t.runId, t.stepId, t.unitIndex, t.payloadKind)
      .where(sql`${t.payloadKind} IS NOT NULL`),
  }),
);
```

### Task 2.3: Add the Drizzle db client

**Files:**
- Create: `packages/orchestrator/src/db.ts`

- [ ] **Step 2.3.1: Write the client**

Create `packages/orchestrator/src/db.ts`:

```ts
// E-034 — singleton Drizzle client over postgres.js. Replaces the
// SQLite getDb() in state.ts and the standalone client cache in postgres.ts.
// One pool per process, shared across orchestrator.runs / .run_steps / .step_results.
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
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
```

### Task 2.4: Add drizzle-kit config

**Files:**
- Create: `packages/orchestrator/drizzle.config.ts`

- [ ] **Step 2.4.1: Write the config**

Create `packages/orchestrator/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

const DATABASE_URL = process.env.DATABASE_URL
  ?? "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad";

export default defineConfig({
  schema: "./src/schema.ts",
  dialect: "postgresql",
  schemaFilter: ["orchestrator"],
  dbCredentials: { url: DATABASE_URL },
});
```

### Task 2.5: Repoint postgres.ts at the shared client

**Files:**
- Modify: `packages/orchestrator/src/postgres.ts`

- [ ] **Step 2.5.1: Replace the standalone `client()` with `getSql()`**

In `packages/orchestrator/src/postgres.ts`, replace the existing `let cached: Sql | undefined;` + `client()` function (top of file) with a thin alias:

```ts
import { getSql, closeDb } from "./db.js";

/** Backward-compatible alias — postgres.ts callers continue to use this name. */
function client() {
  return getSql();
}
```

Delete the original `let cached: Sql | undefined;` and `client()` implementation that did `cached = postgres(url, { max: 5 })`.

- [ ] **Step 2.5.2: Replace `closePostgres` with a thin alias**

Find the existing `closePostgres` export. Replace its body with:

```ts
export async function closePostgres(): Promise<void> {
  await closeDb();
}
```

(Keep the export name for backward compat; commit 7 may rename callers.)

- [ ] **Step 2.5.3: Run `pnpm --filter @engineerdad/orchestrator build`**

```bash
pnpm --filter @engineerdad/orchestrator build
```
Expected: success. TS catches any missed import.

### Task 2.6: Apply Drizzle schema to PG (both dbs)

**Files:** none (DB-side operation)

- [ ] **Step 2.6.1: Drop the existing orchestrator schema in both DBs (clean slate)**

```bash
docker exec -i engineerdad-postgres psql -U engineerdad -d engineerdad \
  -c "DROP SCHEMA IF EXISTS orchestrator CASCADE;"
docker exec -i engineerdad-postgres psql -U engineerdad -d engineerdad_test \
  -c "DROP SCHEMA IF EXISTS orchestrator CASCADE;"
```
Expected: `DROP SCHEMA`.

- [ ] **Step 2.6.2: Push Drizzle schema to both DBs**

```bash
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad \
  pnpm --filter @engineerdad/orchestrator db:push
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test \
  pnpm --filter @engineerdad/orchestrator db:push
```
Expected: drizzle-kit reports `Changes applied`. Both dbs now have `orchestrator.runs`, `.run_steps`, `.step_results` with indices.

- [ ] **Step 2.6.3: Verify schema**

```bash
docker exec -i engineerdad-postgres psql -U engineerdad -d engineerdad_test \
  -c "\dt orchestrator.*"
```
Expected: three tables — runs, run_steps, step_results.

### Task 2.7: Expand truncate-pg to include orchestrator tables

**Files:**
- Modify: `packages/shared/src/test-helpers/truncate-pg.ts`
- Build: `packages/shared`

- [ ] **Step 2.7.1: Add the three orchestrator tables back into TRUNCATE**

Edit `packages/shared/src/test-helpers/truncate-pg.ts`. The TRUNCATE statement becomes:

```ts
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
      orchestrator.runs,
      orchestrator.run_steps,
      orchestrator.step_results
    RESTART IDENTITY CASCADE
  `);
```

- [ ] **Step 2.7.2: Rebuild shared**

```bash
pnpm --filter @engineerdad/shared build
```

### Task 2.8: Delete the three raw SQL migration files

**Files:**
- Delete: `packages/orchestrator/src/migrations/001_orchestrator.sql`
- Delete: `packages/orchestrator/src/migrations/postgres/001_step_results.sql`
- Delete: `packages/orchestrator/src/migrations/postgres/002_input_refs.sql`

- [ ] **Step 2.8.1: Remove the files**

```bash
git rm packages/orchestrator/src/migrations/001_orchestrator.sql
git rm packages/orchestrator/src/migrations/postgres/001_step_results.sql
git rm packages/orchestrator/src/migrations/postgres/002_input_refs.sql
# remove the now-empty postgres directory if it's empty
rmdir packages/orchestrator/src/migrations/postgres 2>/dev/null || true
```

Note: `state.ts` still imports `001_orchestrator.sql` for the *SQLite* migration apply. **It will NOT compile after this delete.** That's expected — commit 3 ports state.ts. Instead of deleting in commit 2, keep `001_orchestrator.sql` until commit 3 deletes it together with state.ts cleanup.

Revised step:

```bash
# Delete only the PG ones — the SQLite one waits for commit 3.
git rm packages/orchestrator/src/migrations/postgres/001_step_results.sql
git rm packages/orchestrator/src/migrations/postgres/002_input_refs.sql
rmdir packages/orchestrator/src/migrations/postgres 2>/dev/null || true
```

- [ ] **Step 2.8.2: Update orchestrator's build script (it cp's migrations/)**

Look at `packages/orchestrator/package.json` build script:

```
"build": "tsc -p tsconfig.json && node -e \"require('node:fs').cpSync('src/migrations','dist/migrations',{recursive:true})\""
```

The cp will still work (copies `001_orchestrator.sql`); no change needed at this commit. Commit 3 drops the cp call when state.ts no longer needs it.

### Task 2.9: Verify full suite still passes

- [ ] **Step 2.9.1: Build everything sequentially**

```bash
pnpm -r build
```
Expected: success.

- [ ] **Step 2.9.2: Run full tests**

```bash
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test pnpm test 2>&1 | tail -10
```
Expected: same pass/fail count as commit 1.

### Task 2.10: Commit 2

- [ ] **Step 2.10.1: Stage + commit**

```bash
git add packages/orchestrator/src/schema.ts \
        packages/orchestrator/src/db.ts \
        packages/orchestrator/src/postgres.ts \
        packages/orchestrator/drizzle.config.ts \
        packages/orchestrator/package.json \
        packages/shared/src/test-helpers/truncate-pg.ts \
        pnpm-lock.yaml
git status

git commit -m "$(cat <<'EOF'
feat(orchestrator): drizzle schema for runs/run_steps + port step_results

Adds packages/orchestrator/src/schema.ts (Drizzle pgSchema) and src/db.ts
(singleton client) as the single source of truth for the orchestrator
schema. step_results migrates from raw SQL files to Drizzle; runs and
run_steps land as new Drizzle tables (state.ts still on SQLite at this
commit — porting follows in commit 3).

Deletes the two raw step_results migration .sql files. drizzle-kit push
now owns the orchestrator schema.

Refs: E-034 spec §6 commit 2.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## COMMIT 3 — Port state.ts to Postgres; switch webapp + MCP lib

Gut `state.ts` to use `getDb()` with Drizzle queries. Same public API. Migrate engine/state tests and webapp orchestrator lib.

### Task 3.1: Rewrite state.ts

**Files:**
- Modify: `packages/orchestrator/src/state.ts` (full rewrite)
- Delete: `packages/orchestrator/src/migrations/001_orchestrator.sql`
- Modify: `packages/orchestrator/package.json` (drop migrations cp from build)
- Modify: `packages/orchestrator/src/index.ts` (drop DEFAULT_DB_PATH re-export)

- [ ] **Step 3.1.1: Replace state.ts contents**

Overwrite `packages/orchestrator/src/state.ts` with:

```ts
// E-034 — Postgres-resident run state. Same public API as the prior
// SQLite version (createRun / loadRunState / upsertStep / setRunStage /
// listRuns / resetDbCache); internals now use the shared Drizzle client.
import { eq, sql, desc } from "drizzle-orm";
import { getDb, closeDb, resetDbCache as resetClientCache } from "./db.js";
import { runs, runSteps } from "./schema.js";
import type {
  RunStage, RunStatus, RunState, RunStepState, StepStatus,
} from "./types.js";

/** Test-only: reset module caches (no DB writes). truncatePg() supersedes
 *  the historical SQLite "swap to a temp file path" behavior. */
export function resetDbCache(): void {
  resetClientCache();
}

/** Insert a new run row at the given stage with status "active". */
export async function createRun(
  runId: string,
  stage: RunStage,
  params: Record<string, unknown>,
): Promise<void> {
  await getDb().insert(runs).values({
    id: runId,
    stage,
    status: "active",
    params,
  });
}

/** Join runs + run_steps into a RunState, or null when the run does not exist. */
export async function loadRunState(runId: string): Promise<RunState | null> {
  const db = getDb();
  const runRow = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (runRow.length === 0) return null;
  const stepRows = await db
    .select()
    .from(runSteps)
    .where(eq(runSteps.runId, runId))
    .orderBy(runSteps.updatedAt);
  const steps: RunStepState[] = stepRows.map((r) => ({
    stepId: r.stepId,
    stage: r.stage,
    status: r.status as StepStatus,
    result: r.result ?? null,
    problems: (r.problems ?? []) as string[],
    attempts: r.attempts,
  }));
  return {
    runId: runRow[0].id,
    stage: runRow[0].stage as RunStage,
    status: runRow[0].status as RunStatus,
    params: (runRow[0].params ?? {}) as Record<string, unknown>,
    steps,
  };
}

/** Insert-or-replace a run_steps row, keyed on (runId, stepId). */
export async function upsertStep(runId: string, step: RunStepState): Promise<void> {
  await getDb()
    .insert(runSteps)
    .values({
      runId,
      stepId: step.stepId,
      stage: step.stage,
      status: step.status,
      result: step.result ?? null,
      problems: step.problems as string[],
      attempts: step.attempts,
    })
    .onConflictDoUpdate({
      target: [runSteps.runId, runSteps.stepId],
      set: {
        stage: step.stage,
        status: step.status,
        result: step.result ?? null,
        problems: step.problems as string[],
        attempts: step.attempts,
        updatedAt: sql`now()`,
      },
    });
}

/** Update a run's stage + status. */
export async function setRunStage(
  runId: string, stage: RunStage, status: RunStatus,
): Promise<void> {
  await getDb()
    .update(runs)
    .set({ stage, status, updatedAt: sql`now()` })
    .where(eq(runs.id, runId));
}

export interface RunSummary {
  runId: string;
  stage: RunStage;
  status: RunStatus;
  stepCount: number;
  createdAt: number;   // epoch ms — preserved shape for callers
  updatedAt: number;
}

/** All runs, newest first — the input to /status. */
export async function listRuns(): Promise<RunSummary[]> {
  const rows = await getDb().execute(sql`
    SELECT r.id, r.stage, r.status, r.created_at, r.updated_at,
           (SELECT COUNT(*) FROM orchestrator.run_steps s WHERE s.run_id = r.id) AS step_count
    FROM orchestrator.runs r
    ORDER BY r.created_at DESC
  `);
  return (rows as unknown as Array<{
    id: string; stage: string; status: string;
    created_at: Date; updated_at: Date; step_count: string;
  }>).map((r) => ({
    runId: r.id,
    stage: r.stage as RunStage,
    status: r.status as RunStatus,
    stepCount: Number(r.step_count),
    createdAt: r.created_at.getTime(),
    updatedAt: r.updated_at.getTime(),
  }));
}

/** Async-aware close for tests' afterAll. */
export { closeDb };
```

⚠️ **API SHAPE CHANGE:** All five mutating functions (`createRun`, `upsertStep`, `setRunStage`) and the two readers (`loadRunState`, `listRuns`) become **async** (return `Promise<…>`). This is a load-bearing change for callers in `engine.ts` and the webapp lib.

- [ ] **Step 3.1.2: Find all callers and add `await`**

```bash
rg -n "createRun\(|loadRunState\(|upsertStep\(|setRunStage\(|listRuns\(" --type ts \
  packages mcp-servers apps
```
For each match: if the caller is in an `async` function and is using the result, add `await`. If the caller is synchronous, mark the caller `async` (and propagate upward).

Concretely: `packages/orchestrator/src/engine.ts` is the main caller. Open it and convert call sites. Likely already async because it does I/O.

- [ ] **Step 3.1.3: Build orchestrator package**

```bash
pnpm --filter @engineerdad/orchestrator build 2>&1 | tail -30
```
Expected: success. TS will surface any missed `await`.

- [ ] **Step 3.1.4: Run state.test.ts**

State tests likely import + invoke the functions directly. Open `packages/orchestrator/src/state.test.ts` and convert any non-async test bodies to async (Vitest accepts async test fns).

Run:
```bash
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test \
  pnpm vitest run packages/orchestrator/src/state.test.ts 2>&1 | tail -20
```

Expected: errors point to missing `await`s in test code. Fix them. Rerun until green.

- [ ] **Step 3.1.5: Replace test setup with truncatePg**

In `packages/orchestrator/src/state.test.ts`, ensure the top of the file has:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";
import { closeDb } from "./db.js";

beforeEach(async () => { await truncatePg(); });
afterAll(async () => { await closeTruncatePg(); await closeDb(); });
```

Delete any pre-existing temp-SQLite priming (`tempfile`, `getDb(tempPath)`, `resetDbCache()` calls).

### Task 3.2: Migrate engine tests

**Files:**
- Modify: `packages/orchestrator/src/engine.test.ts`
- Modify: `packages/orchestrator/src/engine.integration.test.ts`
- Modify: `packages/orchestrator/src/engine.gate.integration.test.ts`

- [ ] **Step 3.2.1: Apply the same setup pattern to all three**

For each of the three engine test files, replace the existing setup (temp SQLite file paths, `getDb(tempPath)`, `resetDbCache`) with:

```ts
import { beforeEach, afterAll } from "vitest";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";
import { closeDb } from "../src/db.js"; // adjust path

beforeEach(async () => { await truncatePg(); });
afterAll(async () => { await closeTruncatePg(); await closeDb(); });
```

Find each test body: any test that previously seeded SQLite via `getDb(tempPath).prepare(...).run(...)` should now use the public API (`createRun`, `upsertStep`).

- [ ] **Step 3.2.2: Run each file**

```bash
for f in engine.test engine.integration.test engine.gate.integration.test state.test; do
  echo "=== $f ==="
  DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test \
    pnpm vitest run packages/orchestrator/src/$f.ts 2>&1 | tail -3
done
```
Expected: all pass.

### Task 3.3: Switch webapp orchestrator lib

**Files:**
- Modify: `apps/webapp/src/app/lib/orchestrator.ts`

- [ ] **Step 3.3.1: Drop SQLite imports**

In `apps/webapp/src/app/lib/orchestrator.ts`, find the import block (lines ~1-15):

```ts
import {
  listRuns as _listRuns,
  loadRunState,
  getDb,
  DEFAULT_DB_PATH,
  loadPayload,
  type RunStatus,
  type StepStatus,
} from "@engineerdad/orchestrator";
```

Replace with:

```ts
import {
  listRuns as _listRuns,
  loadRunState,
  loadPayload,
  type RunStatus,
  type StepStatus,
} from "@engineerdad/orchestrator";
```

- [ ] **Step 3.3.2: Remove the `ensureDbPrimed` helper**

Find the `ensureDbPrimed()` function definition (header comment about `ENGINEERDAD_SQLITE_DB`). Delete the function and every call site within this file. Postgres needs no priming — `DATABASE_URL` is the only signal.

- [ ] **Step 3.3.3: Find any other webapp SQLite references**

```bash
rg "node:sqlite|DEFAULT_DB_PATH|engineerdad\.sqlite|ENGINEERDAD_SQLITE_DB" apps/webapp/src apps/webapp/tests
```
Address each hit. The webapp's `/status`, `/review/<entity>`, and run-detail pages should all flow through `loadRunState` + `listRuns` from the package.

- [ ] **Step 3.3.4: Build webapp**

```bash
pnpm --filter webapp build 2>&1 | tail -15
```
(Webapp filter name may differ; check `apps/webapp/package.json`.)
Expected: success.

- [ ] **Step 3.3.5: Smoke /status**

```bash
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test \
  pnpm --filter webapp dev &
WEBAPP_PID=$!
sleep 4
curl -s http://localhost:3030/status | head -50
kill $WEBAPP_PID
```
Expected: status page renders (HTML), no 500.

### Task 3.4: Migrate MCP server tests

**Files:**
- Modify: `mcp-servers/orchestrator/src/integration.test.ts`
- Modify: `mcp-servers/orchestrator/src/eager.test.ts`
- Modify: `mcp-servers/orchestrator/src/resolve.test.ts`

- [ ] **Step 3.4.1: Apply the standard setup**

Same pattern as engine tests. Each file gets:

```ts
import { beforeEach, afterAll } from "vitest";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";
import { closeDb } from "@engineerdad/orchestrator";

beforeEach(async () => { await truncatePg(); });
afterAll(async () => { await closeTruncatePg(); await closeDb(); });
```

Remove any per-test SQLite priming.

- [ ] **Step 3.4.2: Run each**

```bash
for f in integration.test eager.test resolve.test; do
  echo "=== $f ==="
  DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test \
    pnpm vitest run mcp-servers/orchestrator/src/$f.ts 2>&1 | tail -3
done
```

### Task 3.5: Delete the SQLite migration + drop the build cp

**Files:**
- Delete: `packages/orchestrator/src/migrations/001_orchestrator.sql`
- Modify: `packages/orchestrator/package.json` (drop `cpSync` from build script)
- Delete: `packages/orchestrator/src/migrations/` (directory if empty)

- [ ] **Step 3.5.1: Remove the SQLite migration**

```bash
git rm packages/orchestrator/src/migrations/001_orchestrator.sql
rmdir packages/orchestrator/src/migrations 2>/dev/null || true
```

- [ ] **Step 3.5.2: Simplify the build script**

Edit `packages/orchestrator/package.json`:

```json
"build": "tsc -p tsconfig.json",
```

(Drop the `node -e "require('node:fs').cpSync(...)"` suffix.)

- [ ] **Step 3.5.3: Re-export shape — drop `DEFAULT_DB_PATH`**

Check `packages/orchestrator/src/index.ts`:

```bash
grep -n "DEFAULT_DB_PATH" packages/orchestrator/src/*.ts
```

If `DEFAULT_DB_PATH` was exported via `export * from "./state.js"`, the new state.ts no longer defines it — re-exports become no-ops. No edit needed unless an explicit re-export exists.

### Task 3.6: Full suite

- [ ] **Step 3.6.1: Build everything**

```bash
pnpm -r build 2>&1 | tail -5
```

- [ ] **Step 3.6.2: Run full tests**

```bash
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test pnpm test 2>&1 | tail -8
```
Expected: orchestrator + webapp tests now hit PG. Same baseline-known failures or fewer.

### Task 3.7: Commit 3

- [ ] **Step 3.7.1: Stage + commit**

```bash
git add packages/orchestrator/src/state.ts \
        packages/orchestrator/src/engine.ts \
        packages/orchestrator/src/state.test.ts \
        packages/orchestrator/src/engine.test.ts \
        packages/orchestrator/src/engine.integration.test.ts \
        packages/orchestrator/src/engine.gate.integration.test.ts \
        packages/orchestrator/package.json \
        packages/orchestrator/src/index.ts \
        apps/webapp/src/app/lib/orchestrator.ts \
        mcp-servers/orchestrator/src
git status

git commit -m "$(cat <<'EOF'
feat(orchestrator): port state.ts to postgres; switch webapp + MCP lib

state.ts internals swap from node:sqlite to the Drizzle client added in
commit 2. Public API is the same names but now async — createRun /
loadRunState / upsertStep / setRunStage / listRuns all return Promises.
Callers in engine.ts, webapp lib, and MCP servers updated with await.

Webapp orchestrator lib drops ensureDbPrimed and DEFAULT_DB_PATH.

Removes the last SQLite migration in orchestrator (001_orchestrator.sql)
and drops migrations/ cpSync from build script.

Refs: E-034 spec §6 commit 3.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## COMMIT 4 — Drizzle schema for analytics

Schema-only commit. Adds `analytics.schema.ts` + Drizzle config + creates the PG schema. Analytics call sites still on SQLite at this commit.

### Task 4.1: Add Drizzle deps to analytics

**Files:**
- Modify: `packages/analytics/package.json`

- [ ] **Step 4.1.1: Add deps**

```json
"dependencies": {
  "@engineerdad/shared": "workspace:*",
  "drizzle-orm": "^0.36.0",
  "postgres": "^3.4.5",
  "zod": "^3.23.8"
},
"devDependencies": {
  "drizzle-kit": "^0.28.0"
},
"scripts": {
  ...
  "push": "drizzle-kit push",
  "db:push": "drizzle-kit push"
}
```

- [ ] **Step 4.1.2: Install**

```bash
pnpm install
```

### Task 4.2: Author analytics schema

**Files:**
- Create: `packages/analytics/src/schema.ts`

- [ ] **Step 4.2.1: Write the schema**

Create `packages/analytics/src/schema.ts`:

```ts
// E-034 — analytics signals + bandit state, Postgres-resident.
// Single source of truth for the analytics schema; consumed by db.ts (runtime)
// and drizzle-kit (migrations).
//
// Type-lift notes vs the prior SQLite schema:
//   - JSON TEXT columns lift to jsonb (raw_json, payload_json).
//   - epoch-ms INTEGER `ts` columns stay as bigint, NOT timestamptz —
//     bandit decay math and time-window queries operate on numeric ms.
//   - AUTOINCREMENT INTEGER PK becomes bigserial.
import {
  pgSchema, text, integer, real, jsonb, bigint, bigserial, primaryKey, uniqueIndex, index,
} from "drizzle-orm/pg-core";

export const analyticsSchema = pgSchema("analytics");

export const metaInsights = analyticsSchema.table(
  "meta_insights",
  {
    date: text("date").notNull(),
    adId: text("ad_id").notNull(),
    adsetId: text("adset_id"),
    campaignId: text("campaign_id"),
    spend: real("spend"),
    impressions: integer("impressions"),
    clicks: integer("clicks"),
    ctr: real("ctr"),
    cpm: real("cpm"),
    leads: integer("leads"),
    purchases: integer("purchases"),
    value: real("value"),
    avgWatchSec: real("avg_watch_sec"),
    rawJson: jsonb("raw_json"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.date, t.adId] }),
    adIdx: index("meta_insights_ad_idx").on(t.adId),
    dateIdx: index("meta_insights_date_idx").on(t.date),
  }),
);

export const creatives = analyticsSchema.table("creatives", {
  adId: text("ad_id").primaryKey(),
  name: text("name"),
  hook: text("hook"),
  angle: text("angle"),
  persona: text("persona"),
  format: text("format"),
  language: text("language"),
  briefPageId: text("brief_page_id"),
  variantPageId: text("variant_page_id"),
  launchedAt: text("launched_at"),
});

export const events = analyticsSchema.table(
  "events",
  {
    id: text("id").primaryKey(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    eventName: text("event_name").notNull(),
    source: text("source"),
    payloadJson: jsonb("payload_json"),
  },
  (t) => ({
    tsIdx: index("events_ts_idx").on(t.ts),
    nameIdx: index("events_name_idx").on(t.eventName),
  }),
);

export const angleTags = analyticsSchema.table(
  "angle_tags",
  {
    adId: text("ad_id").notNull(),
    tagKind: text("tag_kind").notNull(),
    tagValue: text("tag_value").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.adId, t.tagKind, t.tagValue] }),
    kindIdx: index("angle_tags_kind_idx").on(t.tagKind, t.tagValue),
  }),
);

export const creativeSignals = analyticsSchema.table(
  "creative_signals",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    variantId: text("variant_id").notNull(),
    channel: text("channel").notNull(),
    platform: text("platform"),
    kpiName: text("kpi_name").notNull(),
    kpiValue: real("kpi_value").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    source: text("source").notNull(),
  },
  (t) => ({
    unique: uniqueIndex("creative_signals_dedup_idx")
      .on(t.variantId, t.channel, t.platform, t.kpiName, t.ts),
    variantIdx: index("creative_signals_variant_idx").on(t.variantId),
    channelTsIdx: index("creative_signals_channel_ts_idx").on(t.channel, t.ts),
  }),
);
```

### Task 4.3: Add drizzle-kit config

**Files:**
- Create: `packages/analytics/drizzle.config.ts`

- [ ] **Step 4.3.1: Write the config**

```ts
import { defineConfig } from "drizzle-kit";

const DATABASE_URL = process.env.DATABASE_URL
  ?? "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad";

export default defineConfig({
  schema: "./src/schema.ts",
  dialect: "postgresql",
  schemaFilter: ["analytics"],
  dbCredentials: { url: DATABASE_URL },
});
```

### Task 4.4: Apply analytics schema to both DBs

- [ ] **Step 4.4.1: Push schema to engineerdad**

```bash
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad \
  pnpm --filter @engineerdad/analytics db:push
```
Expected: `Changes applied`.

- [ ] **Step 4.4.2: Push schema to engineerdad_test**

```bash
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test \
  pnpm --filter @engineerdad/analytics db:push
```

- [ ] **Step 4.4.3: Verify**

```bash
docker exec -i engineerdad-postgres psql -U engineerdad -d engineerdad_test \
  -c "\dt analytics.*"
```
Expected: 5 tables — meta_insights, creatives, events, angle_tags, creative_signals.

### Task 4.5: Expand truncate-pg

**Files:**
- Modify: `packages/shared/src/test-helpers/truncate-pg.ts`

- [ ] **Step 4.5.1: Add analytics tables to TRUNCATE**

```ts
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
```

- [ ] **Step 4.5.2: Rebuild shared**

```bash
pnpm --filter @engineerdad/shared build
```

### Task 4.6: Verify suite still passes (analytics still on SQLite)

- [ ] **Step 4.6.1: Run tests**

```bash
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test pnpm test 2>&1 | tail -8
```
Expected: unchanged — analytics call sites still use SQLite at this commit.

### Task 4.7: Commit 4

- [ ] **Step 4.7.1: Stage + commit**

```bash
git add packages/analytics/src/schema.ts \
        packages/analytics/drizzle.config.ts \
        packages/analytics/package.json \
        packages/shared/src/test-helpers/truncate-pg.ts \
        pnpm-lock.yaml

git commit -m "$(cat <<'EOF'
feat(analytics): drizzle schema for events/meta_insights/creatives/angle_tags/signals

Adds packages/analytics/src/schema.ts (Drizzle pgSchema with five tables)
and drizzle.config.ts. `pnpm --filter @engineerdad/analytics db:push` now
materializes the analytics schema in Postgres.

Call sites still on SQLite at this commit — porting follows in commit 5.

Refs: E-034 spec §6 commit 4.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## COMMIT 5 — Port analytics call sites to Postgres

Gut `db.ts`, rewrite all 7 call-site files to use Drizzle / `sql\`\``, migrate tests, delete SQLite migration.

### Task 5.1: Rewrite db.ts

**Files:**
- Modify: `packages/analytics/src/db.ts` (full rewrite)
- Modify: `packages/analytics/src/index.ts` (drop DEFAULT_DB_PATH export)

- [ ] **Step 5.1.1: Replace db.ts**

Overwrite `packages/analytics/src/db.ts` with:

```ts
// E-034 — analytics's PG-resident state. Same public API (getDb, resetDbCache);
// internals now Drizzle over postgres.js. DEFAULT_DB_PATH removed.
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
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
```

- [ ] **Step 5.1.2: Update index.ts re-exports**

In `packages/analytics/src/index.ts`, find:

```ts
export { getDb, resetDbCache, DEFAULT_DB_PATH } from "./db.js";
```

Replace with:

```ts
export { getDb, getSql, resetDbCache, closeDb } from "./db.js";
```

### Task 5.2: Rewrite the call-site files (one task per file)

Each file is small; the engineer should read it, then rewrite SQL strings as Drizzle queries (simple SELECT/INSERT) or `sql\`...\`` template tags (complex aggregations). The decision rule:

- **Simple `SELECT ... FROM ... WHERE`, single-table INSERT/UPDATE → Drizzle query builder** (`db.select().from(...).where(...)`)
- **Aggregations, window functions, time-window math, bandit posterior updates → raw `sql\`...\`` tag** preserving the existing SQL literally

#### Task 5.2.a: bandit.ts

**Files:** `packages/analytics/src/bandit.ts`

- [ ] **Step 5.2.a.1: Read the file end-to-end**

```bash
cat packages/analytics/src/bandit.ts
```

The file has SQL aggregations over `meta_insights` joined with `angle_tags`. Keep them as `sql\`...\`` to preserve the math.

- [ ] **Step 5.2.a.2: Rewrite the import + every getDb usage**

Replace `import { getDb } from "./db.js";` is unchanged. The change is at each `.prepare(...).all()` / `.run()` call.

Old shape (SQLite):
```ts
const db = getDb();
const rows = db.prepare(`SELECT ... FROM meta_insights WHERE ...`).all(...) as Row[];
```

New shape (Drizzle execute):
```ts
import { sql } from "drizzle-orm";
import { getDb } from "./db.js";

const db = getDb();
const rows = await db.execute(sql`SELECT ... FROM analytics.meta_insights WHERE ...`) as unknown as Row[];
```

Two important substitutions throughout:
- Table names: `meta_insights` → `analytics.meta_insights`, `creatives` → `analytics.creatives`, etc. (qualify with schema)
- Every `db.prepare(...).all/get/run(...)` call becomes `await db.execute(sql\`...\`)`. The function containing it becomes `async`.

- [ ] **Step 5.2.a.3: Make all exports async**

`banditAllocate`, `banditUpdate` become `async` and return `Promise<...>`.

- [ ] **Step 5.2.a.4: Build + test**

```bash
pnpm --filter @engineerdad/analytics build 2>&1 | tail -10
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test \
  pnpm vitest run packages/analytics/src/bandit.test.ts 2>&1 | tail -10
```

- [ ] **Step 5.2.a.5: Migrate the bandit test**

In `packages/analytics/src/bandit.test.ts`, replace the setup block (likely seeds SQLite via raw SQL) with:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";
import { closeDb, getDb } from "./db.js";
import { metaInsights, angleTags } from "./schema.js";

beforeEach(async () => { await truncatePg(); });
afterAll(async () => { await closeTruncatePg(); await closeDb(); });
```

For each test that previously seeded data with `db.prepare("INSERT INTO meta_insights ...").run(...)`, use Drizzle inserts:

```ts
await getDb().insert(metaInsights).values({
  date: "2026-05-25", adId: "ad1", spend: 10.0, impressions: 1000, leads: 5, /* ... */
});
```

Run until green.

#### Task 5.2.b: ingest-meta-insights (in tools.ts)

**Files:** `packages/analytics/src/tools.ts` (where `ingestMetaInsights` lives), `packages/analytics/src/__tests__/tools.test.ts` if exists

- [ ] **Step 5.2.b.1: Locate**

```bash
grep -n "ingestMetaInsights\b" packages/analytics/src/*.ts
```

- [ ] **Step 5.2.b.2: Apply the same rewrite pattern**

Convert `INSERT INTO meta_insights ... ON CONFLICT ... DO UPDATE` to either Drizzle's `.insert(metaInsights).values(...).onConflictDoUpdate({ ... })` (cleaner) or a raw `sql\`...\``. Pick whichever produces less code; the upsert shape is straightforward enough for Drizzle.

Make `ingestMetaInsights` `async`.

- [ ] **Step 5.2.b.3: Build**

```bash
pnpm --filter @engineerdad/analytics build 2>&1 | tail -10
```

#### Task 5.2.c: ingest-meta-organic.ts

**Files:** `packages/analytics/src/ingest-meta-organic.ts`, `packages/analytics/src/__tests__/ingest-meta-organic.test.ts`

- [ ] **Step 5.2.c.1: Rewrite call sites**

Same pattern: each `db.prepare(...).run(...)` → `await db.execute(sql\`...\`)` or Drizzle insert. Function becomes async.

- [ ] **Step 5.2.c.2: Migrate test**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";
import { closeDb } from "../db.js";

beforeEach(async () => { await truncatePg(); });
afterAll(async () => { await closeTruncatePg(); await closeDb(); });
```

Seed via Drizzle inserts.

- [ ] **Step 5.2.c.3: Run**

```bash
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test \
  pnpm vitest run packages/analytics/src/__tests__/ingest-meta-organic.test.ts 2>&1 | tail -10
```

#### Task 5.2.d: creative-signals.ts

**Files:** `packages/analytics/src/creative-signals.ts`, `packages/analytics/src/__tests__/creative-signals.test.ts`

- [ ] **Step 5.2.d.1: Rewrite**

Same pattern. `creative_signals` table is in `analytics` schema; the existing UNIQUE constraint maps to the `creative_signals_dedup_idx` defined in schema.ts. Drizzle's `.insert(creativeSignals).values(...).onConflictDoNothing({ target: [...] })` covers the dedup behavior.

- [ ] **Step 5.2.d.2: Migrate test + run**

Same as 5.2.c.2 / 5.2.c.3.

#### Task 5.2.e: cost-per-angle.ts

**Files:** `packages/analytics/src/cost-per-angle.ts` (likely inside `tools.ts`)

- [ ] **Step 5.2.e.1: Rewrite**

This is an aggregation query — keep as raw `sql\`...\`` template, just qualify the table names with `analytics.`. Function becomes async.

#### Task 5.2.f: decay-curve.ts

**Files:** `packages/analytics/src/decay-curve.ts` (likely inside `tools.ts`)

- [ ] **Step 5.2.f.1: Rewrite**

Same as 5.2.e — keep the analytics math as raw `sql\`...\`` literal, async the function.

#### Task 5.2.g: top-creatives.ts

**Files:** `packages/analytics/src/top-creatives.ts` (likely inside `tools.ts`)

- [ ] **Step 5.2.g.1: Rewrite**

Same pattern.

### Task 5.3: Update call sites of all changed analytics exports

The orchestrator and several MCP servers consume these analytics functions. Adding async to the signatures will cascade.

- [ ] **Step 5.3.1: Find consumers**

```bash
rg -n "ingestMetaInsights\(|ingestMetaOrganicInsights\(|banditAllocate\(|banditUpdate\(|costPerAngle\(|decayCurve\(|topCreatives\(|engagementPerAngle\(|upsertCreative\(|logEvent\(" \
  --type ts packages mcp-servers apps
```

- [ ] **Step 5.3.2: Add `await` everywhere**

For each match in `async` functions, prefix with `await`. For non-async callers, propagate async upward (mark them async, await them in turn). Most MCP server tool handlers are already async — minimal cascade expected.

- [ ] **Step 5.3.3: Build everything**

```bash
pnpm -r build 2>&1 | tail -10
```
Expected: success. TS catches missed awaits.

### Task 5.4: Delete the SQLite migration

**Files:**
- Delete: `packages/analytics/src/migrations/001_init.sql`
- Delete: `packages/analytics/src/migrations/` (if empty)
- Modify: `packages/analytics/package.json` (drop cpSync from build)

- [ ] **Step 5.4.1: Remove**

```bash
git rm packages/analytics/src/migrations/001_init.sql
rmdir packages/analytics/src/migrations 2>/dev/null || true
```

- [ ] **Step 5.4.2: Simplify build script**

In `packages/analytics/package.json`:

```json
"build": "tsc -p tsconfig.json",
```

### Task 5.5: Full suite

- [ ] **Step 5.5.1: Build + test**

```bash
pnpm -r build
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test pnpm test 2>&1 | tail -10
```

### Task 5.6: Commit 5

- [ ] **Step 5.6.1: Stage + commit**

```bash
git add packages/analytics/src \
        packages/analytics/package.json \
        packages/orchestrator mcp-servers
git status

git commit -m "$(cat <<'EOF'
feat(analytics): port db.ts + ingest + bandit + signals to postgres

Gut packages/analytics/src/db.ts to use the Drizzle client introduced
in commit 4. Rewrite all call sites (bandit, ingest-meta-insights,
ingest-meta-organic, creative-signals, cost-per-angle, decay-curve,
top-creatives, upsert-creative, log-event) to Drizzle inserts / sql``
template tags against analytics.* tables.

All previously sync analytics exports are now async. Callers in
orchestrator/mcp-servers/apps adjusted with await.

Migrate all analytics tests to truncatePg(). Delete
packages/analytics/src/migrations/001_init.sql. Drop migrations cp
from build script.

Refs: E-034 spec §6 commit 5.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## COMMIT 6 — Port experiment readout reader

### Task 6.1: Gut experiment db.ts

**Files:**
- Modify: `packages/experiment/src/db.ts`
- Modify: `packages/experiment/package.json` (add @engineerdad/analytics dep)

- [ ] **Step 6.1.1: Replace db.ts**

Overwrite `packages/experiment/src/db.ts` with:

```ts
// E-034 — thin shim over @engineerdad/analytics's Drizzle client.
// The experiment readout queries analytics tables read-only; we share
// the same connection pool rather than opening our own.
import { getDb, getSql, closeDb } from "@engineerdad/analytics";

export { getDb, getSql, closeDb };

/** Backward-compat — historical alias used by readout.test.ts. */
export function resetExperimentDbCache(): void {
  // No-op: callers should use truncatePg() / closeDb() now.
}
```

- [ ] **Step 6.1.2: Add workspace dep**

In `packages/experiment/package.json`:

```json
"dependencies": {
  "@engineerdad/analytics": "workspace:*"
}
```

Run:
```bash
pnpm install
```

### Task 6.2: Rewrite readout.ts

**Files:**
- Modify: `packages/experiment/src/readout.ts`

- [ ] **Step 6.2.1: Read the file**

```bash
cat packages/experiment/src/readout.ts
```

- [ ] **Step 6.2.2: Rewrite query call sites**

Same pattern as analytics: `db.prepare("...").all/get(...)` → `await db.execute(sql\`...\`)`. Qualify tables with `analytics.`. The exported readout function becomes async.

```ts
import { sql } from "drizzle-orm";
import { getDb } from "./db.js";

export async function readout(experimentId: string): Promise<ReadoutResult> {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT variant_id, kpi_name, AVG(kpi_value) AS mean_value, COUNT(*) AS n
    FROM analytics.creative_signals
    WHERE variant_id IN (...)
    GROUP BY variant_id, kpi_name
  `);
  // ...rest of math
}
```

### Task 6.3: Migrate readout test

**Files:**
- Modify: `packages/experiment/src/readout.test.ts`

- [ ] **Step 6.3.1: Switch to truncatePg**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";
import { closeDb, getDb } from "./db.js";
import { creativeSignals } from "@engineerdad/analytics/schema"; // if exported; else use sql``

beforeEach(async () => { await truncatePg(); });
afterAll(async () => { await closeTruncatePg(); await closeDb(); });
```

If `creativeSignals` isn't exported from `@engineerdad/analytics`, either export it or seed via `sql\`INSERT INTO analytics.creative_signals ...\``.

- [ ] **Step 6.3.2: Convert any sync `it(...)` test bodies to async + await**

- [ ] **Step 6.3.3: Run**

```bash
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test \
  pnpm vitest run packages/experiment/src/readout.test.ts 2>&1 | tail -10
```

### Task 6.4: Update experiment MCP server

**Files:**
- Modify: `mcp-servers/experiment/src/index.ts`

- [ ] **Step 6.4.1: Drop SQLite path resolution**

```bash
grep -n "node:sqlite\|DEFAULT_DB_PATH\|engineerdad\.sqlite" mcp-servers/experiment/src/index.ts
```

Remove any path-resolution / opener calls; the MCP server just imports `readout` from `@engineerdad/experiment` now.

### Task 6.5: Full suite

- [ ] **Step 6.5.1: Build + test**

```bash
pnpm -r build
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test pnpm test 2>&1 | tail -10
```

### Task 6.6: Commit 6

- [ ] **Step 6.6.1: Stage + commit**

```bash
git add packages/experiment mcp-servers/experiment pnpm-lock.yaml
git status

git commit -m "$(cat <<'EOF'
feat(experiment): port readout reader to postgres analytics schema

packages/experiment/src/db.ts becomes a thin re-export of
@engineerdad/analytics's getDb/getSql/closeDb — one shared pool over
analytics.creative_signals + analytics.meta_insights.

readout.ts queries rewritten to sql`` against analytics.* tables;
readout test migrated to truncatePg().

experiment MCP server drops the SQLite path resolution it used to thread
into the SQLite opener.

Refs: E-034 spec §6 commit 6.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## COMMIT 7 — Cleanup: delete SQLite plumbing, drop deps, write ADR-025, update docs

### Task 7.1: Drop node:sqlite vitest external

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 7.1.1: Edit**

Replace the `server` block in `vitest.config.ts`:

Before:
```ts
    server: {
      deps: {
        external: ["node:sqlite", /^node:/],
      },
    },
```

After: delete the entire `server` block.

### Task 7.2: Delete the data/ SQLite files

**Files:** filesystem only (not git-tracked)

- [ ] **Step 7.2.1: Remove**

```bash
ls -la data/engineerdad.sqlite* 2>&1
rm -f data/engineerdad.sqlite data/engineerdad.sqlite-shm data/engineerdad.sqlite-wal
ls -la data/
```
Expected: `engineerdad.sqlite*` files gone; `data/assets/`, `data/snapshots/`, `data/postgres/`, `data/notion-ids.json` untouched.

### Task 7.3: Clean .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 7.3.1: Remove SQLite lines**

```bash
grep -n "sqlite" .gitignore
```

Remove these three lines (added in commit `41c84d3`):
```
data/*.sqlite-shm
data/*.sqlite-wal
data/engineerdad-test.sqlite
```

Also remove the surrounding comments that became irrelevant (`# but SQLite WAL/SHM are transient (only exist while a connection is open)`, `# Test SQLite is wiped per-test and never useful across machines.`).

### Task 7.4: Verify no remaining SQLite code references

- [ ] **Step 7.4.1: Grep**

```bash
rg "node:sqlite|better-sqlite3" --type ts packages mcp-servers apps
```
Expected: zero matches.

```bash
rg "DEFAULT_DB_PATH|engineerdad\.sqlite|ENGINEERDAD_SQLITE_DB" --type ts packages mcp-servers apps
```
Expected: zero matches.

If any hit appears, address it before continuing.

### Task 7.5: Regenerate the lockfile to drop better-sqlite3

- [ ] **Step 7.5.1: Reinstall**

```bash
pnpm install
```

Drizzle's peer dep on `better-sqlite3` is optional; if no package requires it, it falls out of the lockfile.

```bash
grep -c "better-sqlite3" pnpm-lock.yaml
```
Expected: as low as practical (ideally 0, but acceptable if leftover transitives appear — the goal is no *code* path through SQLite).

### Task 7.6: Update root package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 7.6.1: Add db:push aggregate**

In root `package.json` scripts:

```json
"db:push": "pnpm --filter @engineerdad/store push && pnpm --filter @engineerdad/orchestrator push && pnpm --filter @engineerdad/analytics push",
```

Keep `store:push` and `orchestrator:push` as thin wrappers (or update them to call into `db:push`). The historical `store:push` script in root currently double-pushes to engineerdad + engineerdad_test:

```
"store:push": "pnpm --filter @engineerdad/store push && DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test pnpm --filter @engineerdad/store push",
```

Update to:
```json
"db:push": "pnpm --filter @engineerdad/store push && pnpm --filter @engineerdad/orchestrator push && pnpm --filter @engineerdad/analytics push && DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test pnpm --filter @engineerdad/store push && DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test pnpm --filter @engineerdad/orchestrator push && DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test pnpm --filter @engineerdad/analytics push",
```

Old `store:push`, `orchestrator:push` scripts: delete (or alias to `db:push`).

### Task 7.7: Update ARCHITECTURE.md

**Files:**
- Modify: `ARCHITECTURE.md`

- [ ] **Step 7.7.1: Find and edit SQLite mentions**

```bash
grep -n "sqlite\|SQLite" ARCHITECTURE.md
```

Three lines around 35, 104, 144:
- Line 35: `| analytics | deterministic | Pull Meta insights into SQLite; rank creatives; cost-per-angle; decay curves. | — |` → `Pull Meta insights into Postgres (analytics schema); ...`
- Line 104: `**data/engineerdad.sqlite** (SQLite, committed) — analytics signals ...` → delete the bullet or rewrite to `**Postgres engineerdad DB** (Docker, not committed) — analytics signals (events, meta_insights, creative_signals), orchestrator runs + step_results, and the store entities, all in three schemas (public, orchestrator, analytics).`
- Line 144: `store (the 8 entities + compliance scan), analytics (SQLite signals + bandit), ...` → `store (the 8 entities + compliance scan), analytics (Postgres signals + bandit), ...`

### Task 7.8: Update README.md, RESUME.md

**Files:**
- Modify: `README.md`
- Modify: `RESUME.md`

- [ ] **Step 7.8.1: Grep + edit**

```bash
grep -n "sqlite" README.md RESUME.md
```

For each hit: rewrite to reference Postgres / `engineerdad` DB / three schemas as appropriate. Reference the new ADR-025.

### Task 7.9: Append "Superseded by E-034" footer to old ADRs

**Files:**
- Modify: `docs/decisions/008-analytics-and-bandit.md`
- Modify: `docs/decisions/021-local-store-supersedes-notion.md`
- Modify: `docs/decisions/022-claim-check-worker-output.md`

- [ ] **Step 7.9.1: Append footer**

For each file, append (don't rewrite the body — historical record):

```markdown

---

## Update — Superseded by E-034 (2026-05-26)

The storage substrate decisions in this ADR have been superseded by
**E-034 (Sunset SQLite)** and **ADR-025 (Postgres-only)**.
See `docs/decisions/025-postgres-only.md`.

What changed:
- (008) Analytics tables now live in `analytics.*` in the engineerdad
  Postgres DB, not in `data/engineerdad.sqlite`.
- (021) Beyond store, the orchestrator's run state and analytics signals
  are also Postgres-resident; one DB, three schemas.
- (022) The `step_results` schema is now defined in Drizzle, not raw SQL
  migration files. Runtime behaviour is unchanged.
```

(Tailor the bullet for each ADR — only the relevant one applies.)

### Task 7.10: Write ADR-025

**Files:**
- Create: `docs/decisions/025-postgres-only.md`

- [ ] **Step 7.10.1: Write the ADR**

Create `docs/decisions/025-postgres-only.md`:

```markdown
# ADR-025: Postgres-only substrate

**Date:** 2026-05-26
**Status:** Accepted
**Supersedes:** Storage substrate sections of ADR-008, ADR-021, ADR-022
**Tracker:** E-034

## Context

For most of the project's history the repo ran two persistence substrates
side by side: Postgres (via Drizzle) for the 8 store entities and the
`orchestrator.step_results` claim-check table, and SQLite (via `node:sqlite`)
for the orchestrator's run state and the analytics signals/bandit tables.

The split was rational at each migration step (store moved off Notion;
step_results needed JSONB), but the dual-substrate surface had become its
own tax:
- Two connection idioms in test setup (temp SQLite file vs. PG truncate).
- Two migration tools (`pnpm store:push` / `pnpm orchestrator:push` vs.
  `applyMigrations()` in `getDb()`).
- Two type conventions (`TEXT`/`INTEGER` vs. `JSONB`/`TIMESTAMPTZ`).
- Vitest config carrying `external: ["node:sqlite", /^node:/]` only to
  serve the SQLite branch.

## Decision

One Postgres database (`engineerdad`), three schemas:
- `public` — the 8 store entities (existing).
- `orchestrator` — `runs`, `run_steps`, `step_results`.
- `analytics` — `meta_insights`, `creatives`, `events`, `angle_tags`,
  `creative_signals`.

All schemas defined in **Drizzle**, applied via `drizzle-kit push`.
Runtime queries can be Drizzle query-builder calls (simple) or raw
`sql\`...\`` template tags (analytics math) — both go through the same
postgres.js client per package.

Tests use a single shared helper `truncatePg()` from
`@engineerdad/shared/test-helpers`, called in `beforeEach`. The whole
suite runs serially (`vitest.config.ts` sets `singleFork: true` +
`sequence.concurrent: false`) so truncate-all is safe.

## Consequences

**Removed:**
- `node:sqlite` imports across `packages/{orchestrator,analytics,experiment}`.
- `data/engineerdad.sqlite` and WAL/SHM files.
- Four raw SQL migration files (orchestrator + analytics).
- Vitest `node:sqlite` external.
- Three local `truncateAll` clones in store tests; owned-id cleanup in
  orchestrator-postgres tests.

**Added:**
- Drizzle schemas + drizzle.config.ts for orchestrator and analytics
  packages.
- `packages/shared/src/test-helpers/truncate-pg.ts`.
- This ADR.

**Tradeoffs:**
- Tests now require a running Postgres (Docker via `pnpm store:up`).
  Acceptable — already required for store + step_results tests.
- Wall-clock test time +4-6s due to forced serial execution. Bounded by
  the static-renderer Playwright test (12s ceiling either way).
- One-way migration: no SQLite fallback. Rollback is a revert + `pnpm
  install`.

## See also

- `docs/superpowers/specs/2026-05-26-e-034-sunset-sqlite-design.html` —
  the design spec.
- `docs/superpowers/plans/2026-05-26-e-034-sunset-sqlite.md` — the
  implementation plan (this work).
```

### Task 7.11: Close out TASKS.md

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 7.11.1: Add + close E-034**

Open `TASKS.md`. Add an entry under whatever the appropriate section is (likely "Recently closed" or similar):

```markdown
- **E-034** — Sunset SQLite, move orchestrator + analytics + experiment
  to Postgres (one DB, three schemas, Drizzle everywhere). Closed
  2026-05-26 in branch `e-034-sunset-sqlite`. Spec:
  `docs/superpowers/specs/2026-05-26-e-034-sunset-sqlite-design.html`.
  Plan: `docs/superpowers/plans/2026-05-26-e-034-sunset-sqlite.md`.
  ADR: `docs/decisions/025-postgres-only.md`.
```

Update the Status header at the top of TASKS.md if it tracks active counts.

### Task 7.12: Final verification

- [ ] **Step 7.12.1: Build everything**

```bash
pnpm -r build 2>&1 | tail -5
```

- [ ] **Step 7.12.2: Full test suite**

```bash
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test pnpm test 2>&1 | tail -10
```

- [ ] **Step 7.12.3: pnpm sync:agents:check**

```bash
pnpm sync:agents:check
```
Expected: success or "no changes".

- [ ] **Step 7.12.4: Final grep — no SQLite mentions**

```bash
rg -i "sqlite" packages mcp-servers apps --type ts
rg -i "sqlite" ARCHITECTURE.md README.md RESUME.md
```
Expected: zero matches in code; `.md` matches should only be the new ADR-025 file and the historical "Superseded by E-034" footers in ADR-008/021/022.

- [ ] **Step 7.12.5: Fresh-DB smoke**

```bash
docker exec -i engineerdad-postgres psql -U engineerdad -d engineerdad_test \
  -c "DROP SCHEMA IF EXISTS orchestrator CASCADE; DROP SCHEMA IF EXISTS analytics CASCADE;"
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test \
  pnpm db:push
docker exec -i engineerdad-postgres psql -U engineerdad -d engineerdad_test \
  -c "\dn"
```
Expected: schemas `public`, `orchestrator`, `analytics` all present.

### Task 7.13: Commit 7

- [ ] **Step 7.13.1: Stage + commit**

```bash
git add vitest.config.ts .gitignore package.json pnpm-lock.yaml \
        ARCHITECTURE.md README.md RESUME.md TASKS.md \
        docs/decisions
git status

git commit -m "$(cat <<'EOF'
chore: delete sqlite plumbing, drop better-sqlite3, write ADR-025

Final cleanup commit for E-034.

- vitest.config.ts: drop node:sqlite/^node: external.
- .gitignore: drop data/*.sqlite-shm, data/*.sqlite-wal,
  data/engineerdad-test.sqlite entries (added in 41c84d3).
- package.json: replace store:push + orchestrator:push with one
  db:push aggregate over store + orchestrator + analytics, both DBs.
- pnpm-lock.yaml: regenerated; better-sqlite3 drops out as no
  package requires it.
- data/engineerdad.sqlite{,-shm,-wal}: removed from disk
  (not git-tracked).
- ARCHITECTURE.md / README.md / RESUME.md: rewrite SQLite references
  to Postgres / three schemas.
- ADR-008 / ADR-021 / ADR-022: append "Superseded by E-034" footers.
- docs/decisions/025-postgres-only.md: NEW. Captures the why and the
  decided shape.
- TASKS.md: open + close E-034.

Refs: E-034 spec §6 commit 7.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 7.14: Branch hygiene

- [ ] **Step 7.14.1: Push branch**

```bash
git log --oneline main..HEAD
git push -u origin e-034-sunset-sqlite
```
Expected: 8 commits ahead (1 spec + 7 implementation). Branch pushed.

- [ ] **Step 7.14.2: Open PR (optional — only if you use PRs locally)**

```bash
gh pr create --title "E-034: Sunset SQLite; Postgres-only substrate" --body "$(cat <<'EOF'
## Summary
- One DB, three schemas (public/orchestrator/analytics), Drizzle everywhere.
- Standardized truncate-pg test helper; forced serial vitest suite.
- ADR-025 captures the decision; ADR-008/021/022 get superseded footers.

## Test plan
- [ ] Fresh DB → `pnpm db:push` → all three schemas exist
- [ ] `pnpm test` green
- [ ] Webapp `/status` renders with zero runs
- [ ] One full closed-loop walk through HG1 to confirm state persists

⚠️ Your local `data/engineerdad.sqlite` is deleted on merge. Back it up if you care.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(Skip if you squash-merge locally without PRs.)

---

## Done checklist

After commit 7, all of these should be true:

- [ ] `rg "node:sqlite|better-sqlite3" --type ts packages mcp-servers apps` → 0 matches
- [ ] `rg -i "sqlite" ARCHITECTURE.md README.md RESUME.md` → 0 matches
- [ ] `data/engineerdad.sqlite{,-shm,-wal}` not present on disk
- [ ] `pnpm -r build` green
- [ ] `pnpm test` green, fully serial (wall-clock ~17-20s)
- [ ] Fresh `engineerdad_test` → `pnpm db:push` creates all three schemas
- [ ] Webapp boots; `/status` renders zero runs without error
- [ ] `docs/decisions/025-postgres-only.md` exists
- [ ] `TASKS.md` E-034 entry exists and is marked closed
- [ ] Branch `e-034-sunset-sqlite` has 8 commits on top of `main` (1 spec + 7 implementation)

---

## Notes for the implementing engineer

- **Sequence matters.** Each commit assumes the previous one landed. Don't skip ahead.
- **TS will catch most mistakes.** If you forget an `await` after async-ifying analytics functions, the build fails. Trust the build.
- **The Drizzle query builder vs. `sql\`\`` choice.** Default to Drizzle for simple `SELECT col FROM t WHERE col = ?` / single-table inserts. Use `sql\`\`` for: multi-table aggregations, window functions, time-window arithmetic, the bandit posterior math. The rule is: if the SQL is the spec (analytics math), keep it literal; if the SQL is just plumbing (CRUD), let Drizzle write it.
- **`sequence.concurrent: false` is global.** If a specific test relies on `it.concurrent`, the global will override it. Either rewrite the test serially or override per-file.
- **`data/notion-ids.json`** is legacy from the Notion era; deletion is out of scope for E-034.
- **No data migration.** Local SQLite is dev fixture only. Before you start, if you have any run state you care about preserving, back it up — `cp data/engineerdad.sqlite data/engineerdad.sqlite.bak`. The migration is one-way.
- **Wall-clock test impact:** +4-6s on `pnpm test` (forced serial). Bounded by static-renderer's 12s Playwright test which already gates the suite.
