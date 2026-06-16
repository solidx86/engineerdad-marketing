# Webapp Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the webapp around runs (the unit of marketing thinking) without breaking the existing review surface — rename `apps/review-ui` to `apps/webapp`, add run-centric IA, replace the generic field dump with per-entity declarative layouts, surface Brain memos, add CreativeVariants channels/organic filters, and render IG-style asset previews.

**Architecture:** Server-component composition over the existing store (Approach A). Direct typed reads from Postgres via `@engineerdad/orchestrator/postgres`'s `sql` client; no new MCP, no API layer. Per-entity layouts + list configs as declarative TS data under `apps/webapp/src/app/lib/`. Playwright + seeded fixtures for UI tests (matches the repo's existing pattern; no `@testing-library/react`).

**Tech Stack:** Next 15 (App Router, server components) · React 19 · Tailwind 3 · Drizzle / postgres.js · `react-markdown` + `remark-gfm` · Playwright · Vitest.

**Spec:** `docs/superpowers/specs/2026-05-25-webapp-redesign-design.html`. HTML companion to this plan: `docs/superpowers/plans/2026-05-25-webapp-redesign.html`.

**Branch:** `feat/webapp-redesign` off `main`.

---

## Phase A — Rename foundation (5 tasks)

Sequenced so the build stays green at every commit. Rename happens before feature work so all new files have their final paths from day one.

### Task A1: Add webappUrl() helper with REVIEW_UI_URL fallback (additive)

**Files:**
- Modify: `packages/orchestrator/src/review-ui.ts`
- Test: `packages/orchestrator/src/review-ui.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// packages/orchestrator/src/review-ui.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { reviewUiUrl, webappUrl } from "./review-ui.js";

describe("webappUrl()", () => {
  const orig = { ...process.env };
  beforeEach(() => { delete process.env.WEBAPP_URL; delete process.env.REVIEW_UI_URL; });
  afterEach(() => { process.env = { ...orig }; });

  it("defaults to http://localhost:3030 with no env", () => {
    expect(webappUrl()).toBe("http://localhost:3030");
  });
  it("uses WEBAPP_URL when set", () => {
    process.env.WEBAPP_URL = "https://wa.example.com/";
    expect(webappUrl()).toBe("https://wa.example.com");
  });
  it("falls back to REVIEW_UI_URL when WEBAPP_URL absent", () => {
    process.env.REVIEW_UI_URL = "https://legacy.example.com/";
    expect(webappUrl()).toBe("https://legacy.example.com");
  });
  it("prefers WEBAPP_URL over REVIEW_UI_URL when both set", () => {
    process.env.WEBAPP_URL = "https://new.example.com";
    process.env.REVIEW_UI_URL = "https://old.example.com";
    expect(webappUrl()).toBe("https://new.example.com");
  });
  it("keeps reviewUiUrl() working as a deprecated alias", () => {
    process.env.REVIEW_UI_URL = "https://legacy.example.com";
    expect(reviewUiUrl()).toBe("https://legacy.example.com");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @engineerdad/orchestrator test review-ui`
Expected: FAIL with "webappUrl is not exported"

- [ ] **Step 3: Add the additive helper**

```ts
// packages/orchestrator/src/review-ui.ts
let warnedReviewUiUrl = false;

export function webappUrl(): string {
  const fromOld = process.env.REVIEW_UI_URL;
  if (fromOld && !process.env.WEBAPP_URL && !warnedReviewUiUrl) {
    console.warn("REVIEW_UI_URL is deprecated; set WEBAPP_URL instead.");
    warnedReviewUiUrl = true;
  }
  return (process.env.WEBAPP_URL ?? fromOld ?? "http://localhost:3030").replace(/\/+$/, "");
}

/** @deprecated Use webappUrl(). Kept for transition; remove after 30 days. */
export function reviewUiUrl(): string {
  return webappUrl();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @engineerdad/orchestrator test review-ui`
Expected: PASS (5 specs)

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/review-ui.ts packages/orchestrator/src/review-ui.test.ts
git commit -m "chore(orchestrator): add webappUrl() with REVIEW_UI_URL fallback"
```

### Task A2: Add remark-gfm dep and export orchestrator sql client

**Files:**
- Modify: `apps/review-ui/package.json` — add `remark-gfm`
- Modify: `packages/orchestrator/src/postgres.ts` — export `getOrchestratorSql()`
- Test: `packages/orchestrator/src/postgres.test.ts` — append assertion

- [ ] **Step 1: Failing test for sql export**

```ts
// packages/orchestrator/src/postgres.test.ts — append
import { getOrchestratorSql } from "./postgres.js";

it("exports a singleton sql client", () => {
  expect(typeof getOrchestratorSql).toBe("function");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @engineerdad/orchestrator test postgres`
Expected: FAIL with "getOrchestratorSql is not exported"

- [ ] **Step 3: Add export**

```ts
// packages/orchestrator/src/postgres.ts — append at bottom

/** Public accessor for the singleton sql client. Used by the webapp's
 *  lib/orchestrator.ts to query runs / run_steps / step_results without
 *  opening a second pool. Throws when DATABASE_URL is unset. */
export function getOrchestratorSql(): Sql {
  return client();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @engineerdad/orchestrator test postgres`
Expected: PASS

- [ ] **Step 5: Add remark-gfm dep**

Add to `apps/review-ui/package.json` under `"dependencies"`:
```json
"remark-gfm": "^4.0.0"
```

Then:
```bash
pnpm install
```

- [ ] **Step 6: Verify build + commit**

```bash
pnpm -r build
git add packages/orchestrator/src/postgres.ts packages/orchestrator/src/postgres.test.ts apps/review-ui/package.json pnpm-lock.yaml
git commit -m "chore: export orchestrator sql client + add remark-gfm"
```

### Task A3: Rename apps/review-ui → apps/webapp

**Files:**
- Rename: `apps/review-ui/` → `apps/webapp/`
- Modify: `apps/webapp/package.json` — name field
- Modify: `apps/webapp/playwright.config.ts` — env var name in variable + comment

- [ ] **Step 1: git mv the directory**

```bash
git mv apps/review-ui apps/webapp
```

- [ ] **Step 2: Update package name**

```json
// apps/webapp/package.json
{
  "name": "@engineerdad/webapp",
  ...
}
```

- [ ] **Step 3: Update playwright.config.ts**

```ts
// apps/webapp/playwright.config.ts
import { defineConfig } from "@playwright/test";

// Base URL = WEBAPP_URL (legacy REVIEW_UI_URL still honored by webappUrl()).
const WEBAPP_URL = process.env.WEBAPP_URL ?? process.env.REVIEW_UI_URL ?? "http://localhost:3030";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: WEBAPP_URL, trace: "retain-on-failure" },
  webServer: {
    command: "pnpm dev",
    url: WEBAPP_URL,
    reuseExistingServer: !process.env.CI,
    env: { DATABASE_URL: "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test" },
    timeout: 60_000,
  },
});
```

- [ ] **Step 4: Reinstall and verify build**

```bash
pnpm install
pnpm -r build
```
Expected: green build. `pnpm-lock.yaml` updated.

- [ ] **Step 5: Run existing e2e smoke**

```bash
pnpm --filter @engineerdad/webapp test:e2e
```
Expected: pre-existing 4 specs pass (list, detail-edit, status-flip, markdown-preview).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(webapp): rename apps/review-ui → apps/webapp + package"
```

### Task A4: Rename review-ui.ts → webapp-url.ts

**Files:**
- Rename: `packages/orchestrator/src/review-ui.ts` → `webapp-url.ts`
- Rename: `packages/orchestrator/src/review-ui.test.ts` → `webapp-url.test.ts`
- Modify: `packages/orchestrator/src/stages/brief.ts`, `content.ts`, `produce.ts` (import paths)

- [ ] **Step 1: Move both files**

```bash
git mv packages/orchestrator/src/review-ui.ts packages/orchestrator/src/webapp-url.ts
git mv packages/orchestrator/src/review-ui.test.ts packages/orchestrator/src/webapp-url.test.ts
```

- [ ] **Step 2: Update three import lines**

Change `from "../review-ui.js"` to `from "../webapp-url.js"` in:
- `packages/orchestrator/src/stages/brief.ts` (line 3)
- `packages/orchestrator/src/stages/content.ts` (line 3)
- `packages/orchestrator/src/stages/produce.ts` (line 11)

Leave the imported symbol as `reviewUiUrl` for now — Phase F swaps stage message contents.

- [ ] **Step 3: Build + test**

```bash
pnpm -r build
pnpm --filter @engineerdad/orchestrator test webapp-url
```
Expected: PASS (5 specs).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(orchestrator): rename review-ui.ts → webapp-url.ts"
```

### Task A5: Docs sweep — "review UI" → "webapp"

**Files:**
- Modify: `CLAUDE.md`, `ARCHITECTURE.md`, `README.md`, `RESUME.md`, `TASKS.md` (Status header)
- Modify: `.claude/agents/brief-writer.md`, `.claude/commands/brief.md`

- [ ] **Step 1: Find references**

```bash
grep -rn "review UI\|review-ui\|review.ui" CLAUDE.md ARCHITECTURE.md README.md RESUME.md TASKS.md .claude/agents .claude/commands 2>/dev/null
```

- [ ] **Step 2: Replace prose, one file at a time**

For each file: replace "review UI" with "webapp" in current prose. Specifically:
- The sentence "Every external write is human-gated through the review UI at http://localhost:3030" becomes "…through the webapp at http://localhost:3030"
- ADRs are NOT mass-edited. ADR-021 mentions the review UI in historical context — that stays. Only touch an ADR if it references a file path or package name that no longer exists.

- [ ] **Step 3: Verify only intentional references remain**

```bash
grep -rn "review-ui\|review.ui" CLAUDE.md ARCHITECTURE.md README.md RESUME.md .claude 2>/dev/null
```
Expected: 0 hits, or only ADR historical context.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md ARCHITECTURE.md README.md RESUME.md TASKS.md .claude/agents/brief-writer.md .claude/commands/brief.md
git commit -m "docs: rename review UI → webapp across current prose"
```

---

## Phase B — Foundation libs + types (5 tasks)

### Task B1: Type definitions

**Files:**
- Create: `apps/webapp/src/app/lib/types.ts`

No tests — types validated by their consumers in B2–C6.

- [ ] **Step 1: Write the types file**

```ts
// apps/webapp/src/app/lib/types.ts
import type { EntityName } from "@engineerdad/store";

export type FieldRole = "primary" | "meta" | "list" | "link" | "status" | "badge" | "timestamp";

export type FieldSpec =
  | { role: FieldRole; field: string; label?: string }
  | { role: "bilingual"; en: string; bm: string; label?: string }
  | { role: "fk"; field: string; fk: EntityName; label?: string };

export interface Section {
  title: string;
  fields: FieldSpec[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export interface EntityLayout {
  header: {
    title: string;
    subtitle?: string;
    status: string;
    secondaryStatus?: string;
  };
  primary: Section[];
  secondary: Section[];
}

export type ColumnType = "text" | "chips" | "status" | "badge" | "runId" | "timestamp";

export interface ColumnSpec {
  field: string;
  label: string;
  type: ColumnType;
  width?: "narrow" | "wide";
}

export interface FilterSpec {
  field: string;
  label: string;
  type: "select" | "multiSelect";
  options: readonly string[];
}

export interface ListConfig {
  columns: ColumnSpec[];
  filters: FilterSpec[];
  defaultSort?: { field: string; dir: "asc" | "desc" };
}

export type Lang = "en" | "ms";
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @engineerdad/webapp typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/webapp/src/app/lib/types.ts
git commit -m "feat(webapp): add EntityLayout + ListConfig type defs"
```

### Task B2: lib/orchestrator.ts — typed reads + currentGate()

**Files:**
- Create: `apps/webapp/src/app/lib/orchestrator.ts`
- Test: `apps/webapp/src/app/lib/orchestrator.test.ts`

- [ ] **Step 1: Failing test (pure currentGate + signature shape)**

```ts
// apps/webapp/src/app/lib/orchestrator.test.ts
import { describe, it, expect } from "vitest";
import { currentGate, listRuns, getRun, listSteps } from "./orchestrator.js";
import type { RunRow } from "./orchestrator.js";

const baseRun: RunRow = {
  runId: "r1", stage: "tracking", status: "running",
  params: null, createdAt: new Date(), updatedAt: new Date(),
};

describe("currentGate()", () => {
  it("returns null when status is running and stage doesn't await a gate", () => {
    expect(currentGate({ ...baseRun })).toBeNull();
  });
  it("maps brief + waiting → HG1", () => {
    expect(currentGate({ ...baseRun, stage: "brief", status: "waiting" })).toBe("HG1");
  });
  it("maps content + waiting → HG2", () => {
    expect(currentGate({ ...baseRun, stage: "content", status: "waiting" })).toBe("HG2");
  });
  it("maps produce + waiting → HG3", () => {
    expect(currentGate({ ...baseRun, stage: "produce", status: "waiting" })).toBe("HG3");
  });
  it("maps distribute + waiting → HG4", () => {
    expect(currentGate({ ...baseRun, stage: "distribute", status: "waiting" })).toBe("HG4");
  });
  it("returns null when completed regardless of stage", () => {
    expect(currentGate({ ...baseRun, stage: "produce", status: "completed" })).toBeNull();
  });
});

describe("orchestrator reads (exports)", () => {
  it("exports listRuns, getRun, listSteps", () => {
    expect(typeof listRuns).toBe("function");
    expect(typeof getRun).toBe("function");
    expect(typeof listSteps).toBe("function");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @engineerdad/webapp test orchestrator
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/webapp/src/app/lib/orchestrator.ts
import "server-only";
import { getOrchestratorSql, loadPayload } from "@engineerdad/orchestrator";

export type RunStatus = "running" | "waiting" | "completed" | "failed";
export type StepStatus = "pending" | "done" | "failed";

export interface RunRow {
  runId: string;
  stage: string;
  status: RunStatus;
  params: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface StepRow {
  runId: string;
  stepId: string;
  stage: string;
  status: StepStatus;
  result: unknown;
  problems: string[];
  attempts: number;
  updatedAt: Date;
}

const GATE_BY_STAGE: Record<string, "HG1" | "HG2" | "HG3" | "HG4"> = {
  brief: "HG1",
  content: "HG2",
  produce: "HG3",
  distribute: "HG4",
};

export function currentGate(run: RunRow): "HG1" | "HG2" | "HG3" | "HG4" | null {
  if (run.status !== "waiting") return null;
  return GATE_BY_STAGE[run.stage] ?? null;
}

function rowToRun(r: Record<string, unknown>): RunRow {
  return {
    runId: r.run_id as string,
    stage: r.stage as string,
    status: r.status as RunStatus,
    params: typeof r.params === "string" ? JSON.parse(r.params) : r.params,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

function rowToStep(r: Record<string, unknown>): StepRow {
  return {
    runId: r.run_id as string,
    stepId: r.step_id as string,
    stage: r.stage as string,
    status: r.status as StepStatus,
    result: typeof r.result === "string" ? JSON.parse(r.result) : r.result,
    problems: typeof r.problems === "string" ? JSON.parse(r.problems) : (r.problems as string[] ?? []),
    attempts: Number(r.attempts ?? 0),
    updatedAt: r.updated_at as Date,
  };
}

export async function listRuns(opts: { limit?: number } = {}): Promise<RunRow[]> {
  const sql = getOrchestratorSql();
  const rows = await sql`SELECT * FROM orchestrator.runs ORDER BY updated_at DESC LIMIT ${opts.limit ?? 100}`;
  return rows.map((r) => rowToRun(r as Record<string, unknown>));
}

export async function getRun(runId: string): Promise<RunRow | null> {
  const sql = getOrchestratorSql();
  const rows = await sql`SELECT * FROM orchestrator.runs WHERE run_id = ${runId} LIMIT 1`;
  return rows.length ? rowToRun(rows[0] as Record<string, unknown>) : null;
}

export async function listSteps(runId: string): Promise<StepRow[]> {
  const sql = getOrchestratorSql();
  const rows = await sql`
    SELECT * FROM orchestrator.run_steps WHERE run_id = ${runId} ORDER BY updated_at ASC
  `;
  return rows.map((r) => rowToStep(r as Record<string, unknown>));
}

export async function loadStepPayload(stepResultId: string): Promise<unknown> {
  return loadPayload(stepResultId);
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter @engineerdad/webapp test orchestrator
```
Expected: PASS (pure tests). Postgres-touching tests skipped without DATABASE_URL.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/app/lib/orchestrator.ts apps/webapp/src/app/lib/orchestrator.test.ts
git commit -m "feat(webapp): orchestrator state reads + currentGate()"
```

### Task B3: lib/assets.ts — resolveAssetUrl()

**Files:**
- Create: `apps/webapp/src/app/lib/assets.ts`
- Test: `apps/webapp/src/app/lib/assets.test.ts`

- [ ] **Step 1: Failing test**

```ts
// apps/webapp/src/app/lib/assets.test.ts
import { describe, it, expect } from "vitest";
import { resolveAssetUrl } from "./assets.js";

describe("resolveAssetUrl()", () => {
  it("rewrites file:// URLs to /api/asset", () => {
    const url = "file:///repo/data/assets/run_123/var_abc/0.png";
    expect(resolveAssetUrl(url)).toBe("/api/asset/run_123/var_abc/0.png");
  });
  it("passes https URLs through unchanged", () => {
    const url = "https://cdn.example.com/assets/run_123/var_abc/0.png";
    expect(resolveAssetUrl(url)).toBe(url);
  });
  it("returns the input unchanged when file:// path doesn't match canonical shape", () => {
    const url = "file:///tmp/random.png";
    expect(resolveAssetUrl(url)).toBe(url);
  });
  it("handles missing extension safely", () => {
    expect(resolveAssetUrl("file:///x/data/assets/r/v/s")).toBe("/api/asset/r/v/s");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @engineerdad/webapp test assets
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/webapp/src/app/lib/assets.ts
// Asset URLs in creative_variants.asset_files[] are file:// in local dev and
// https:// in prod (R2 with ASSET_STORE_PUBLIC_BASE set). The browser can't
// fetch file://; rewrite to the /api/asset/[runId]/[variantId]/[scene] route
// served by route.ts. This entire helper is dead code once E-007 ships.
const FILE_RE = /^file:\/\/.*\/data\/assets\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.\-]+)$/;

export function resolveAssetUrl(url: string): string {
  if (!url.startsWith("file://")) return url;
  const m = url.match(FILE_RE);
  if (!m) return url;
  return `/api/asset/${m[1]}/${m[2]}/${m[3]}`;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter @engineerdad/webapp test assets
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/app/lib/assets.ts apps/webapp/src/app/lib/assets.test.ts
git commit -m "feat(webapp): resolveAssetUrl() rewrites file:// to /api/asset"
```

### Task B4: /api/asset/[runId]/[variantId]/[scene] route handler

**Files:**
- Create: `apps/webapp/src/app/api/asset/[runId]/[variantId]/[scene]/route.ts`
- Test: `apps/webapp/tests/e2e/asset-route.spec.ts`

- [ ] **Step 1: Failing Playwright spec**

```ts
// apps/webapp/tests/e2e/asset-route.spec.ts
import { test, expect } from "./fixtures";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

test("GET /api/asset streams a PNG written to data/assets", async ({ request }) => {
  const dir = resolve(__dirname, "../../../..", "data/assets/run_t1/var_t1");
  mkdirSync(dir, { recursive: true });
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
    "0000000d49444154789c63000100000005000100" +
    "5dcc2bbe0000000049454e44ae426082",
    "hex",
  );
  writeFileSync(resolve(dir, "0.png"), png);

  const res = await request.get("/api/asset/run_t1/var_t1/0.png");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("image/png");
});

test("GET /api/asset returns 400 for path-traversal attempts", async ({ request }) => {
  const res = await request.get("/api/asset/..%2Fevil/x/y.png");
  expect(res.status()).toBeGreaterThanOrEqual(400);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @engineerdad/webapp test:e2e asset-route
```
Expected: FAIL — route doesn't exist (404).

- [ ] **Step 3: Implement**

```ts
// apps/webapp/src/app/api/asset/[runId]/[variantId]/[scene]/route.ts
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NextResponse } from "next/server";

const SAFE = /^[a-zA-Z0-9_.\-]+$/;

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4",
  ".mov": "video/quicktime", ".webm": "video/webm", ".html": "text/html",
};

function repoRoot(): string {
  let cur = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(resolve(cur, "pnpm-workspace.yaml"))) {
    const parent = dirname(cur);
    if (parent === cur) throw new Error("repo root not found");
    cur = parent;
  }
  return cur;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string; variantId: string; scene: string }> },
) {
  const { runId, variantId, scene } = await params;
  for (const v of [runId, variantId, scene]) {
    if (!SAFE.test(v)) return new NextResponse("bad path", { status: 400 });
  }
  const root = process.env.ASSET_STORE_ROOT ?? resolve(repoRoot(), "data/assets");
  const path = resolve(root, runId, variantId, scene);
  if (!path.startsWith(root)) return new NextResponse("bad path", { status: 400 });
  try {
    await stat(path);
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
  const bytes = await readFile(path);
  const mime = MIME[extname(scene).toLowerCase()] ?? "application/octet-stream";
  return new NextResponse(bytes, {
    status: 200,
    headers: { "content-type": mime, "cache-control": "private, max-age=60" },
  });
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter @engineerdad/webapp test:e2e asset-route
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/app/api apps/webapp/tests/e2e/asset-route.spec.ts
git commit -m "feat(webapp): /api/asset route handler for dev file:// streaming"
```

### Task B5: Extend Playwright fixtures with orchestrator-run helpers

**Files:**
- Modify: `apps/webapp/tests/e2e/fixtures.ts`

- [ ] **Step 1: Extend the seed fixture**

```ts
// apps/webapp/tests/e2e/fixtures.ts — replace existing fixture export
import { test as base } from "@playwright/test";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import postgres from "postgres";

const REPO_ROOT = resolve(__dirname, "../../../..");
const TEST_DB_URL = "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test";

function wipeAndPush() {
  execSync(
    `docker exec engineerdad-postgres psql -U engineerdad -d engineerdad_test -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS orchestrator CASCADE; CREATE SCHEMA orchestrator; GRANT ALL ON SCHEMA public TO engineerdad; GRANT ALL ON SCHEMA orchestrator TO engineerdad;"`,
    { cwd: REPO_ROOT, stdio: "ignore" },
  );
  execSync("pnpm --filter @engineerdad/store push", { cwd: REPO_ROOT, env: { ...process.env, DATABASE_URL: TEST_DB_URL }, stdio: "ignore" });
  execSync("pnpm --filter @engineerdad/orchestrator push", { cwd: REPO_ROOT, env: { ...process.env, DATABASE_URL: TEST_DB_URL }, stdio: "ignore" });
}

export interface StoreSeed {
  create: (entity: string, props: Record<string, unknown>) => Promise<{ id: string }>;
  orchestratorRun: (runId: string, stage: string, status: string, params?: unknown) => Promise<void>;
  orchestratorStep: (runId: string, stepId: string, stage: string, status: string, opts?: { problems?: string[]; result?: unknown }) => Promise<void>;
}

export const test = base.extend<{ seed: StoreSeed }>({
  seed: async ({}, use) => {
    wipeAndPush();
    process.env.DATABASE_URL = TEST_DB_URL;
    const { store } = await import("@engineerdad/store");
    const sql = postgres(TEST_DB_URL, { max: 2 });
    const seed: StoreSeed = {
      async create(entity, props) {
        const r = await store.create(entity as never, props);
        if (!r.ok) throw new Error(r.problems?.join("; ") ?? "seed failed");
        return { id: r.id! };
      },
      async orchestratorRun(runId, stage, status, params = null) {
        const now = Date.now();
        await sql`
          INSERT INTO orchestrator.runs (run_id, stage, status, params, created_at, updated_at)
          VALUES (${runId}, ${stage}, ${status}, ${JSON.stringify(params)}, ${now}, ${now})
        `;
      },
      async orchestratorStep(runId, stepId, stage, status, opts = {}) {
        const now = Date.now();
        await sql`
          INSERT INTO orchestrator.run_steps (run_id, step_id, stage, status, result, problems, attempts, updated_at)
          VALUES (${runId}, ${stepId}, ${stage}, ${status},
                  ${opts.result ? JSON.stringify(opts.result) : null},
                  ${opts.problems ? JSON.stringify(opts.problems) : null},
                  0, ${now})
        `;
      },
    };
    await use(seed);
    await sql.end();
  },
});

export { expect } from "@playwright/test";
```

- [ ] **Step 2: Verify existing 4 specs still pass**

```bash
pnpm --filter @engineerdad/webapp test:e2e
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/webapp/tests/e2e/fixtures.ts
git commit -m "test(webapp): extend fixtures with orchestratorRun + orchestratorStep helpers"
```

---

## Phase C — Shared components (6 tasks)

### Task C1: LanguageToggle — URL-driven EN/BM toggle (client)

**Files:**
- Create: `apps/webapp/src/app/components/LanguageToggle.tsx`

Behavior exercised end-to-end in E4 + E6 specs.

- [ ] **Step 1: Implement**

```tsx
// apps/webapp/src/app/components/LanguageToggle.tsx
"use client";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import type { Lang } from "../lib/types.js";

export function LanguageToggle({ lang }: { lang: Lang }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  function set(next: Lang) {
    const sp = new URLSearchParams(params.toString());
    if (next === "en") sp.delete("lang"); else sp.set("lang", next);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }
  return (
    <div className="inline-flex rounded border border-slate-300 text-xs font-semibold overflow-hidden">
      <button onClick={() => set("en")} aria-pressed={lang === "en"}
              className={`px-2 py-1 ${lang === "en" ? "bg-indigo-600 text-white" : "bg-white text-slate-600"}`}>EN</button>
      <button onClick={() => set("ms")} aria-pressed={lang === "ms"}
              className={`px-2 py-1 border-l border-slate-300 ${lang === "ms" ? "bg-indigo-600 text-white" : "bg-white text-slate-600"}`}>BM</button>
    </div>
  );
}

export function langFromSearchParams(sp: { lang?: string | string[] | undefined } | URLSearchParams): Lang {
  const v = sp instanceof URLSearchParams ? sp.get("lang") : sp.lang;
  return Array.isArray(v) ? (v[0] === "ms" ? "ms" : "en") : (v === "ms" ? "ms" : "en");
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @engineerdad/webapp typecheck
git add apps/webapp/src/app/components/LanguageToggle.tsx
git commit -m "feat(webapp): LanguageToggle client component"
```

### Task C2: SceneViewer — IG-style scene viewer (client)

**Files:**
- Create: `apps/webapp/src/app/components/SceneViewer.tsx`

Behavior exercised in E4 + E6 (CreativeVariant detail + Run page artifacts).

- [ ] **Step 1: Implement**

```tsx
// apps/webapp/src/app/components/SceneViewer.tsx
"use client";
import { useEffect, useState } from "react";
import { resolveAssetUrl } from "../lib/assets.js";

type Asset = { url: string; sha256?: string };
type Aspect = "4:5" | "1:1" | "9:16" | "16:9";

const ASPECT_W: Record<Aspect, string> = {
  "4:5": "aspect-[4/5]",
  "1:1": "aspect-square",
  "9:16": "aspect-[9/16]",
  "16:9": "aspect-video",
};

const VIDEO_EXTS = [".mp4", ".mov", ".webm"];

function isVideo(url: string): boolean {
  return VIDEO_EXTS.some((e) => url.toLowerCase().endsWith(e));
}

export function SceneViewer({ assets, aspect }: { assets: Asset[]; aspect: Aspect }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIdx((i) => Math.min(assets.length - 1, i + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assets.length]);

  if (!assets?.length) {
    return <div className="text-xs text-slate-400 italic px-2 py-6 text-center">no assets attached</div>;
  }
  const current = assets[idx];
  const src = resolveAssetUrl(current.url);
  return (
    <div className="inline-block max-w-[480px]" tabIndex={0}>
      <div className={`relative bg-slate-100 ${ASPECT_W[aspect]} max-w-[480px]`}>
        {isVideo(src)
          ? <video src={src} controls muted className="w-full h-full object-contain" />
          : <img src={src} alt={`scene ${idx + 1}`} className="w-full h-full object-contain" />}
        {assets.length > 1 && (
          <>
            <button onClick={() => setIdx(Math.max(0, idx - 1))}
                    disabled={idx === 0}
                    className="absolute left-1 top-1/2 -translate-y-1/2 bg-white/80 rounded-full w-7 h-7 disabled:opacity-30">&larr;</button>
            <button onClick={() => setIdx(Math.min(assets.length - 1, idx + 1))}
                    disabled={idx === assets.length - 1}
                    className="absolute right-1 top-1/2 -translate-y-1/2 bg-white/80 rounded-full w-7 h-7 disabled:opacity-30">&rarr;</button>
          </>
        )}
      </div>
      {assets.length > 1 && (
        <div className="flex gap-1.5 justify-center mt-2">
          {assets.map((_, i) => (
            <button key={i} onClick={() => setIdx(i)}
                    aria-label={`scene ${i + 1}`}
                    className={`w-2 h-2 rounded-full ${i === idx ? "bg-indigo-600" : "bg-slate-300"}`} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @engineerdad/webapp typecheck
git add apps/webapp/src/app/components/SceneViewer.tsx
git commit -m "feat(webapp): SceneViewer with IG-style hero + dots + arrow keys"
```

### Task C3: DecisionMemo — bandit + markdown + self-critique + copy button

**Files:**
- Create: `apps/webapp/src/app/components/DecisionMemo.tsx`
- Create: `apps/webapp/src/app/components/CopyMarkdownButton.tsx`

- [ ] **Step 1: Implement CopyMarkdownButton (client)**

```tsx
// apps/webapp/src/app/components/CopyMarkdownButton.tsx
"use client";
import { useState } from "react";

export function CopyMarkdownButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-xs text-slate-500 hover:text-indigo-600 border border-slate-300 rounded px-2 py-0.5"
      title="Copy memo as markdown"
    >{copied ? "✓ copied" : "copy md"}</button>
  );
}
```

- [ ] **Step 2: Implement DecisionMemo (server)**

```tsx
// apps/webapp/src/app/components/DecisionMemo.tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Lang } from "../lib/types.js";
import { CopyMarkdownButton } from "./CopyMarkdownButton.js";

type PerformanceReportRow = {
  decisionMemoEn?: string | null;
  decisionMemoBm?: string | null;
  selfCritique?: string | null;
  banditAllocation?: string | null;
} | null;

export function DecisionMemo({ row, lang }: { row: PerformanceReportRow; lang: Lang }) {
  if (!row) {
    return <div className="text-sm text-slate-500 italic">Decision Memo not yet produced for this run.</div>;
  }
  const body = (lang === "ms" ? row.decisionMemoBm : row.decisionMemoEn) ?? "";
  const allocation = row.banditAllocation?.trim();
  const critique = row.selfCritique?.trim();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold m-0">Decision Memo</h2>
        {body && <CopyMarkdownButton text={body} />}
      </div>
      {allocation && (
        <div className="text-xs flex gap-2 flex-wrap">
          {allocation.split(/[,·]/).map((a) => a.trim()).filter(Boolean).map((a) => (
            <span key={a} className="bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5">{a}</span>
          ))}
        </div>
      )}
      <article className="prose prose-sm max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{body || "(no body)"}</ReactMarkdown>
      </article>
      {critique && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-600 font-semibold">Self-critique</summary>
          <article className="prose prose-sm max-w-none mt-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{critique}</ReactMarkdown>
          </article>
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @engineerdad/webapp typecheck
git add apps/webapp/src/app/components/DecisionMemo.tsx apps/webapp/src/app/components/CopyMarkdownButton.tsx
git commit -m "feat(webapp): DecisionMemo component (markdown + bandit + self-critique + copy)"
```

### Task C4: EntityListView — generic list table driven by ListConfig

**Files:**
- Create: `apps/webapp/src/app/components/EntityListView.tsx`
- Create: `apps/webapp/src/app/components/FilterChips.tsx`

- [ ] **Step 1: Implement FilterChips (client)**

```tsx
// apps/webapp/src/app/components/FilterChips.tsx
"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { FilterSpec } from "../lib/types.js";

export function FilterChips({ filters }: { filters: FilterSpec[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  function setParam(field: string, value: string) {
    const sp = new URLSearchParams(params.toString());
    if (!value) sp.delete(field); else sp.set(field, value);
    router.replace(`${pathname}?${sp.toString()}`);
  }
  function clearAll() { router.replace(pathname); }

  return (
    <div className="flex flex-wrap gap-2 items-center text-xs py-2">
      {filters.map((f) => {
        const current = params.get(f.field) ?? "";
        return (
          <label key={f.field} className="inline-flex items-center gap-1">
            <span className="text-slate-500">{f.label}:</span>
            <select
              value={current}
              onChange={(e) => setParam(f.field, e.target.value)}
              className="border border-slate-300 rounded px-1.5 py-0.5"
            >
              <option value="">any</option>
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        );
      })}
      <button onClick={clearAll} className="text-slate-500 hover:text-indigo-600 underline ml-2">Clear all</button>
    </div>
  );
}
```

Note: multiSelect uses comma-separated URL values; v1 uses single-pick `<select>`. Multi-pick checkbox dropdown deferred.

- [ ] **Step 2: Implement EntityListView (server)**

```tsx
// apps/webapp/src/app/components/EntityListView.tsx
import Link from "next/link";
import type { ColumnSpec, ListConfig } from "../lib/types.js";
import { FilterChips } from "./FilterChips.js";

type Row = Record<string, unknown>;

function cell(col: ColumnSpec, val: unknown): React.ReactNode {
  switch (col.type) {
    case "text":   return String(val ?? "(untitled)");
    case "status": return <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-xs">{String(val ?? "")}</span>;
    case "badge":  return <span className="inline-block px-1.5 py-0.5 rounded border border-slate-200 text-xs text-slate-600">{String(val ?? "")}</span>;
    case "runId":  return val
      ? <Link href={`/runs/${val}`} className="text-indigo-600 hover:underline font-mono text-xs">{String(val)}</Link>
      : <span className="text-slate-400">—</span>;
    case "chips":
      return Array.isArray(val)
        ? <span className="flex flex-wrap gap-1">{val.map((c) => <span key={String(c)} className="bg-slate-100 text-xs px-1.5 py-0.5 rounded">{String(c)}</span>)}</span>
        : null;
    case "timestamp":
      return val ? new Date(val as string | Date).toLocaleString("en-MY") : "—";
  }
}

export interface EntityListViewProps {
  title: string;
  config: ListConfig;
  rows: Row[];
  rowHref: (row: Row) => string;
}

export function EntityListView({ title, config, rows, rowHref }: EntityListViewProps) {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">{title} <span className="text-slate-400 text-base font-normal">({rows.length})</span></h1>
      <FilterChips filters={config.filters} />
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500">
          <tr>{config.columns.map((c) => <th key={c.field} className="py-2 font-medium">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.id ?? r.runId)} className="border-t border-slate-200">
              {config.columns.map((c, i) => (
                <td key={c.field} className="py-2 pr-3 align-top">
                  {i === 0
                    ? <Link href={rowHref(r)} className="text-indigo-600 hover:underline">{cell(c, r[c.field])}</Link>
                    : cell(c, r[c.field])}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={config.columns.length} className="py-8 text-center text-slate-500">no rows</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @engineerdad/webapp typecheck
git add apps/webapp/src/app/components/EntityListView.tsx apps/webapp/src/app/components/FilterChips.tsx
git commit -m "feat(webapp): EntityListView + FilterChips"
```

### Task C5: EntityDetailView — read-mode layout renderer

**Files:**
- Create: `apps/webapp/src/app/components/EntityDetailView.tsx`
- Create: `apps/webapp/src/app/components/RawFieldsSection.tsx`

- [ ] **Step 1: Implement EntityDetailView**

```tsx
// apps/webapp/src/app/components/EntityDetailView.tsx
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EntityLayout, FieldSpec, Lang, Section } from "../lib/types.js";
import type { EntityName } from "@engineerdad/store";
import { RawFieldsSection } from "./RawFieldsSection.js";

type Row = Record<string, unknown>;

function FieldRow({ spec, row, lang, slugOf }: { spec: FieldSpec; row: Row; lang: Lang; slugOf: (e: EntityName) => string }) {
  const label = "label" in spec && spec.label ? spec.label : ("field" in spec ? spec.field : `${spec.en}/${spec.bm}`);
  if (spec.role === "bilingual") {
    const v = (lang === "ms" ? row[spec.bm] : row[spec.en]) as string | undefined;
    return (
      <div className="mb-3">
        <h4 className="text-xs font-semibold text-slate-500 mb-1">{label}</h4>
        <article className="prose prose-sm max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{v ?? "(empty)"}</ReactMarkdown>
        </article>
      </div>
    );
  }
  const val = row[spec.field];
  switch (spec.role) {
    case "primary":
      return <div className="mb-3">
        <h4 className="text-xs font-semibold text-slate-500 mb-1">{label}</h4>
        <article className="prose prose-sm max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{String(val ?? "(empty)")}</ReactMarkdown></article>
      </div>;
    case "list":
      return <div className="mb-2 text-sm"><span className="text-slate-500 mr-2">{label}:</span>
        {Array.isArray(val) ? val.map((x) => <span key={String(x)} className="inline-block bg-slate-100 px-1.5 py-0.5 rounded mr-1 text-xs">{String(x)}</span>) : "—"}
      </div>;
    case "status":
      return <div className="mb-2 text-sm"><span className="text-slate-500 mr-2">{label}:</span>
        <span className="inline-block bg-slate-100 px-2 py-0.5 rounded text-xs">{String(val ?? "—")}</span></div>;
    case "badge":
      return <div className="mb-2 text-sm"><span className="text-slate-500 mr-2">{label}:</span>
        <span className="inline-block border border-slate-200 px-1.5 py-0.5 rounded text-xs">{String(val ?? "—")}</span></div>;
    case "link":
      return val ? <div className="mb-2 text-sm"><a href={String(val)} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{label} →</a></div> : null;
    case "fk":
      return val ? <div className="mb-2 text-sm"><span className="text-slate-500 mr-2">{label}:</span>
        <Link href={`/review/${slugOf(spec.fk)}/${val}`} className="text-indigo-600 hover:underline">{String(val)}</Link></div> : null;
    case "timestamp":
      return <div className="mb-2 text-sm"><span className="text-slate-500 mr-2">{label}:</span>
        {val ? new Date(val as string | Date).toLocaleString("en-MY") : "—"}</div>;
    case "meta":
    default:
      return <div className="mb-2 text-sm"><span className="text-slate-500 mr-2">{label}:</span>{String(val ?? "—")}</div>;
  }
}

function SectionView({ section, row, lang, slugOf }: { section: Section; row: Row; lang: Lang; slugOf: (e: EntityName) => string }) {
  return (
    <section className="mb-6">
      <h3 className="text-sm font-semibold border-b border-slate-200 pb-1 mb-2">{section.title}</h3>
      {section.fields.map((f, i) => <FieldRow key={i} spec={f} row={row} lang={lang} slugOf={slugOf} />)}
    </section>
  );
}

export function EntityDetailView({ layout, row, lang, slugOf, headerSlot }: {
  layout: EntityLayout; row: Row; lang: Lang;
  slugOf: (e: EntityName) => string;
  headerSlot?: React.ReactNode;
}) {
  const usedFields = new Set<string>();
  for (const sec of [...layout.primary, ...layout.secondary]) {
    for (const f of sec.fields) {
      if (f.role === "bilingual") { usedFields.add(f.en); usedFields.add(f.bm); }
      else { usedFields.add(f.field); }
    }
  }
  usedFields.add("id"); usedFields.add("title"); usedFields.add(layout.header.status);
  if (layout.header.subtitle) usedFields.add(layout.header.subtitle);
  if (layout.header.secondaryStatus) usedFields.add(layout.header.secondaryStatus);

  return (
    <div>
      <header className="mb-6 pb-4 border-b border-slate-200">
        <h1 className="text-2xl font-bold m-0">{String(row[layout.header.title] ?? "(untitled)")}</h1>
        {layout.header.subtitle && <p className="text-sm text-slate-500 m-0">{String(row[layout.header.subtitle] ?? "")}</p>}
        {headerSlot}
      </header>
      <div className="grid grid-cols-3 gap-8">
        <div className="col-span-2">
          {layout.primary.map((sec) => <SectionView key={sec.title} section={sec} row={row} lang={lang} slugOf={slugOf} />)}
        </div>
        <div>
          {layout.secondary.map((sec) => <SectionView key={sec.title} section={sec} row={row} lang={lang} slugOf={slugOf} />)}
          <RawFieldsSection row={row} usedFields={usedFields} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement RawFieldsSection**

```tsx
// apps/webapp/src/app/components/RawFieldsSection.tsx
export function RawFieldsSection({ row, usedFields }: { row: Record<string, unknown>; usedFields: Set<string> }) {
  const skip = new Set(["createdAt", "updatedAt", "complianceCheck"]);
  const rawKeys = Object.keys(row).filter((k) => !usedFields.has(k) && !skip.has(k));
  if (rawKeys.length === 0) return null;
  return (
    <details className="mt-6 border-t border-slate-200 pt-3 text-xs">
      <summary className="cursor-pointer text-slate-500">Raw fields ({rawKeys.length})</summary>
      <dl className="grid grid-cols-[max-content_1fr] gap-1 mt-2 font-mono">
        {rawKeys.map((k) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="break-all">{typeof row[k] === "object" ? JSON.stringify(row[k]) : String(row[k] ?? "—")}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @engineerdad/webapp typecheck
git add apps/webapp/src/app/components/EntityDetailView.tsx apps/webapp/src/app/components/RawFieldsSection.tsx
git commit -m "feat(webapp): EntityDetailView read-mode renderer with role-aware fields"
```

### Task C6: EntityEditForm — edit-mode renderer (preserves existing Field + saveRow)

**Files:**
- Create: `apps/webapp/src/app/components/EntityEditForm.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/webapp/src/app/components/EntityEditForm.tsx
import type { EntityLayout } from "../lib/types.js";
import type { EntityName } from "@engineerdad/store";
import { APPROVAL_STATUS } from "@engineerdad/store";
import { Field } from "./Field.js";
import { saveRow } from "../lib/actions.js";

type Row = Record<string, unknown>;

export function EntityEditForm({ entity, id, layout, row, backHref }: {
  entity: EntityName; id: string; layout: EntityLayout; row: Row; backHref: string;
}) {
  const SKIP = new Set(["id", "createdAt", "updatedAt", "complianceCheck"]);
  const fields = Object.keys(row).filter((k) => !SKIP.has(k));
  return (
    <form action={saveRow.bind(null, entity, id)} className="space-y-4">
      {fields.map((field) => (
        <div key={field}>
          <label className="block text-xs font-semibold text-slate-600 mb-1">{field}</label>
          <Field name={field} value={row[field]} />
        </div>
      ))}
      <div className="border-t border-slate-200 pt-4 flex items-center gap-3">
        <select name="_status" defaultValue={(row[layout.header.status] as string) ?? "Draft"} className="border border-slate-300 rounded px-3 py-2 text-sm">
          {APPROVAL_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="submit" className="bg-indigo-600 text-white rounded px-4 py-2 text-sm font-semibold hover:bg-indigo-700">Save</button>
        <a href={backHref} className="text-sm text-slate-500 hover:underline">Cancel</a>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @engineerdad/webapp typecheck
git add apps/webapp/src/app/components/EntityEditForm.tsx
git commit -m "feat(webapp): EntityEditForm — flat edit-mode form preserving saveRow + setStatus"
```

---

## Phase D — Layouts + list configs (4 tasks)

### Task D1: Simple layouts — Briefs, Scripts, AuthorityArticles, Learnings

**Files:**
- Create: `apps/webapp/src/app/lib/layouts/briefs.ts`
- Create: `apps/webapp/src/app/lib/layouts/scripts.ts`
- Create: `apps/webapp/src/app/lib/layouts/authority-articles.ts`
- Create: `apps/webapp/src/app/lib/layouts/learnings.ts`

- [ ] **Step 1: Briefs layout**

```ts
// apps/webapp/src/app/lib/layouts/briefs.ts
import type { EntityLayout } from "../types.js";
export const briefsLayout: EntityLayout = {
  header: { title: "title", subtitle: "persona", status: "approvalStatus" },
  primary: [
    { title: "Brief", fields: [
      { role: "bilingual", en: "bodyEn", bm: "bodyBm", label: "Body" },
      { role: "meta", field: "angle" },
      { role: "meta", field: "promise" },
      { role: "meta", field: "funnelStage" },
    ]},
    { title: "Source", fields: [
      { role: "primary", field: "sourceInsights", label: "Insights" },
      { role: "list", field: "proofType", label: "Proof types" },
    ]},
  ],
  secondary: [
    { title: "Provenance", fields: [
      { role: "meta", field: "runId" },
      { role: "meta", field: "createdBy" },
      { role: "timestamp", field: "createdAt" },
      { role: "meta", field: "approver" },
    ]},
    { title: "Linked Hypotheses", fields: [{ role: "list", field: "linkedHypotheses" }]},
    { title: "Budget", fields: [{ role: "meta", field: "budgetBucket" }]},
  ],
};
```

- [ ] **Step 2: Scripts layout**

```ts
// apps/webapp/src/app/lib/layouts/scripts.ts
import type { EntityLayout } from "../types.js";
export const scriptsLayout: EntityLayout = {
  header: { title: "title", subtitle: "format", status: "approvalStatus" },
  primary: [
    { title: "Hook", fields: [{ role: "bilingual", en: "hookEn", bm: "hookBm", label: "Hook" }]},
    { title: "Script", fields: [{ role: "bilingual", en: "scriptEn", bm: "scriptBm", label: "Script" }]},
    { title: "CTA", fields: [{ role: "bilingual", en: "ctaEn", bm: "ctaBm", label: "CTA" }]},
  ],
  secondary: [
    { title: "Provenance", fields: [
      { role: "meta", field: "runId" },
      { role: "fk", field: "brief", fk: "Briefs", label: "Brief" },
      { role: "timestamp", field: "createdAt" },
      { role: "meta", field: "approver" },
    ]},
    { title: "Spec", fields: [
      { role: "meta", field: "format" },
      { role: "meta", field: "funnelStage" },
      { role: "meta", field: "durationSec", label: "Duration (s)" },
      { role: "list", field: "proofRefs", label: "Proof refs" },
    ]},
  ],
};
```

- [ ] **Step 3: AuthorityArticles layout**

```ts
// apps/webapp/src/app/lib/layouts/authority-articles.ts
import type { EntityLayout } from "../types.js";
export const authorityArticlesLayout: EntityLayout = {
  header: { title: "title", subtitle: "topic", status: "approvalStatus" },
  primary: [
    { title: "Body", fields: [{ role: "bilingual", en: "bodyEn", bm: "bodyBm", label: "Body" }]},
    { title: "FAQ", fields: [{ role: "bilingual", en: "faqEn", bm: "faqBm", label: "FAQ" }]},
    { title: "SEO", fields: [
      { role: "meta", field: "targetQuery" },
      { role: "meta", field: "aeoSchema" },
      { role: "meta", field: "slug" },
      { role: "meta", field: "description" },
      { role: "list", field: "keywords" },
      { role: "meta", field: "readingTime" },
      { role: "link", field: "heroImageUrl", label: "Hero image" },
      { role: "meta", field: "heroImageAlt" },
    ]},
    { title: "Distribution", fields: [
      { role: "list", field: "targetChannels" },
      { role: "link", field: "prUrlEn", label: "PR URL (EN)" },
      { role: "link", field: "prUrlBm", label: "PR URL (BM)" },
      { role: "timestamp", field: "deliveredAt" },
      { role: "meta", field: "deliveredTo" },
    ]},
  ],
  secondary: [
    { title: "Provenance", fields: [
      { role: "meta", field: "runId" },
      { role: "meta", field: "createdBy" },
      { role: "timestamp", field: "createdAt" },
      { role: "meta", field: "approver" },
    ]},
    { title: "Source", fields: [
      { role: "primary", field: "citations", label: "Citations" },
      { role: "list", field: "relatedSlugs" },
    ]},
  ],
};
```

- [ ] **Step 4: Learnings layout**

```ts
// apps/webapp/src/app/lib/layouts/learnings.ts
import type { EntityLayout } from "../types.js";
export const learningsLayout: EntityLayout = {
  header: { title: "title", subtitle: "status", status: "status" },
  primary: [
    { title: "Statement", fields: [{ role: "bilingual", en: "statementEn", bm: "statementBm", label: "Statement" }]},
    { title: "Evidence", fields: [
      { role: "badge", field: "confidence" },
      { role: "meta", field: "halfLifeDays", label: "Half-life (days)" },
      { role: "timestamp", field: "lastValidatedAt" },
      { role: "list", field: "domain" },
    ]},
  ],
  secondary: [
    { title: "Provenance", fields: [
      { role: "meta", field: "runId" },
      { role: "meta", field: "createdBy" },
      { role: "timestamp", field: "createdAt" },
    ]},
    { title: "Sources", fields: [{ role: "list", field: "sourceHypotheses" }]},
  ],
};
```

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @engineerdad/webapp typecheck
git add apps/webapp/src/app/lib/layouts/
git commit -m "feat(webapp): layouts for Briefs, Scripts, AuthorityArticles, Learnings"
```

### Task D2: Specialized layouts — Hypotheses, Experiments, PerformanceReports

**Files:**
- Create: `apps/webapp/src/app/lib/layouts/hypotheses.ts`
- Create: `apps/webapp/src/app/lib/layouts/experiments.ts`
- Create: `apps/webapp/src/app/lib/layouts/performance-reports.ts`

- [ ] **Step 1: Hypotheses layout**

```ts
// apps/webapp/src/app/lib/layouts/hypotheses.ts
import type { EntityLayout } from "../types.js";
export const hypothesesLayout: EntityLayout = {
  header: { title: "title", subtitle: "status", status: "status" },
  primary: [
    { title: "Statement", fields: [{ role: "bilingual", en: "statementEn", bm: "statementBm", label: "Statement" }]},
    { title: "Prediction", fields: [
      { role: "primary", field: "predictedEffect", label: "Predicted effect" },
      { role: "badge", field: "confidence" },
      { role: "list", field: "domain" },
      { role: "meta", field: "halfLifeDays", label: "Half-life (days)" },
      { role: "timestamp", field: "lastValidatedAt" },
    ]},
  ],
  secondary: [
    { title: "Provenance", fields: [
      { role: "meta", field: "runId" },
      { role: "meta", field: "createdBy" },
      { role: "timestamp", field: "createdAt" },
    ]},
    { title: "Sources", fields: [{ role: "list", field: "sourceHypotheses" }]},
  ],
};
```

- [ ] **Step 2: Experiments layout**

```ts
// apps/webapp/src/app/lib/layouts/experiments.ts
import type { EntityLayout } from "../types.js";
export const experimentsLayout: EntityLayout = {
  header: { title: "title", subtitle: "testType", status: "status", secondaryStatus: "approvalStatus" },
  primary: [
    { title: "Hypothesis", fields: [{ role: "fk", field: "hypothesis", fk: "Hypotheses", label: "Hypothesis" }]},
    { title: "Design", fields: [
      { role: "primary", field: "factors", label: "Factors" },
      { role: "primary", field: "cells", label: "Cells" },
      { role: "badge", field: "primaryMetric" },
      { role: "badge", field: "testType" },
      { role: "meta", field: "launchWindow" },
      { role: "meta", field: "dailyBudgetMyr", label: "Daily budget (MYR)" },
      { role: "meta", field: "durationDays", label: "Duration (days)" },
    ]},
    { title: "Readout", fields: [{ role: "primary", field: "readout" }]},
  ],
  secondary: [
    { title: "Provenance", fields: [
      { role: "meta", field: "runId" },
      { role: "timestamp", field: "createdAt" },
      { role: "meta", field: "approver" },
    ]},
    { title: "Linked Variants", fields: [{ role: "list", field: "linkedVariants" }]},
  ],
};
```

- [ ] **Step 3: PerformanceReports layout**

```ts
// apps/webapp/src/app/lib/layouts/performance-reports.ts
import type { EntityLayout } from "../types.js";
// Note: the detail route at /review/performance-reports/[id] renders <DecisionMemo>
// IN PLACE OF the Memo section's bilingual rendering. The layout entry keeps the
// fields marked as "used" so they don't leak into the Raw fields fallback.
export const performanceReportsLayout: EntityLayout = {
  header: { title: "title", subtitle: "window", status: "approvalStatus" },
  primary: [
    { title: "Memo", fields: [
      { role: "bilingual", en: "decisionMemoEn", bm: "decisionMemoBm", label: "Decision Memo" },
    ]},
    { title: "Snapshot", fields: [
      { role: "primary", field: "topCreatives", label: "Top creatives" },
      { role: "primary", field: "fatiguing", label: "Fatiguing" },
      { role: "primary", field: "costPerAngle", label: "Cost per angle" },
      { role: "primary", field: "banditAllocation", label: "Bandit allocation" },
    ]},
    { title: "Self-critique", fields: [{ role: "primary", field: "selfCritique" }]},
  ],
  secondary: [
    { title: "Provenance", fields: [
      { role: "meta", field: "runId" },
      { role: "meta", field: "window" },
      { role: "timestamp", field: "createdAt" },
      { role: "meta", field: "approver" },
    ]},
    { title: "Linked", fields: [
      { role: "list", field: "linkedBriefs" },
      { role: "list", field: "linkedExperiments" },
      { role: "list", field: "linkedHypotheses" },
    ]},
  ],
};
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm --filter @engineerdad/webapp typecheck
git add apps/webapp/src/app/lib/layouts/hypotheses.ts apps/webapp/src/app/lib/layouts/experiments.ts apps/webapp/src/app/lib/layouts/performance-reports.ts
git commit -m "feat(webapp): layouts for Hypotheses, Experiments, PerformanceReports"
```

### Task D3: CreativeVariants layout (the heavy one)

**Files:**
- Create: `apps/webapp/src/app/lib/layouts/creative-variants.ts`

- [ ] **Step 1: Implement**

```ts
// apps/webapp/src/app/lib/layouts/creative-variants.ts
import type { EntityLayout } from "../types.js";
// Note: the Creative section's assetFiles is NOT a standard layout field —
// the route at /review/creative-variants/[id] injects <SceneViewer> separately.
// The layout entry marks the field as "meta" so it doesn't appear in Raw fields.
export const creativeVariantsLayout: EntityLayout = {
  header: { title: "title", subtitle: "format", status: "approvalStatus", secondaryStatus: "organicStatus" },
  primary: [
    { title: "Creative", fields: [
      { role: "meta", field: "format" },
      { role: "meta", field: "aspect" },
      { role: "bilingual", en: "shotlistEn", bm: "shotlistBm", label: "Shotlist" },
      { role: "meta", field: "thumbnailBrief" },
      { role: "meta", field: "assetFiles", label: "Asset files (rendered above)" },
    ]},
    { title: "Meta paid copy", fields: [
      { role: "bilingual", en: "metaPrimaryTextEn", bm: "metaPrimaryTextBm", label: "Primary text" },
      { role: "bilingual", en: "metaHeadlineEn", bm: "metaHeadlineBm", label: "Headline" },
      { role: "bilingual", en: "metaDescriptionEn", bm: "metaDescriptionBm", label: "Description" },
      { role: "meta", field: "metaCtaType", label: "CTA" },
    ]},
    { title: "Organic copy", fields: [
      { role: "bilingual", en: "organicCaptionEn", bm: "organicCaptionBm", label: "Caption" },
      { role: "list", field: "organicHashtagsIg", label: "IG hashtags" },
      { role: "list", field: "organicHashtagsFb", label: "FB hashtags" },
      { role: "meta", field: "organicLanguage" },
    ]},
    { title: "YouTube", collapsible: true, defaultCollapsed: true, fields: [
      { role: "meta", field: "ytTitle" },
      { role: "primary", field: "ytDescription", label: "Description" },
      { role: "list", field: "ytTags" },
      { role: "meta", field: "ytCategory" },
      { role: "meta", field: "ytVideoId" },
    ]},
    { title: "Pipeline", collapsible: true, defaultCollapsed: true, fields: [
      { role: "primary", field: "pipelineNotes" },
      { role: "primary", field: "imageGenerationNotes" },
      { role: "meta", field: "reelHeygenJobId" },
      { role: "link", field: "reelMp4Url", label: "Reel MP4" },
      { role: "meta", field: "adId" },
    ]},
    { title: "Publishing", fields: [
      { role: "status", field: "organicStatus", label: "Organic status" },
      { role: "timestamp", field: "organicScheduledFor", label: "Scheduled for" },
      { role: "timestamp", field: "organicPublishedAt", label: "Published at" },
      { role: "meta", field: "igPostId" },
      { role: "meta", field: "fbPostId" },
    ]},
  ],
  secondary: [
    { title: "Provenance", fields: [
      { role: "meta", field: "runId" },
      { role: "meta", field: "createdBy" },
      { role: "timestamp", field: "createdAt" },
      { role: "meta", field: "approver" },
    ]},
    { title: "Linked Script", fields: [{ role: "fk", field: "script", fk: "Scripts", label: "Script" }]},
    { title: "Cost", fields: [{ role: "meta", field: "estimatedCostMyr", label: "Estimated (MYR)" }]},
    { title: "Compliance", fields: [{ role: "meta", field: "complianceCheck" }]},
    { title: "Channels", fields: [{ role: "list", field: "channels" }]},
  ],
};
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @engineerdad/webapp typecheck
git add apps/webapp/src/app/lib/layouts/creative-variants.ts
git commit -m "feat(webapp): CreativeVariants layout (6 primary sections + secondary rail)"
```

### Task D4: All list configs (default + 4 custom + runs)

**Files:**
- Create: `apps/webapp/src/app/lib/listConfigs/default.ts`
- Create: `apps/webapp/src/app/lib/listConfigs/creative-variants.ts`
- Create: `apps/webapp/src/app/lib/listConfigs/hypotheses.ts`
- Create: `apps/webapp/src/app/lib/listConfigs/experiments.ts`
- Create: `apps/webapp/src/app/lib/listConfigs/runs.ts`

- [ ] **Step 1: default + creative-variants**

```ts
// apps/webapp/src/app/lib/listConfigs/default.ts
import type { ListConfig } from "../types.js";
import { APPROVAL_STATUS } from "@engineerdad/store";
export const defaultList: ListConfig = {
  columns: [
    { field: "title", label: "Title", type: "text" },
    { field: "runId", label: "Run", type: "runId" },
    { field: "approvalStatus", label: "Status", type: "status" },
  ],
  filters: [
    { field: "approvalStatus", label: "Status", type: "select", options: APPROVAL_STATUS },
  ],
};
```

```ts
// apps/webapp/src/app/lib/listConfigs/creative-variants.ts
import type { ListConfig } from "../types.js";
import { APPROVAL_STATUS, CHANNELS, ORGANIC_STATUS } from "@engineerdad/store";
export const creativeVariantsList: ListConfig = {
  columns: [
    { field: "title", label: "Title", type: "text" },
    { field: "channels", label: "Channels", type: "chips" },
    { field: "runId", label: "Run", type: "runId" },
    { field: "approvalStatus", label: "Status", type: "status" },
    { field: "organicStatus", label: "Organic", type: "status" },
  ],
  filters: [
    // Channels filter is applied in JS by the list route — DSL doesn't support
    // jsonb array containment; single consumer + small N. See spec §5.
    { field: "channels", label: "Channels", type: "multiSelect", options: CHANNELS },
    { field: "approvalStatus", label: "Approval", type: "select", options: APPROVAL_STATUS },
    { field: "organicStatus", label: "Organic", type: "select", options: ORGANIC_STATUS },
  ],
};
```

- [ ] **Step 2: hypotheses + experiments**

```ts
// apps/webapp/src/app/lib/listConfigs/hypotheses.ts
import type { ListConfig } from "../types.js";
import { DOMAIN, HYPOTHESIS_STATUS, LEARNING_CONFIDENCE } from "@engineerdad/store";
export const hypothesesList: ListConfig = {
  columns: [
    { field: "title", label: "Title", type: "text" },
    { field: "status", label: "Status", type: "status" },
    { field: "confidence", label: "Confidence", type: "badge" },
    { field: "domain", label: "Domain", type: "chips" },
    { field: "runId", label: "Run", type: "runId" },
  ],
  filters: [
    { field: "status", label: "Status", type: "select", options: HYPOTHESIS_STATUS },
    { field: "confidence", label: "Confidence", type: "select", options: LEARNING_CONFIDENCE },
    { field: "domain", label: "Domain", type: "multiSelect", options: DOMAIN },
  ],
};
```

```ts
// apps/webapp/src/app/lib/listConfigs/experiments.ts
import type { ListConfig } from "../types.js";
import { APPROVAL_STATUS, EXPERIMENT_STATUS, PRIMARY_METRIC, TEST_TYPE } from "@engineerdad/store";
export const experimentsList: ListConfig = {
  columns: [
    { field: "title", label: "Title", type: "text" },
    { field: "status", label: "Phase", type: "status" },
    { field: "primaryMetric", label: "Metric", type: "badge" },
    { field: "testType", label: "Type", type: "badge" },
    { field: "runId", label: "Run", type: "runId" },
    { field: "approvalStatus", label: "Approval", type: "status" },
  ],
  filters: [
    { field: "status", label: "Phase", type: "select", options: EXPERIMENT_STATUS },
    { field: "primaryMetric", label: "Metric", type: "select", options: PRIMARY_METRIC },
    { field: "testType", label: "Type", type: "select", options: TEST_TYPE },
    { field: "approvalStatus", label: "Approval", type: "select", options: APPROVAL_STATUS },
  ],
};
```

- [ ] **Step 3: runs list config**

```ts
// apps/webapp/src/app/lib/listConfigs/runs.ts
import type { ListConfig } from "../types.js";
export const RUN_STAGES = ["tracking", "analytics", "synthesize", "brief", "content", "produce", "schedule", "experiment", "distribute"] as const;
export const RUN_STATUS = ["running", "waiting", "completed", "failed"] as const;
export const runsList: ListConfig = {
  columns: [
    { field: "runId", label: "runId", type: "text" },
    { field: "createdAt", label: "Started", type: "timestamp" },
    { field: "stage", label: "Stage", type: "badge" },
    { field: "status", label: "State", type: "status" },
  ],
  filters: [
    { field: "stage", label: "Stage", type: "select", options: RUN_STAGES },
    { field: "status", label: "State", type: "select", options: RUN_STATUS },
  ],
};
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm --filter @engineerdad/webapp typecheck
git add apps/webapp/src/app/lib/listConfigs/
git commit -m "feat(webapp): list configs (default + creative-variants + hypotheses + experiments + runs)"
```

---

## Phase E — Routes (7 tasks)

### Task E1: Left-nav sidebar layout

**Files:**
- Create: `apps/webapp/src/app/components/LeftNav.tsx`
- Modify: `apps/webapp/src/app/layout.tsx`

- [ ] **Step 1: Implement LeftNav (client; persists collapse state in localStorage)**

```tsx
// apps/webapp/src/app/components/LeftNav.tsx
"use client";
import Link from "next/link";
import { useState, useEffect } from "react";

const REVIEW_ENTITIES: { slug: string; label: string }[] = [
  { slug: "briefs", label: "Briefs" },
  { slug: "scripts", label: "Scripts" },
  { slug: "authority-articles", label: "Authority Articles" },
  { slug: "creative-variants", label: "Creative Variants" },
  { slug: "experiments", label: "Experiments" },
  { slug: "performance-reports", label: "Memos & Performance" },
  { slug: "hypotheses", label: "Hypotheses" },
  { slug: "learnings", label: "Learnings" },
];

function useCollapse(key: string, initial: boolean) {
  const [collapsed, setCollapsed] = useState(initial);
  useEffect(() => {
    const v = localStorage.getItem(`nav.${key}`);
    if (v != null) setCollapsed(v === "1");
  }, [key]);
  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(`nav.${key}`, next ? "1" : "0");
      return next;
    });
  }
  return [collapsed, toggle] as const;
}

export function LeftNav() {
  const [runsCollapsed, toggleRuns] = useCollapse("runs", false);
  const [reviewCollapsed, toggleReview] = useCollapse("review", false);
  return (
    <nav className="w-60 border-r border-slate-200 p-4 bg-white min-h-screen text-sm">
      <Link href="/" className="block font-bold mb-4">EngineerDad</Link>
      <Link href="/" className="block py-1 px-2 rounded hover:bg-slate-100 mb-1">Dashboard</Link>
      <button onClick={toggleRuns} className="w-full text-left py-1 px-2 font-semibold flex items-center gap-1">
        <span>{runsCollapsed ? "▸" : "▾"}</span> Runs
      </button>
      {!runsCollapsed && (
        <ul className="ml-4 mb-2">
          <li><Link href="/runs" className="block py-1 px-2 rounded hover:bg-slate-100">All runs</Link></li>
        </ul>
      )}
      <button onClick={toggleReview} className="w-full text-left py-1 px-2 font-semibold flex items-center gap-1">
        <span>{reviewCollapsed ? "▸" : "▾"}</span> Marketing Review
      </button>
      {!reviewCollapsed && (
        <ul className="ml-4">
          {REVIEW_ENTITIES.map((e) => (
            <li key={e.slug}><Link href={`/review/${e.slug}`} className="block py-1 px-2 rounded hover:bg-slate-100">{e.label}</Link></li>
          ))}
        </ul>
      )}
    </nav>
  );
}
```

- [ ] **Step 2: Replace layout.tsx nav**

```tsx
// apps/webapp/src/app/layout.tsx
import "./globals.css";
import { LeftNav } from "./components/LeftNav.js";

export const metadata = { title: "EngineerDad — Webapp" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 min-h-screen">
        <div className="flex">
          <LeftNav />
          <main className="flex-1 p-8 max-w-6xl">{children}</main>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Run dev server + visit each nav entry**

```bash
pnpm --filter @engineerdad/webapp dev
```
Verify Dashboard + collapsible Runs + collapsible Marketing Review render. Click "Memos & Performance" — link points at `/review/performance-reports` (404 until E3).

- [ ] **Step 4: Commit**

```bash
git add apps/webapp/src/app/components/LeftNav.tsx apps/webapp/src/app/layout.tsx
git commit -m "feat(webapp): collapsible LeftNav with Runs + Marketing Review sections"
```

### Task E2: Dashboard stub at /

**Files:**
- Modify: `apps/webapp/src/app/page.tsx`

- [ ] **Step 1: Replace contents**

```tsx
// apps/webapp/src/app/page.tsx
import Link from "next/link";

export default function Dashboard() {
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <p className="text-slate-600 mb-6">Pick a run to inspect, or browse the entity lists under Marketing Review.</p>
      <Link href="/runs" className="inline-block bg-indigo-600 text-white rounded px-4 py-2 text-sm font-semibold hover:bg-indigo-700">
        Browse runs →
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/webapp/src/app/page.tsx
git commit -m "feat(webapp): blank Dashboard stub with link to /runs"
```

### Task E3: /review/[entity]/page.tsx — entity list

**Files:**
- Create: `apps/webapp/src/app/review/[entity]/page.tsx`
- Create: `apps/webapp/src/app/lib/listConfigs/index.ts`
- Test: `apps/webapp/tests/e2e/review-list.spec.ts`

- [ ] **Step 1: listConfigs/index.ts dispatcher**

```ts
// apps/webapp/src/app/lib/listConfigs/index.ts
import type { ListConfig } from "../types.js";
import type { EntityName } from "@engineerdad/store";
import { defaultList } from "./default.js";
import { creativeVariantsList } from "./creative-variants.js";
import { hypothesesList } from "./hypotheses.js";
import { experimentsList } from "./experiments.js";

const MAP: Partial<Record<EntityName, ListConfig>> = {
  CreativeVariants: creativeVariantsList,
  Hypotheses: hypothesesList,
  Experiments: experimentsList,
};

export function listConfigFor(entity: EntityName): ListConfig {
  return MAP[entity] ?? defaultList;
}
```

- [ ] **Step 2: Failing e2e spec**

```ts
// apps/webapp/tests/e2e/review-list.spec.ts
import { test, expect } from "./fixtures";

test("CreativeVariants list shows channels column + filters by channel", async ({ seed, page }) => {
  await seed.create("CreativeVariants", {
    title: "Carousel A",
    runId: "r-list-cv",
    createdBy: "MediaProd",
    channels: ["Meta-paid", "IG-organic"],
    approvalStatus: "Awaiting Approval",
    organicStatus: "Draft",
  });
  await seed.create("CreativeVariants", {
    title: "Reel B",
    runId: "r-list-cv",
    createdBy: "MediaProd",
    channels: ["YT"],
    approvalStatus: "Approved",
    organicStatus: "Approved",
  });
  await page.goto("/review/creative-variants");
  await expect(page.getByText("Carousel A")).toBeVisible();
  await expect(page.getByText("Reel B")).toBeVisible();
  await expect(page.getByText("Meta-paid")).toBeVisible();
  await page.goto("/review/creative-variants?channels=YT");
  await expect(page.getByText("Reel B")).toBeVisible();
  await expect(page.getByText("Carousel A")).toHaveCount(0);
});
```

- [ ] **Step 3: Implement the route**

```tsx
// apps/webapp/src/app/review/[entity]/page.tsx
import { store, ENTITY_NAMES } from "@engineerdad/store";
import { notFound } from "next/navigation";
import { EntityListView } from "../../components/EntityListView.js";
import { listConfigFor } from "../../lib/listConfigs/index.js";
import { entityFromSlug, slugOf } from "../../lib/entities.js";

type SP = { [key: string]: string | string[] | undefined };

export default async function ReviewList({
  params, searchParams,
}: { params: Promise<{ entity: string }>; searchParams: Promise<SP> }) {
  const { entity: slug } = await params;
  const sp = await searchParams;
  const entity = entityFromSlug(slug);
  if (!entity) notFound();

  const config = listConfigFor(entity);
  const filter: Record<string, unknown> = {};
  const filterFields = new Set(config.filters.map((f) => f.field));
  for (const k of filterFields) {
    if (k === "channels") continue; // JS-filtered below
    const v = sp[k];
    if (typeof v === "string" && v.length) filter[k] = v;
  }
  let rows = await store.query(entity, filter as never);

  // Channels filter — applied in JS because the store DSL doesn't support jsonb
  // array containment. Small N; intentional. See spec §5.
  const channelParam = typeof sp.channels === "string" ? sp.channels : undefined;
  if (channelParam) {
    const wanted = channelParam.split(",").map((c) => c.trim()).filter(Boolean);
    rows = rows.filter((r) => {
      const arr = (r as Record<string, unknown>).channels;
      return Array.isArray(arr) && (arr as string[]).some((c) => wanted.includes(c));
    });
  }

  return (
    <EntityListView
      title={entity}
      config={config}
      rows={rows as never}
      rowHref={(r) => `/review/${slugOf(entity)}/${(r as { id: string }).id}`}
    />
  );
}

export function generateStaticParams() {
  return ENTITY_NAMES.map((e) => ({ entity: slugOf(e) }));
}
```

- [ ] **Step 4: Run e2e**

```bash
pnpm --filter @engineerdad/webapp test:e2e review-list
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/app/review apps/webapp/src/app/lib/listConfigs/index.ts apps/webapp/tests/e2e/review-list.spec.ts
git commit -m "feat(webapp): /review/[entity] list page with per-entity config + JS channels filter"
```

### Task E4: /review/[entity]/[id]/page.tsx — entity detail (read + edit toggle)

**Files:**
- Create: `apps/webapp/src/app/review/[entity]/[id]/page.tsx`
- Create: `apps/webapp/src/app/lib/layouts/index.ts`
- Modify: `apps/webapp/src/app/lib/actions.ts` — append `setStatus`
- Test: `apps/webapp/tests/e2e/review-detail.spec.ts`

- [ ] **Step 1: layouts/index.ts dispatcher**

```ts
// apps/webapp/src/app/lib/layouts/index.ts
import type { EntityLayout } from "../types.js";
import type { EntityName } from "@engineerdad/store";
import { briefsLayout } from "./briefs.js";
import { scriptsLayout } from "./scripts.js";
import { authorityArticlesLayout } from "./authority-articles.js";
import { creativeVariantsLayout } from "./creative-variants.js";
import { experimentsLayout } from "./experiments.js";
import { performanceReportsLayout } from "./performance-reports.js";
import { hypothesesLayout } from "./hypotheses.js";
import { learningsLayout } from "./learnings.js";

const MAP: Record<EntityName, EntityLayout> = {
  Briefs: briefsLayout,
  Scripts: scriptsLayout,
  AuthorityArticles: authorityArticlesLayout,
  CreativeVariants: creativeVariantsLayout,
  Experiments: experimentsLayout,
  PerformanceReports: performanceReportsLayout,
  Hypotheses: hypothesesLayout,
  Learnings: learningsLayout,
};

export function layoutFor(entity: EntityName): EntityLayout {
  return MAP[entity];
}
```

- [ ] **Step 2: setStatus server action**

```ts
// apps/webapp/src/app/lib/actions.ts — append (preserve existing "use server" and saveRow)
export async function setStatus(entity: EntityName, id: string, status: string) {
  const r = await store.setStatus(entity, id, status);
  if (!r.ok) throw new Error(r.problems?.join("; ") ?? "setStatus failed");
  revalidatePath(`/review/${slugOf(entity)}`);
  revalidatePath(`/review/${slugOf(entity)}/${id}`);
}
```

- [ ] **Step 3: Failing e2e**

```ts
// apps/webapp/tests/e2e/review-detail.spec.ts
import { test, expect } from "./fixtures";

test("Brief detail renders persona subtitle + body markdown in read mode", async ({ seed, page }) => {
  const { id } = await seed.create("Briefs", {
    title: "PRS as Self-Care",
    persona: "engineer_dad_archetype",
    runId: "r-d1",
    createdBy: "Targeting",
    bodyEn: "# Heading\n\nBody paragraph",
    approvalStatus: "Awaiting Approval",
  });
  await page.goto(`/review/briefs/${id}`);
  await expect(page.getByRole("heading", { name: "PRS as Self-Care" })).toBeVisible();
  await expect(page.getByText("engineer_dad_archetype")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Heading" })).toBeVisible();
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page.locator("form")).toBeVisible();
  await expect(page.locator("textarea[name=\"bodyEn\"]")).toBeVisible();
});

test("Brief detail Approve button transitions status", async ({ seed, page }) => {
  const { id } = await seed.create("Briefs", {
    title: "Approve me",
    runId: "r-d2",
    createdBy: "Targeting",
    approvalStatus: "Awaiting Approval",
  });
  await page.goto(`/review/briefs/${id}`);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved", { exact: false })).toBeVisible();
});
```

- [ ] **Step 4: Implement**

```tsx
// apps/webapp/src/app/review/[entity]/[id]/page.tsx
import { store } from "@engineerdad/store";
import { notFound } from "next/navigation";
import Link from "next/link";
import { entityFromSlug, slugOf } from "../../../lib/entities.js";
import { layoutFor } from "../../../lib/layouts/index.js";
import { EntityDetailView } from "../../../components/EntityDetailView.js";
import { EntityEditForm } from "../../../components/EntityEditForm.js";
import { LanguageToggle, langFromSearchParams } from "../../../components/LanguageToggle.js";
import { SceneViewer } from "../../../components/SceneViewer.js";
import { DecisionMemo } from "../../../components/DecisionMemo.js";
import { setStatus } from "../../../lib/actions.js";

type SP = { lang?: string; mode?: string };

export default async function ReviewDetail({
  params, searchParams,
}: { params: Promise<{ entity: string; id: string }>; searchParams: Promise<SP> }) {
  const { entity: slug, id } = await params;
  const sp = await searchParams;
  const entity = entityFromSlug(slug);
  if (!entity) notFound();
  const row = await store.get(entity, id);
  if (!row) notFound();
  const layout = layoutFor(entity);
  const lang = langFromSearchParams(sp);
  const editing = sp.mode === "edit";

  const statusValue = String((row as Record<string, unknown>)[layout.header.status] ?? "");
  const isAwaiting = statusValue === "Awaiting Approval";

  const headerSlot = (
    <div className="flex items-center gap-3 mt-3 flex-wrap">
      <span className="bg-slate-100 px-2 py-0.5 rounded text-xs">{statusValue}</span>
      {layout.header.secondaryStatus && (
        <span className="bg-slate-100 px-2 py-0.5 rounded text-xs">
          {String((row as Record<string, unknown>)[layout.header.secondaryStatus] ?? "")}
        </span>
      )}
      <LanguageToggle lang={lang} />
      <div className="ml-auto flex gap-2 text-sm">
        {isAwaiting && !editing && (
          <form action={setStatus.bind(null, entity, id, "Approved")}>
            <button type="submit" className="bg-emerald-600 text-white rounded px-3 py-1 hover:bg-emerald-700">Approve</button>
          </form>
        )}
        {!editing
          ? <Link href={`?mode=edit${lang === "ms" ? "&lang=ms" : ""}`} className="border border-slate-300 rounded px-3 py-1 hover:bg-slate-100">Edit</Link>
          : <Link href={`?${lang === "ms" ? "lang=ms" : ""}`} className="border border-slate-300 rounded px-3 py-1 hover:bg-slate-100">Cancel</Link>}
      </div>
    </div>
  );

  if (editing) {
    return (
      <div>
        <header className="mb-6 pb-4 border-b border-slate-200">
          <h1 className="text-2xl font-bold m-0">{String((row as Record<string, unknown>).title ?? "(untitled)")}</h1>
          {headerSlot}
        </header>
        <EntityEditForm entity={entity} id={id} layout={layout} row={row as never} backHref={`/review/${slug}/${id}`} />
      </div>
    );
  }

  const overlay = (() => {
    if (entity === "CreativeVariants") {
      const files = (row as Record<string, unknown>).assetFiles as { url: string }[] | null;
      const aspect = (row as Record<string, unknown>).aspect as "4:5" | "1:1" | "9:16" | "16:9" | undefined;
      if (files?.length && aspect) {
        return <div className="mb-6"><SceneViewer assets={files} aspect={aspect} /></div>;
      }
    }
    if (entity === "PerformanceReports") {
      return <div className="mb-6"><DecisionMemo row={row as never} lang={lang} /></div>;
    }
    return null;
  })();

  return (
    <div>
      <div className="mb-4"><Link href={`/review/${slug}`} className="text-sm text-slate-500 hover:underline">← {entity}</Link></div>
      <EntityDetailView layout={layout} row={row as never} lang={lang} slugOf={slugOf} headerSlot={headerSlot} />
      {overlay}
    </div>
  );
}
```

- [ ] **Step 5: Run e2e**

```bash
pnpm --filter @engineerdad/webapp test:e2e review-detail
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/app/review/[entity]/[id] apps/webapp/src/app/lib/layouts/index.ts apps/webapp/src/app/lib/actions.ts apps/webapp/tests/e2e/review-detail.spec.ts
git commit -m "feat(webapp): /review/[entity]/[id] detail with read/edit toggle + Approve action + overlays"
```

### Task E5: /runs/page.tsx — run index

**Files:**
- Create: `apps/webapp/src/app/runs/page.tsx`
- Test: `apps/webapp/tests/e2e/runs-list.spec.ts`

- [ ] **Step 1: Failing e2e**

```ts
// apps/webapp/tests/e2e/runs-list.spec.ts
import { test, expect } from "./fixtures";

test("runs list shows seeded runs with stage + status", async ({ seed, page }) => {
  await seed.orchestratorRun("run_a", "produce", "waiting");
  await seed.orchestratorRun("run_b", "distribute", "completed");
  await page.goto("/runs");
  await expect(page.getByText("run_a")).toBeVisible();
  await expect(page.getByText("run_b")).toBeVisible();
  await expect(page.getByText("produce", { exact: false })).toBeVisible();
});
```

- [ ] **Step 2: Implement**

```tsx
// apps/webapp/src/app/runs/page.tsx
import { listRuns } from "../lib/orchestrator.js";
import { runsList } from "../lib/listConfigs/runs.js";
import { EntityListView } from "../components/EntityListView.js";

type SP = { stage?: string; status?: string };

export default async function RunsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  let rows = await listRuns({ limit: 200 });
  if (sp.stage)  rows = rows.filter((r) => r.stage === sp.stage);
  if (sp.status) rows = rows.filter((r) => r.status === sp.status);
  return (
    <EntityListView
      title="Runs"
      config={runsList}
      rows={rows as never}
      rowHref={(r) => `/runs/${(r as { runId: string }).runId}`}
    />
  );
}
```

- [ ] **Step 3: Run e2e**

```bash
pnpm --filter @engineerdad/webapp test:e2e runs-list
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/webapp/src/app/runs/page.tsx apps/webapp/tests/e2e/runs-list.spec.ts
git commit -m "feat(webapp): /runs index page"
```

### Task E6: /runs/[runId]/page.tsx — run detail (timeline + memo + artifacts)

**Files:**
- Create: `apps/webapp/src/app/runs/[runId]/page.tsx`
- Create: `apps/webapp/src/app/components/RunStageTimeline.tsx`
- Create: `apps/webapp/src/app/components/FormatCard.tsx`
- Test: `apps/webapp/tests/e2e/run-detail.spec.ts`

- [ ] **Step 1: RunStageTimeline**

```tsx
// apps/webapp/src/app/components/RunStageTimeline.tsx
import type { RunRow, StepRow } from "../lib/orchestrator.js";
import { currentGate } from "../lib/orchestrator.js";

const STAGES = ["tracking", "analytics", "synthesize", "brief", "content", "produce", "schedule", "experiment", "distribute"] as const;
const GATE_AT: Record<string, string> = { brief: "HG1", content: "HG2", produce: "HG3", distribute: "HG4" };

function stateOf(stage: string, run: RunRow): "done" | "current" | "pending" | "failed" {
  const order = STAGES.indexOf(stage as typeof STAGES[number]);
  const cur = STAGES.indexOf(run.stage as typeof STAGES[number]);
  if (order < cur) return "done";
  if (order > cur) return "pending";
  if (run.status === "failed") return "failed";
  return "current";
}

const ICON = { done: "●", current: "◐", pending: "○", failed: "✕" } as const;
const COLOR = { done: "text-emerald-600", current: "text-indigo-600", pending: "text-slate-300", failed: "text-rose-600" } as const;

export function RunStageTimeline({ run, steps: _steps }: { run: RunRow; steps: StepRow[] }) {
  const gate = currentGate(run);
  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white">
      <div className="flex flex-wrap gap-3 items-center text-sm">
        {STAGES.map((s) => {
          const st = stateOf(s, run);
          const gateLabel = st === "done" && GATE_AT[s] ? ` ${GATE_AT[s]}✓` : st === "current" && GATE_AT[s] ? ` ${GATE_AT[s]}` : "";
          return (
            <span key={s} className={`flex items-center gap-1 ${COLOR[st]} ${st === "current" ? "font-semibold" : ""}`}>
              <span className="text-lg leading-none">{ICON[st]}</span>{s}{gateLabel}
            </span>
          );
        })}
      </div>
      {gate && (
        <div className="mt-3 bg-amber-50 border border-amber-300 rounded p-2 text-sm">
          ⚠ {gate} awaiting — approve in the relevant artifact section below.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: FormatCard**

```tsx
// apps/webapp/src/app/components/FormatCard.tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { SceneViewer } from "./SceneViewer.js";

type Variant = {
  id: string;
  format: string;
  aspect: "4:5" | "1:1" | "9:16" | "16:9";
  assetFiles?: { url: string }[] | null;
  approvalStatus?: string;
  organicStatus?: string;
};

export function FormatCard({ format, variants }: { format: string; variants: Variant[] }) {
  const aspects = [...new Set(variants.map((v) => v.aspect))];
  const [active, setActive] = useState<string>(aspects[0]);
  const variant = variants.find((v) => v.aspect === active);
  return (
    <div className="border border-slate-200 rounded-lg p-4 mb-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-sm m-0">{format}</h4>
        {aspects.length > 1 && (
          <div className="inline-flex border border-slate-300 rounded overflow-hidden text-xs font-semibold">
            {aspects.map((a) => (
              <button key={a} onClick={() => setActive(a)}
                      className={`px-2 py-0.5 ${a === active ? "bg-indigo-600 text-white" : "bg-white text-slate-600"}`}>
                {a}
              </button>
            ))}
          </div>
        )}
      </div>
      {variant && (
        <>
          <SceneViewer assets={variant.assetFiles ?? []} aspect={variant.aspect} />
          <div className="mt-3 text-xs flex gap-3 flex-wrap">
            <span>Approval: <b>{variant.approvalStatus ?? "—"}</b></span>
            <span>Organic: <b>{variant.organicStatus ?? "—"}</b></span>
            <Link href={`/review/creative-variants/${variant.id}`} className="text-indigo-600 hover:underline ml-auto">Edit →</Link>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Failing e2e**

```ts
// apps/webapp/tests/e2e/run-detail.spec.ts
import { test, expect } from "./fixtures";

test("run detail shows stage timeline + memo + artifacts grouped by Script", async ({ seed, page }) => {
  await seed.orchestratorRun("run_z", "produce", "waiting");
  const script = await seed.create("Scripts", {
    title: "PRS Self-Care Script",
    runId: "run_z", createdBy: "ContentGen",
    brief: "00000000-0000-0000-0000-000000000000",
  });
  await seed.create("CreativeVariants", {
    title: "Carousel 4:5",
    runId: "run_z", createdBy: "MediaProd",
    script: script.id, format: "Carousel", aspect: "4:5",
    channels: ["Meta-paid"], approvalStatus: "Awaiting Approval", organicStatus: "Draft",
  });
  await seed.create("CreativeVariants", {
    title: "Carousel 1:1",
    runId: "run_z", createdBy: "MediaProd",
    script: script.id, format: "Carousel", aspect: "1:1",
    channels: ["IG-organic"], approvalStatus: "Awaiting Approval", organicStatus: "Draft",
  });
  await seed.create("PerformanceReports", {
    title: "Memo for run_z",
    runId: "run_z", createdBy: "Brain",
    decisionMemoEn: "## Decision\n\nGo with angle A.",
  });
  await page.goto("/runs/run_z");
  await expect(page.getByText("run_z")).toBeVisible();
  await expect(page.getByText("produce", { exact: false })).toBeVisible();
  await expect(page.getByText("HG3", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Decision" })).toBeVisible();
  await expect(page.getByText("PRS Self-Care Script")).toBeVisible();
  await expect(page.getByRole("button", { name: "4:5" })).toBeVisible();
  await expect(page.getByRole("button", { name: "1:1" })).toBeVisible();
});
```

- [ ] **Step 4: Implement**

```tsx
// apps/webapp/src/app/runs/[runId]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { store } from "@engineerdad/store";
import { getRun, listSteps } from "../../lib/orchestrator.js";
import { RunStageTimeline } from "../../components/RunStageTimeline.js";
import { DecisionMemo } from "../../components/DecisionMemo.js";
import { FormatCard } from "../../components/FormatCard.js";
import { LanguageToggle, langFromSearchParams } from "../../components/LanguageToggle.js";

type SP = { lang?: string; view?: string };

export default async function RunDetail({
  params, searchParams,
}: { params: Promise<{ runId: string }>; searchParams: Promise<SP> }) {
  const { runId } = await params;
  const sp = await searchParams;
  const lang = langFromSearchParams(sp);
  const [run, steps, scripts, variants, perfRows, articles, hypotheses, experiments] = await Promise.all([
    getRun(runId),
    listSteps(runId),
    store.query("Scripts", { runId }),
    store.query("CreativeVariants", { runId }),
    store.query("PerformanceReports", { runId }),
    store.query("AuthorityArticles", { runId }),
    store.query("Hypotheses", { runId }),
    store.query("Experiments", { runId }),
  ]);
  if (!run) notFound();

  const byScript = new Map<string, { script: typeof scripts[number]; byFormat: Map<string, typeof variants> }>();
  for (const s of scripts) {
    byScript.set(s.id as string, { script: s, byFormat: new Map() });
  }
  for (const v of variants) {
    const scriptId = (v as Record<string, unknown>).script as string;
    const fmt = (v as Record<string, unknown>).format as string;
    const slot = byScript.get(scriptId);
    if (!slot) continue;
    const arr = slot.byFormat.get(fmt) ?? [];
    arr.push(v);
    slot.byFormat.set(fmt, arr);
  }

  const memoRow = perfRows[0] ?? null;
  const startedAt = run.createdAt.toLocaleString("en-MY");

  return (
    <div className="space-y-6">
      <header className="pb-4 border-b border-slate-200">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <Link href="/runs" className="text-sm text-slate-500 hover:underline">← Runs</Link>
            <h1 className="text-2xl font-mono font-bold m-0">{run.runId}</h1>
            <p className="text-sm text-slate-500 m-0">Started {startedAt} · stage: {run.stage}</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href={`?view=${sp.view === "debug" ? "" : "debug"}${lang === "ms" ? "&lang=ms" : ""}`}
                  className="text-xs border border-slate-300 rounded px-2 py-1 hover:bg-slate-100">
              {sp.view === "debug" ? "Timeline" : "Debug"}
            </Link>
            <LanguageToggle lang={lang} />
          </div>
        </div>
      </header>

      {sp.view === "debug"
        ? null /* E7 — step table */
        : <RunStageTimeline run={run} steps={steps} />}

      <section className="border border-slate-200 rounded-lg p-5 bg-white">
        <DecisionMemo row={memoRow as never} lang={lang} />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Artifacts</h2>
        {[...byScript.values()].map(({ script, byFormat }) => (
          <details key={script.id as string} open className="mb-4 border border-slate-200 rounded-lg p-4 bg-white">
            <summary className="cursor-pointer flex items-center gap-3">
              <span className="font-semibold">Script · {String(script.title ?? "(untitled)")}</span>
              <span className="bg-slate-100 px-2 py-0.5 rounded text-xs">{String((script as Record<string, unknown>).approvalStatus ?? "")}</span>
              <Link href={`/review/scripts/${script.id}`} className="ml-auto text-xs text-indigo-600 hover:underline">Open →</Link>
            </summary>
            <div className="mt-3 space-y-3">
              {[...byFormat.entries()].map(([fmt, vs]) => (
                <FormatCard key={fmt} format={fmt} variants={vs as never} />
              ))}
            </div>
          </details>
        ))}
        {byScript.size === 0 && <p className="text-slate-500 text-sm">No scripts produced yet for this run.</p>}
      </section>

      <section className="text-sm border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold mb-2">Other artifacts in this run</h3>
        <ul className="space-y-1">
          <li>Authority Articles ({articles.length}): {articles.map((a) =>
            <Link key={a.id as string} href={`/review/authority-articles/${a.id}`} className="text-indigo-600 hover:underline mr-2">{String(a.title)}</Link>)}</li>
          <li>Hypotheses ({hypotheses.length}): {hypotheses.map((h) =>
            <Link key={h.id as string} href={`/review/hypotheses/${h.id}`} className="text-indigo-600 hover:underline mr-2">{String(h.title)}</Link>)}</li>
          <li>Experiments ({experiments.length}): {experiments.map((e) =>
            <Link key={e.id as string} href={`/review/experiments/${e.id}`} className="text-indigo-600 hover:underline mr-2">{String(e.title)}</Link>)}</li>
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Run e2e**

```bash
pnpm --filter @engineerdad/webapp test:e2e run-detail
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/app/runs apps/webapp/src/app/components/RunStageTimeline.tsx apps/webapp/src/app/components/FormatCard.tsx apps/webapp/tests/e2e/run-detail.spec.ts
git commit -m "feat(webapp): /runs/[runId] with stage timeline, memo, Script-grouped artifacts"
```

### Task E7: Run detail debug view (step table + payload page)

**Files:**
- Create: `apps/webapp/src/app/components/RunStepTable.tsx`
- Modify: `apps/webapp/src/app/runs/[runId]/page.tsx` — render step table when `?view=debug`
- Create: `apps/webapp/src/app/runs/[runId]/payload/[stepResultId]/page.tsx`

- [ ] **Step 1: RunStepTable**

```tsx
// apps/webapp/src/app/components/RunStepTable.tsx
import Link from "next/link";
import type { RunRow, StepRow } from "../lib/orchestrator.js";

export function RunStepTable({ run, steps }: { run: RunRow; steps: StepRow[] }) {
  const failed = steps.filter((s) => s.status === "failed" || s.problems?.length);
  return (
    <div>
      {failed.length > 0 && (
        <div className="mb-3 bg-rose-50 border border-rose-300 rounded p-3 text-sm">
          {failed.length} step{failed.length === 1 ? "" : "s"} failed or carry problems. Inspect below.
        </div>
      )}
      <table className="w-full text-xs font-mono">
        <thead><tr className="text-left text-slate-500">
          <th className="py-1">step_id</th><th>stage</th><th>status</th><th>attempts</th><th>problems</th><th>updated</th><th>payload</th>
        </tr></thead>
        <tbody>
        {steps.map((s) => {
          const resultObj = s.result as Record<string, unknown> | null;
          const ref = resultObj && typeof resultObj.stepResultId === "string" ? resultObj.stepResultId : null;
          return (
            <tr key={s.stepId} className={`border-t border-slate-200 ${s.status === "failed" ? "bg-rose-50" : ""}`}>
              <td className="py-1">{s.stepId}</td>
              <td>{s.stage}</td>
              <td>{s.status}</td>
              <td>{s.attempts}</td>
              <td className="text-rose-700">{s.problems?.join("; ")}</td>
              <td>{s.updatedAt.toLocaleTimeString("en-MY")}</td>
              <td>{ref ? <Link href={`/runs/${run.runId}/payload/${ref}`} className="text-indigo-600 hover:underline">view</Link> : "—"}</td>
            </tr>
          );
        })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Plug into run-detail page**

```tsx
// apps/webapp/src/app/runs/[runId]/page.tsx — change conditional + add import
import { RunStepTable } from "../../components/RunStepTable.js";

// Replace the conditional:
{sp.view === "debug"
  ? <RunStepTable run={run} steps={steps} />
  : <RunStageTimeline run={run} steps={steps} />}
```

- [ ] **Step 3: Payload page**

```tsx
// apps/webapp/src/app/runs/[runId]/payload/[stepResultId]/page.tsx
import { loadStepPayload } from "../../../../lib/orchestrator.js";
import Link from "next/link";

export default async function Payload({
  params,
}: { params: Promise<{ runId: string; stepResultId: string }> }) {
  const { runId, stepResultId } = await params;
  let payload: unknown;
  try { payload = await loadStepPayload(stepResultId); }
  catch (e) { payload = { error: e instanceof Error ? e.message : String(e) }; }
  return (
    <div>
      <Link href={`/runs/${runId}?view=debug`} className="text-sm text-slate-500 hover:underline">← Run {runId}</Link>
      <h1 className="text-xl font-bold mt-2 mb-3">Payload <code className="text-base">{stepResultId}</code></h1>
      <pre className="bg-slate-50 border border-slate-200 rounded p-4 text-xs overflow-auto">{JSON.stringify(payload, null, 2)}</pre>
    </div>
  );
}
```

- [ ] **Step 4: Manual smoke**

```bash
pnpm --filter @engineerdad/webapp test:e2e run-detail
```
Optionally extend run-detail.spec.ts to click the Debug button and assert table appears.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/app/components/RunStepTable.tsx apps/webapp/src/app/runs/[runId]/page.tsx apps/webapp/src/app/runs/[runId]/payload
git commit -m "feat(webapp): run detail debug view — step table + payload page"
```

---

## Phase F — Cutover (3 tasks)

### Task F1: Update stage HUMAN GATE links to /review/ prefix

**Files:**
- Modify: `packages/orchestrator/src/stages/brief.ts:62`
- Modify: `packages/orchestrator/src/stages/content.ts:136`
- Modify: `packages/orchestrator/src/stages/produce.ts:540`

- [ ] **Step 1: Edit each message**

- `brief.ts:62` — change `${reviewUiUrl()}/briefs` to `${reviewUiUrl()}/review/briefs`
- `content.ts:136` — change `${reviewUiUrl()}/scripts` to `${reviewUiUrl()}/review/scripts` and `${reviewUiUrl()}/authority-articles` to `${reviewUiUrl()}/review/authority-articles`
- `produce.ts:540` — change `${reviewUiUrl()}/creative-variants` to `${reviewUiUrl()}/review/creative-variants`

- [ ] **Step 2: Update unit tests that reference the URL path**

```bash
grep -rn "reviewUiUrl\|/briefs\|/scripts\|/creative-variants" packages/orchestrator/src/stages/*.test.ts | head -10
```
Update any string-match assertions to the new path.

- [ ] **Step 3: Build + test**

```bash
pnpm -r build
pnpm --filter @engineerdad/orchestrator test
```
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/stages
git commit -m "refactor(stages): point HUMAN GATE links at /review/<slug>"
```

### Task F2: Delete old root-level /[entity] and /[entity]/[id] routes

**Files:**
- Delete: `apps/webapp/src/app/[entity]/page.tsx`
- Delete: `apps/webapp/src/app/[entity]/[id]/page.tsx`

- [ ] **Step 1: Remove the directories**

```bash
git rm -r apps/webapp/src/app/\[entity\]
```

- [ ] **Step 2: Verify build**

```bash
pnpm -r build
```

- [ ] **Step 3: Verify no lingering references**

```bash
grep -rn 'href="/briefs\|href="/scripts\|href="/creative-variants\|href="/experiments\|href="/hypotheses\|href="/learnings\|href="/authority-articles\|href="/performance-reports' apps/webapp/src/ 2>/dev/null
```
Expected: empty.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(webapp): delete old root-level /[entity] routes; /review/[entity] is canonical"
```

### Task F3: Final smoke pass + PR-ready

- [ ] **Step 1: Full test sweep**

```bash
pnpm -r build
pnpm -r test
pnpm --filter @engineerdad/webapp test:e2e
```
Expected: all green. Pre-existing 4 e2e specs (list, detail-edit, status-flip, markdown-preview) need URL updates from `/briefs` → `/review/briefs` etc. — fix as part of F3.

- [ ] **Step 2: Manual sanity checklist**

- Visit `/` — Dashboard renders with "Browse runs" CTA
- Click Runs → All runs — list renders
- Click a run → run detail with stage timeline, memo, artifact sections
- Toggle to `?view=debug` — step table renders; failed steps highlighted
- Click Marketing Review → Creative Variants — list renders with channels column + org status
- Filter by channel — list narrows
- Open a CreativeVariant detail — IG-style scene viewer renders, aspect tabs work if siblings exist, edit toggle flips form
- Approve a brief from /review/briefs/[id] — status pill flips to Approved
- Switch language toggle EN ↔ BM — bilingual fields swap

- [ ] **Step 3: Open PR**

```bash
gh pr create --title "Webapp redesign — run-centric IA + entity-detail overhaul + asset preview" --body "$(cat <<'EOF'
## Summary
- Rename apps/review-ui → apps/webapp; package @engineerdad/webapp; helper reviewUiUrl() → webappUrl() with REVIEW_UI_URL fallback.
- Run-centric IA: /runs and /runs/[runId] as the anchor; entity lists move under /review/[entity].
- Per-entity declarative layouts (8 files) for detail pages; read-by-default with Edit toggle; EN/BM language toggle.
- CreativeVariants list: new Channels + Organic columns + filters. Hypotheses + Experiments custom list configs added.
- IG-style SceneViewer (single hero + dots + arrow keys) embedded on CreativeVariant detail and on the Run page's Script-grouped artifact section.
- Decision Memo viewer (markdown + bandit allocation + self-critique + copy-as-md) used on Run page and PerformanceReports detail.
- Dev /api/asset/[runId]/[variantId]/[scene] route for file:// rewrites (dead code once E-007 R2 swap lands).

## Spec + plan
- docs/superpowers/specs/2026-05-25-webapp-redesign-design.html
- docs/superpowers/plans/2026-05-25-webapp-redesign.html (and .md twin)

## Test plan
- [ ] pnpm -r test — all packages green
- [ ] pnpm --filter @engineerdad/webapp test:e2e — entity list, entity detail, runs list, run detail, asset route, language toggle
- [ ] Manual: walk a real run; HG3 awaiting banner shows; Approve flow flips status

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Spec coverage map

| Spec section | Implementing task(s) |
|---|---|
| §1 Context (narrative) | n/a |
| §2 Rename | A3, A4, A5 |
| §2 Run-centric IA | E5, E6, E7 |
| §2 Decision Memo surface | C3, E6, D2/E4 |
| §2 Entity detail layout system | B1, C5, C6, D1–D3, E4 |
| §2 Per-entity list config | D4, E3, E5 |
| §2 Asset preview | B3, B4, C2, E4 overlay, E6 FormatCard |
| §2 Orchestrator run state | A2, B2, B5, E5, E6, E7 |
| §3 Routes + left nav | E1, E2, E3, E4, E5, E6, E7, B4 |
| §4 Entity detail layout (roles + Raw fields) | B1, C5, C6, D1–D3 |
| §5 Entity list system + channels-in-JS | D4, E3 |
| §6 Decision Memo viewer | A2 (gfm dep), C3 |
| §7 Run detail + /runs index + data composition | E5, E6, E7 |
| §8 SceneViewer + asset route + resolveAssetUrl | B3, B4, C2 |
| §9 Orchestrator state binding | A2 (sql export), B2 |
| §10 Rename plan (6-layer commit sequence) | A1–A5, F1, F2, F3 |
| §11 Risk register | Mitigated via task sequencing |
| §12 Deps + prereqs (remark-gfm) | A2 |
| §13 Open questions for plan | Deferred — non-blockers |

Every spec section maps to one or more tasks. No gaps.
