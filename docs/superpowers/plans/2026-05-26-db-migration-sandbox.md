# DB Migration Policy & Branch Sandbox Isolation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the live-DB footguns introduced by ADR-025 by adding a branch sandbox setup command, versioned migration commands, a `truncatePg()` safety guard, and operational rules in CLAUDE.md.

**Architecture:** A `scripts/db-sandbox.mjs` script derives the sandbox DB name from the current git branch, creates it idempotently, pushes all three Drizzle schemas to it, and writes `DATABASE_URL` to `.env.local`. Per-package `drizzle/` folders hold generated SQL migrations committed alongside `schema.ts` changes. `truncatePg()` throws at module load if `DATABASE_URL` doesn't point at a safe DB.

**Tech Stack:** Node.js ESM scripts, drizzle-kit CLI, postgres.js, Vitest, pnpm workspaces.

---

### Task 1: Add `truncatePg()` module-load safety guard

**Files:**
- Modify: `packages/shared/src/test-helpers/truncate-pg.ts`

- [ ] **Step 1: Write the failing test**

Add a new test file `packages/shared/src/test-helpers/__tests__/truncate-pg-guard.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("truncatePg module-load guard", () => {
  const originalUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    // Clear module cache so re-import re-runs module-level code
    vi.resetModules();
  });

  it("throws when DATABASE_URL points at live DB", async () => {
    process.env.DATABASE_URL = "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad";
    vi.resetModules();
    await expect(import("../truncate-pg.js")).rejects.toThrow(
      "truncatePg() refuses to run"
    );
  });

  it("throws when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
    await expect(import("../truncate-pg.js")).rejects.toThrow(
      "truncatePg() refuses to run"
    );
  });

  it("does not throw when DATABASE_URL ends with _test", async () => {
    process.env.DATABASE_URL = "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test";
    vi.resetModules();
    await expect(import("../truncate-pg.js")).resolves.toBeDefined();
  });

  it("does not throw when DATABASE_URL contains engineerdad_sb_", async () => {
    process.env.DATABASE_URL = "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_sb_my_branch";
    vi.resetModules();
    await expect(import("../truncate-pg.js")).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run packages/shared/src/test-helpers/__tests__/truncate-pg-guard.test.ts
```

Expected: the "throws" cases pass (no guard exists yet so import succeeds), "does not throw" cases also pass — all four assertions are wrong way round. Actually the first two will FAIL because there's no guard yet. Good.

- [ ] **Step 3: Add the module-load guard to `truncate-pg.ts`**

Insert these lines at the very top of `packages/shared/src/test-helpers/truncate-pg.ts`, before the `import` statements:

```typescript
const _dbUrl = process.env.DATABASE_URL ?? "";
const _dbSafe = /_test$/.test(_dbUrl) || /engineerdad_sb_/.test(_dbUrl);
if (!_dbSafe) {
  throw new Error(
    `truncatePg() refuses to run against '${_dbUrl || "(unset)"}'. ` +
      `DATABASE_URL must end with _test or contain engineerdad_sb_. ` +
      `Run \`pnpm db:sandbox\` to set up your branch sandbox.`,
  );
}
```

The full file top should look like:

```typescript
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
// ... rest of file unchanged
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run packages/shared/src/test-helpers/__tests__/truncate-pg-guard.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Verify existing test suite still passes** (requires `DATABASE_URL` to point at `_test` DB)

```bash
pnpm vitest run
```

Expected: full suite passes (Vitest loads `.env` then `.env.local`; `engineerdad_test` URL from `.env` is safe).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/test-helpers/truncate-pg.ts \
        packages/shared/src/test-helpers/__tests__/truncate-pg-guard.test.ts
git commit -m "feat(shared): truncatePg() module-load guard — rejects non-sandbox DATABASE_URL"
```

---

### Task 2: Add `drizzle/` output path to all three drizzle configs

**Files:**
- Modify: `packages/store/drizzle.config.ts`
- Modify: `packages/orchestrator/drizzle.config.ts`
- Modify: `packages/analytics/drizzle.config.ts`

- [ ] **Step 1: Update `packages/store/drizzle.config.ts`**

```typescript
import { defineConfig } from "drizzle-kit";

const DATABASE_URL = process.env.DATABASE_URL
  ?? "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: DATABASE_URL },
});
```

- [ ] **Step 2: Update `packages/orchestrator/drizzle.config.ts`**

```typescript
import { defineConfig } from "drizzle-kit";

const DATABASE_URL = process.env.DATABASE_URL
  ?? "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["orchestrator"],
  dbCredentials: { url: DATABASE_URL },
});
```

- [ ] **Step 3: Update `packages/analytics/drizzle.config.ts`**

```typescript
import { defineConfig } from "drizzle-kit";

const DATABASE_URL = process.env.DATABASE_URL
  ?? "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["analytics"],
  dbCredentials: { url: DATABASE_URL },
});
```

- [ ] **Step 4: Commit**

```bash
git add packages/store/drizzle.config.ts \
        packages/orchestrator/drizzle.config.ts \
        packages/analytics/drizzle.config.ts
git commit -m "chore(drizzle): explicit out: './drizzle' in all three configs"
```

---

### Task 3: Generate initial migration SQL for all three packages

**Files:**
- Create: `packages/store/drizzle/` (generated, committed)
- Create: `packages/orchestrator/drizzle/` (generated, committed)
- Create: `packages/analytics/drizzle/` (generated, committed)

- [ ] **Step 1: Generate migrations for store**

```bash
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad \
  pnpm --filter @engineerdad/store exec drizzle-kit generate
```

Expected: creates `packages/store/drizzle/<timestamp>_init.sql` and `packages/store/drizzle/meta/`.

- [ ] **Step 2: Generate migrations for orchestrator**

```bash
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad \
  pnpm --filter @engineerdad/orchestrator exec drizzle-kit generate
```

Expected: creates `packages/orchestrator/drizzle/<timestamp>_init.sql` and `packages/orchestrator/drizzle/meta/`.

- [ ] **Step 3: Generate migrations for analytics**

```bash
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad \
  pnpm --filter @engineerdad/analytics exec drizzle-kit generate
```

Expected: creates `packages/analytics/drizzle/<timestamp>_init.sql` and `packages/analytics/drizzle/meta/`.

- [ ] **Step 4: Verify no drizzle/ entries in .gitignore**

```bash
grep -i drizzle .gitignore
```

Expected: no output. The `drizzle/` folders and their contents must be committed.

- [ ] **Step 5: Commit all generated SQL**

```bash
git add packages/store/drizzle \
        packages/orchestrator/drizzle \
        packages/analytics/drizzle
git commit -m "chore(migrations): initial drizzle-kit generate — baseline SQL for all three schemas"
```

---

### Task 4: Write `scripts/db-sandbox.mjs`

**Files:**
- Create: `scripts/db-sandbox.mjs`

- [ ] **Step 1: Create the script**

```javascript
#!/usr/bin/env node
// Creates or updates a branch-scoped sandbox DB and writes DATABASE_URL to .env.local.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const ROOT = new URL("..", import.meta.url).pathname;

function branchSlug() {
  const branch = execSync("git symbolic-ref --short HEAD", { encoding: "utf8" }).trim();
  return "engineerdad_sb_" + branch.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
}

async function createDbIfNeeded(dbName) {
  // Connect to the postgres maintenance DB to create the target DB.
  const adminUrl = "postgresql://engineerdad:engineerdad@localhost:5432/postgres";
  const sql = postgres(adminUrl, { max: 1 });
  try {
    const rows = await sql`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (rows.length === 0) {
      // drizzle-kit push creates the schema objects; we only need the DB itself here.
      await sql.unsafe(`CREATE DATABASE "${dbName}"`);
      console.log(`Created database: ${dbName}`);
    } else {
      console.log(`Database already exists: ${dbName}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function pushSchemas(dbUrl) {
  const env = { ...process.env, DATABASE_URL: dbUrl };
  for (const pkg of ["@engineerdad/store", "@engineerdad/orchestrator", "@engineerdad/analytics"]) {
    console.log(`Pushing schema for ${pkg}...`);
    execSync(`pnpm --filter ${pkg} push`, { env, stdio: "inherit", cwd: ROOT });
  }
}

function writeEnvLocal(dbUrl) {
  const envLocalPath = resolve(ROOT, ".env.local");
  let content = "";
  if (existsSync(envLocalPath)) {
    content = readFileSync(envLocalPath, "utf8");
    // Replace existing DATABASE_URL line or append.
    if (/^DATABASE_URL=/m.test(content)) {
      content = content.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${dbUrl}`);
    } else {
      content += `\nDATABASE_URL=${dbUrl}\n`;
    }
  } else {
    content = `DATABASE_URL=${dbUrl}\n`;
  }
  writeFileSync(envLocalPath, content);
  console.log(`Wrote DATABASE_URL to .env.local → ${dbUrl}`);
}

const dbName = branchSlug();
const dbUrl = `postgresql://engineerdad:engineerdad@localhost:5432/${dbName}`;

await createDbIfNeeded(dbName);
pushSchemas(dbUrl);
writeEnvLocal(dbUrl);

console.log(`\nSandbox ready: ${dbName}`);
console.log(`DATABASE_URL written to .env.local — Vitest will pick this up automatically.`);
```

- [ ] **Step 2: Verify the script is importable (syntax check)**

```bash
node --input-type=module --eval "import './scripts/db-sandbox.mjs'" 2>&1 | head -5
```

Expected: no output (clean import, no side effects until invoked as main script). If there's a syntax error it will print here.

- [ ] **Step 3: Commit**

```bash
git add scripts/db-sandbox.mjs
git commit -m "feat(scripts): db-sandbox — branch-scoped sandbox DB setup"
```

---

### Task 5: Write `scripts/db-sandbox-drop.mjs`

**Files:**
- Create: `scripts/db-sandbox-drop.mjs`

- [ ] **Step 1: Create the script**

```javascript
#!/usr/bin/env node
// Lists and drops sandbox DBs whose git branch no longer exists locally.
import { execSync } from "node:child_process";
import { createInterface } from "node:readline";
import postgres from "postgres";

async function main() {
  const adminUrl = "postgresql://engineerdad:engineerdad@localhost:5432/postgres";
  const sql = postgres(adminUrl, { max: 1 });

  let sandboxDbs;
  try {
    sandboxDbs = await sql`
      SELECT datname FROM pg_database
      WHERE datname LIKE 'engineerdad_sb_%'
      ORDER BY datname
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }

  if (sandboxDbs.length === 0) {
    console.log("No sandbox DBs found.");
    return;
  }

  // Get local branches.
  const branches = execSync("git branch --format=%(refname:short)", { encoding: "utf8" })
    .split("\n").filter(Boolean);

  const branchSlugs = new Set(
    branches.map(b => "engineerdad_sb_" + b.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40))
  );

  const orphans = sandboxDbs.map(r => r.datname).filter(name => !branchSlugs.has(name));

  if (orphans.length === 0) {
    console.log("No orphaned sandbox DBs found.");
    return;
  }

  console.log("Orphaned sandbox DBs (branch no longer exists locally):");
  orphans.forEach(name => console.log(`  - ${name}`));

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve =>
    rl.question("\nDrop all of the above? [y/N] ", resolve)
  );
  rl.close();

  if (answer.toLowerCase() !== "y") {
    console.log("Aborted.");
    return;
  }

  const dropSql = postgres(adminUrl, { max: 1 });
  try {
    for (const name of orphans) {
      await dropSql.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
      console.log(`Dropped: ${name}`);
    }
  } finally {
    await dropSql.end({ timeout: 5 });
  }
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Syntax check**

```bash
node --input-type=module --eval "import './scripts/db-sandbox-drop.mjs'" 2>&1 | head -5
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add scripts/db-sandbox-drop.mjs
git commit -m "feat(scripts): db-sandbox-drop — orphan sandbox DB cleanup"
```

---

### Task 6: Add root `db:generate`, `db:migrate`, `db:sandbox`, `db:sandbox:drop` scripts; retire `db:push`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update `package.json` scripts**

Replace the existing `"db:push"` line and add the four new commands. The relevant section of `scripts` becomes:

```json
"db:sandbox": "node scripts/db-sandbox.mjs",
"db:sandbox:drop": "node scripts/db-sandbox-drop.mjs",
"db:generate": "pnpm --filter @engineerdad/store exec drizzle-kit generate && pnpm --filter @engineerdad/orchestrator exec drizzle-kit generate && pnpm --filter @engineerdad/analytics exec drizzle-kit generate",
"db:migrate": "pnpm --filter @engineerdad/store exec drizzle-kit migrate && pnpm --filter @engineerdad/orchestrator exec drizzle-kit migrate && pnpm --filter @engineerdad/analytics exec drizzle-kit migrate",
```

Remove the old `"db:push"` line entirely.

- [ ] **Step 2: Verify pnpm can parse the updated package.json**

```bash
pnpm run --list 2>&1 | grep db:
```

Expected output includes:
```
db:sandbox
db:sandbox:drop
db:generate
db:migrate
```

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(scripts): add db:sandbox, db:generate, db:migrate; retire db:push"
```

---

### Task 7: Write `scripts/check-schema-migrations.mjs` (CI lint)

**Files:**
- Create: `scripts/check-schema-migrations.mjs`

- [ ] **Step 1: Create the script**

```javascript
#!/usr/bin/env node
// CI lint: if any packages/*/src/schema.ts is changed in the last commit,
// the corresponding packages/*/drizzle/ must also contain new/changed SQL files.
import { execSync } from "node:child_process";

const changed = execSync("git diff --name-only HEAD~1 HEAD", { encoding: "utf8" })
  .split("\n").filter(Boolean);

const PACKAGES = ["store", "orchestrator", "analytics"];
let failed = false;

for (const pkg of PACKAGES) {
  const schemaChanged = changed.includes(`packages/${pkg}/src/schema.ts`);
  if (!schemaChanged) continue;

  const migrationChanged = changed.some(
    f => f.startsWith(`packages/${pkg}/drizzle/`) && f.endsWith(".sql")
  );

  if (!migrationChanged) {
    console.error(
      `ERROR: packages/${pkg}/src/schema.ts was modified but no new SQL migration found in packages/${pkg}/drizzle/.\n` +
      `Run \`pnpm db:generate\` and commit the generated SQL alongside schema.ts.`
    );
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("Migration check passed.");
```

- [ ] **Step 2: Add `lint:migrations` to root `package.json` scripts**

```json
"lint:migrations": "node scripts/check-schema-migrations.mjs",
```

- [ ] **Step 3: Verify the script exits 0 on the current commit (no schema change)**

```bash
pnpm lint:migrations
```

Expected: `Migration check passed.`

- [ ] **Step 4: Commit**

```bash
git add scripts/check-schema-migrations.mjs package.json
git commit -m "feat(scripts): lint:migrations — enforce SQL commit alongside schema.ts changes"
```

---

### Task 8: Write ADR-027

**Files:**
- Create: `docs/decisions/027-db-migration-policy-and-sandbox-isolation.md`

- [ ] **Step 1: Create the ADR**

```markdown
# ADR-027: DB migration policy and branch sandbox isolation

**Date:** 2026-05-26
**Status:** Accepted
**Builds on:** ADR-025 (postgres-only substrate)
**Tracker:** E-035

## Context

ADR-025 moved everything to Postgres but left three footguns unfixed:

1. Root `db:push` ran `drizzle-kit push` against the live `engineerdad` DB with no branch isolation.
2. All branch dev work shared the live DB — schema divergence between branches was invisible.
3. `truncatePg()` had no DB safety check. With `DATABASE_URL` pointing at `engineerdad`, every `beforeEach` in the test suite truncated the live DB. This happened.

## Decision

**Branch sandboxes.** Each branch gets its own `engineerdad_sb_<slug>` database. `pnpm db:sandbox` creates it, pushes all three schemas, and writes `DATABASE_URL` to `.env.local`. Vitest picks up `.env.local` over `.env` automatically.

**Versioned migrations.** Per-package `drizzle/` folders hold generated SQL. `drizzle-kit push` remains for sandbox dev (fast iteration). `pnpm db:generate` produces committed SQL. `pnpm db:migrate` applies migrations to the live DB post-merge. CI lint (`pnpm lint:migrations`) rejects commits that modify `schema.ts` without a corresponding SQL file.

**`truncatePg()` guard.** Throws at module load if `DATABASE_URL` doesn't end with `_test` or contain `engineerdad_sb_`. Hard-stops the suite before any data is touched.

**Root `db:push` retired.** Individual package `push` scripts remain as internal primitives called by `db:sandbox`.

**CLAUDE.md** carries operational rules so Claude Code follows the policy without being told each session.

## Consequences

- Tests require `pnpm db:sandbox` on first branch use. Suite hard-stops on wrong `DATABASE_URL` — intentional.
- Schema changes require `db:sandbox` + `db:generate` before committing.
- Post-merge: run `pnpm db:migrate` once against the live DB.
- Two branches can run `/loop` simultaneously against their own sandboxes without `run_id` collision.
- Live DB recovery after a wipe: `pnpm db:migrate` on a fresh `engineerdad` DB, then cold `/loop`.

## See also

- `docs/superpowers/specs/2026-05-26-db-migration-sandbox-design.html` — design spec
- `docs/superpowers/plans/2026-05-26-db-migration-sandbox.html` — this work
```

- [ ] **Step 2: Commit**

```bash
git add docs/decisions/027-db-migration-policy-and-sandbox-isolation.md
git commit -m "docs(adr): ADR-027 — DB migration policy and branch sandbox isolation"
```

---

### Task 9: Update CLAUDE.md with database workflow rules

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the "Database workflow" section to CLAUDE.md**

Insert immediately after the `## Build / dev commands (the non-obvious ones)` section:

```markdown
## Database workflow

- **Never run the root `db:push` script** — it is retired. Do not re-add it. It targeted the live DB directly.
- **Before running tests**, ensure `DATABASE_URL` in `.env.local` points at an `_test` or `engineerdad_sb_*` database. `truncatePg()` hard-stops the suite if it doesn't — this is intentional.
- **`pnpm db:sandbox`** — run once per branch, and again after any `schema.ts` change during dev. Derives DB name from the current git branch, creates it if needed, pushes all three schemas, writes `DATABASE_URL` to `.env.local`.
- **Schema change on a branch** — edit `schema.ts`, run `pnpm db:sandbox` (apply to sandbox), then `pnpm db:generate` (produce SQL). Commit `schema.ts` + the generated files in `packages/*/drizzle/` together. `pnpm lint:migrations` enforces this.
- **After merging to main** — run `pnpm db:migrate` against the live `engineerdad` DB once.
- **`pnpm db:sandbox:drop`** — run occasionally to drop sandbox DBs whose branches are gone.
```

- [ ] **Step 2: Verify the file looks correct**

```bash
grep -A 15 "## Database workflow" CLAUDE.md
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): database workflow rules for ADR-027"
```

---

### Task 10: Smoke-test the full flow

- [ ] **Step 1: Ensure Postgres is running**

```bash
pnpm store:up
```

Expected: Docker container starts or is already running.

- [ ] **Step 2: Run `pnpm db:sandbox` on the current branch**

```bash
pnpm db:sandbox
```

Expected output includes:
```
Created database: engineerdad_sb_main   (or your branch slug)
Pushing schema for @engineerdad/store...
Pushing schema for @engineerdad/orchestrator...
Pushing schema for @engineerdad/analytics...
Wrote DATABASE_URL to .env.local → postgresql://...engineerdad_sb_main
Sandbox ready: engineerdad_sb_main
```

- [ ] **Step 3: Verify `.env.local` was written**

```bash
cat .env.local
```

Expected: contains `DATABASE_URL=postgresql://...engineerdad_sb_main`.

- [ ] **Step 4: Run the full test suite**

```bash
pnpm test
```

Expected: all tests pass, including the new `truncate-pg-guard` tests.

- [ ] **Step 5: Run lint:migrations to confirm it passes on current state**

```bash
pnpm lint:migrations
```

Expected: `Migration check passed.`
