# Meta-paid Unblock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close B-025 + B-026 + B-027 and add the webapp angle-visibility surface so a multi-angle `/loop-once` lands ≥1 Meta-paid PAUSED campaign with ≥1 adset per occupied cell (Carousel + Feed creatives) in Ads Manager.

**Architecture:** Three independent bug fixes plus a webapp surface, sequenced as: schema migration → B-025 (experiment tri-state verifier + writer) → B-027 (Meta-paid D2a planner + MCP schema) → B-026 (brief-writer angle taxonomy enforcement) → /reflect downstream → webapp visibility → manual E2E acceptance walk. Each layer is testable independently with vitest unit tests; the final acceptance is a real `/loop-once` to HG4 against a test Meta ad account.

**Tech Stack:** TypeScript / pnpm monorepo · Drizzle ORM over Postgres 16 · Next.js 15 App Router (apps/webapp) · vitest · MCP stdio servers · Claude Code agentic subagents.

**Spec:** `docs/superpowers/specs/2026-05-29-meta-paid-unblock-design.html`

---

## Repo conventions to respect

- **Always `pnpm -r build` sequentially** — never `--parallel` (races on `@engineerdad/shared`). After webapp changes, either kill `next dev` first or skip the webapp: `pnpm -r --filter='!@engineerdad/webapp' build`.
- **Branch sandbox DB workflow** — `pnpm db:sandbox` once per branch (and after every `schema.ts` change); `pnpm db:generate` to produce SQL; commit `schema.ts` + the generated `packages/*/drizzle/` files together. `pnpm lint:migrations` enforces this.
- **Single test run** — `pnpm vitest run <path>` or `pnpm vitest run <path> -t "<test name>"`.
- **Restart Claude Code** after editing `.mcp.json`, `.claude/settings.json`, or after the first `pnpm db:sandbox` on a branch (MCP layer freezes its DB URL at session start).
- **DB queries** — `docker exec engineerdad-postgres psql -U engineerdad -d <db> -c "..."`. No Node `pg` scripts.
- **Agent prompt edits** — `.claude/agents/<name>.md` is the runtime file. Fragments under `packages/shared/src/prompts/` (`bilingual.md`, `house-style.md`, `tactical-piliero.md`) are pasted by `pnpm sync:agents`. There is no `packages/shared/src/prompts/brief-writer.md` — edit `.claude/agents/brief-writer.md` directly.

---

## Pre-flight (do once before Task 1)

- [ ] **Step P1: Confirm clean branch + working DB**

```bash
git status                                # working tree clean (besides expected)
git checkout -b feat/meta-paid-unblock
pnpm db:sandbox                           # creates sandbox DB; writes DATABASE_URL to .env.local
docker exec engineerdad-postgres psql -U engineerdad -d engineerdad -c "SELECT COUNT(*) FROM experiments;"
# Expected: count = 0 (matches spec §3.2.2 backfill claim)
docker exec engineerdad-postgres psql -U engineerdad -d engineerdad -c "SELECT COUNT(*) FROM briefs WHERE angle IS NULL;"
# Expected: count = 0 (matches spec §3.1.5 backfill claim)
```

If either count is non-zero, STOP and revisit the migration strategy with the spec author before proceeding.

- [ ] **Step P2: Restart Claude Code** so the MCP layer picks up the sandbox `DATABASE_URL` from `.env.local`.

---

## Part A — Schema foundation

### Task 1: Add `experiment_status` column + tighten `briefs.angle` to NOT NULL

**Files:**
- Modify: `packages/store/src/schema.ts`
- Create: `packages/store/drizzle/<auto-named>.sql` (generated)
- Test: `packages/store/src/schema.test.ts` (extend if exists; create otherwise)

- [ ] **Step 1: Modify schema.ts**

Open `packages/store/src/schema.ts`. Find the `briefs` table definition (the `pgTable("briefs", { ... })` block, around line 75 — it has `persona`, `angle`, `funnelStage`, `budgetBucket`).

Change:
```ts
  angle: text("angle"),
```
to:
```ts
  angle: text("angle").notNull(),
```

Find the `experiments` table definition (also a `pgTable("experiments", { ... })` block). Add this column, placed alphabetically near the other text columns:
```ts
  experimentStatus: text("experiment_status").notNull(),
```

- [ ] **Step 2: Push schema to sandbox + generate migration**

```bash
pnpm db:sandbox          # re-pushes schema to branch sandbox
pnpm db:generate         # produces SQL under packages/store/drizzle/
```

Inspect the generated SQL file. Expected: one `ALTER TABLE briefs ALTER COLUMN angle SET NOT NULL;` plus one `ALTER TABLE experiments ADD COLUMN experiment_status text NOT NULL;`. No other changes.

- [ ] **Step 3: Run lint:migrations**

```bash
pnpm lint:migrations
```

Expected: PASS (schema.ts + generated SQL committed together once Step 5 commits).

- [ ] **Step 4: Verify migration applied to sandbox**

```bash
SANDBOX_DB=$(grep DATABASE_URL .env.local | sed 's|.*/||')
docker exec engineerdad-postgres psql -U engineerdad -d $SANDBOX_DB -c "\d experiments"
docker exec engineerdad-postgres psql -U engineerdad -d $SANDBOX_DB -c "\d briefs"
```

Expected: `experiment_status text not null` on the experiments table; `angle text not null` on the briefs table.

- [ ] **Step 5: Commit**

```bash
git add packages/store/src/schema.ts packages/store/drizzle/
git commit -m "feat(store): add experiments.experiment_status; tighten briefs.angle NOT NULL

Spec §3.1.5 + §3.2.2. Live verified 0 affected rows on engineerdad
before migration. Closes part of B-025 + B-026 prerequisites."
```

---

### Task 2: Add `ExperimentStatus` union + `classifyExperimentStatus` helper to shared

**Files:**
- Modify: `packages/shared/src/zod.ts` (or wherever ExperimentParams lives — check imports in `experiment.ts`)
- Create: `packages/shared/src/experiment-status.ts`
- Create: `packages/shared/src/experiment-status.test.ts`
- Modify: `packages/shared/src/index.ts` (re-export)

- [ ] **Step 1: Locate the right home for the union**

```bash
grep -rn "ExperimentParams" packages/shared/src/
```

If `ExperimentParams` is in `zod.ts`, add the union there. Otherwise add it next to the existing experiment-related types. The plan assumes `zod.ts` below — adjust to match what `grep` shows.

- [ ] **Step 2: Add the union**

In the discovered file, add:
```ts
export const EXPERIMENT_STATUS = ["full", "degraded", "single-cell", "broken"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUS)[number];
```

- [ ] **Step 3: Write the failing test for the helper**

Create `packages/shared/src/experiment-status.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { classifyExperimentStatus } from "./experiment-status.js";

describe("classifyExperimentStatus", () => {
  it("returns 'full' when every cell is occupied", () => {
    expect(classifyExperimentStatus({ occupied: 3, total: 3 })).toBe("full");
    expect(classifyExperimentStatus({ occupied: 1, total: 1 })).toBe("full");
  });

  it("returns 'degraded' when ≥2 occupied and ≥1 empty", () => {
    expect(classifyExperimentStatus({ occupied: 2, total: 3 })).toBe("degraded");
    expect(classifyExperimentStatus({ occupied: 4, total: 5 })).toBe("degraded");
  });

  it("returns 'single-cell' when exactly 1 occupied", () => {
    expect(classifyExperimentStatus({ occupied: 1, total: 3 })).toBe("single-cell");
    expect(classifyExperimentStatus({ occupied: 1, total: 2 })).toBe("single-cell");
  });

  it("returns 'broken' when 0 occupied", () => {
    expect(classifyExperimentStatus({ occupied: 0, total: 3 })).toBe("broken");
    expect(classifyExperimentStatus({ occupied: 0, total: 0 })).toBe("broken");
  });
});
```

Run and confirm it fails:
```bash
pnpm vitest run packages/shared/src/experiment-status.test.ts
```
Expected: FAIL with `Cannot find module './experiment-status.js'`.

- [ ] **Step 4: Implement the helper**

Create `packages/shared/src/experiment-status.ts`:
```ts
import type { ExperimentStatus } from "./zod.js"; // or wherever the union landed

export function classifyExperimentStatus(input: { occupied: number; total: number }): ExperimentStatus {
  const { occupied, total } = input;
  if (occupied === 0) return "broken";
  if (occupied === 1) return "single-cell";
  if (occupied >= 2 && occupied < total) return "degraded";
  return "full"; // occupied === total
}
```

- [ ] **Step 5: Re-export from index**

In `packages/shared/src/index.ts`, add:
```ts
export * from "./experiment-status.js";
```

- [ ] **Step 6: Run the test, then build the package**

```bash
pnpm vitest run packages/shared/src/experiment-status.test.ts
pnpm --filter @engineerdad/shared build
```
Both expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/
git commit -m "feat(shared): add ExperimentStatus union + classifyExperimentStatus helper

Spec §3.2.1 + §3.2.3. Shared by verify-experiment and the webapp's
HG1 approval-guidance preview so the two cannot diverge."
```

---

## Part B — B-025: experiment tri-state

### Task 3: Update `verify-experiment` to return tri-state

**Files:**
- Modify: `packages/orchestrator/src/verifiers/verify-experiment.ts`
- Modify: `packages/orchestrator/src/types.ts` (extend `VerifyResult` if it has no `data` field)
- Modify: `packages/orchestrator/src/verifiers/verify-experiment.test.ts` (likely exists)

- [ ] **Step 1: Check whether `VerifyResult` already carries a `data` field**

```bash
grep -n "interface VerifyResult\|type VerifyResult" packages/orchestrator/src/types.ts
```

If `VerifyResult` is `{ ok: boolean; problems: string[] }` only, extend it:
```ts
export interface VerifyResult {
  ok: boolean;
  problems: string[];
  data?: Record<string, unknown>;
}
```

(Optional `data` keeps every existing caller backward compatible.)

- [ ] **Step 2: Write failing tests for verify-experiment**

In `packages/orchestrator/src/verifiers/verify-experiment.test.ts` (extend existing or create), add:
```ts
import { describe, expect, it } from "vitest";
import { verifyExperiment } from "./verify-experiment.js";
import type { AllocatedCell } from "../experiment/allocation.js";

function cell(id: string, n: number, pct = 33.3): AllocatedCell {
  return {
    cellId: id,
    factorLevels: { angle: id },
    variantPageIds: Array.from({ length: n }, (_, i) => `v_${id}_${i}`),
    allocationPct: pct,
  };
}

describe("verifyExperiment tri-state", () => {
  it("3-of-3 cells occupied → full + ok", () => {
    const r = verifyExperiment([cell("A", 1), cell("B", 1), cell("C", 1, 33.4)], true);
    expect(r.ok).toBe(true);
    expect(r.data?.experimentStatus).toBe("full");
  });

  it("2-of-3 cells occupied → degraded + ok", () => {
    const r = verifyExperiment([cell("A", 1), cell("B", 1), cell("C", 0, 33.4)], true);
    expect(r.ok).toBe(true);
    expect(r.data?.experimentStatus).toBe("degraded");
  });

  it("1-of-3 cells occupied → single-cell + ok", () => {
    const r = verifyExperiment([cell("A", 1), cell("B", 0), cell("C", 0, 33.4)], true);
    expect(r.ok).toBe(true);
    expect(r.data?.experimentStatus).toBe("single-cell");
  });

  it("0-of-3 cells occupied → broken + ok:false", () => {
    const r = verifyExperiment([cell("A", 0), cell("B", 0), cell("C", 0, 33.4)], true);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/all cells empty/i);
  });

  it("still fails when experiment row not created", () => {
    const r = verifyExperiment([cell("A", 1)], false);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.includes("not created"))).toBe(true);
  });
});
```

Run and confirm failures:
```bash
pnpm vitest run packages/orchestrator/src/verifiers/verify-experiment.test.ts
```
Expected: the tri-state tests FAIL (no `data.experimentStatus`); the "still fails when not created" test passes (existing behavior).

- [ ] **Step 3: Rewrite verify-experiment.ts**

Replace the file with:
```ts
import type { VerifyResult } from "../types.js";
import type { AllocatedCell } from "../experiment/allocation.js";
import { classifyExperimentStatus, type ExperimentStatus } from "@engineerdad/shared";

/**
 * Tri-state acceptance test. `full` / `degraded` / `single-cell` all pass;
 * `broken` (zero occupied cells) fails. The status is carried in `data` so
 * X3-write can persist it without recomputing. Allocation arithmetic is
 * still required to sum to 100.
 *
 * Spec: docs/superpowers/specs/2026-05-29-meta-paid-unblock-design.html §3.2
 */
export function verifyExperiment(
  cells: AllocatedCell[],
  experimentRowCreated: boolean,
): VerifyResult {
  const problems: string[] = [];

  if (!experimentRowCreated) problems.push("Experiment row was not created");

  if (cells.length === 0) {
    problems.push("experiment design produced no cells");
    return { ok: false, problems };
  }

  const occupied = cells.filter((c) => c.variantPageIds.length > 0).length;
  const experimentStatus: ExperimentStatus = classifyExperimentStatus({
    occupied,
    total: cells.length,
  });

  if (experimentStatus === "broken") {
    problems.push("all cells empty: no approved variants mapped to any cell");
  }

  const sum = cells.reduce((a, c) => a + c.allocationPct, 0);
  if (Math.abs(sum - 100) > 0.5) {
    problems.push(`allocation sums to ${sum}, expected 100`);
  }

  return { ok: problems.length === 0, problems, data: { experimentStatus } };
}
```

- [ ] **Step 4: Run tests + build**

```bash
pnpm vitest run packages/orchestrator/src/verifiers/verify-experiment.test.ts
pnpm --filter @engineerdad/orchestrator build
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/verifiers/verify-experiment.ts packages/orchestrator/src/verifiers/verify-experiment.test.ts packages/orchestrator/src/types.ts
git commit -m "feat(orchestrator): verify-experiment tri-state (B-025)

Spec §3.2.3. full/degraded/single-cell pass; broken fails. Status
carried in VerifyResult.data so X3-write can persist without
recomputing. Closes the empty-cell halt — degraded experiments now
flow through to distribute."
```

---

### Task 4: X3-write persists `experimentStatus`

**Files:**
- Modify: `packages/orchestrator/src/stages/experiment.ts`
- Modify: `packages/orchestrator/src/stages/experiment.test.ts` (likely exists; extend)

- [ ] **Step 1: Locate X2-verify's result handoff to X3-write**

Read `packages/orchestrator/src/stages/experiment.ts` around line 200 — find the `x3Write` step definition. Note how it currently builds the `mcp__store__create` call with `props: { runId: run.runId, cells: JSON.stringify(cells) }`.

The verifier's `data.experimentStatus` lives on the X2-design step's `run.steps[i].verifyResult.data` (the orchestrator framework stores the verify result alongside the step result — check the exact shape by reading `packages/orchestrator/src/engine.ts:80–135`).

If the framework does not expose `verifyResult` on `RunState.steps[i]`, the simplest fix is for X3-write to recompute the status from the same `allocatedCellsFor(run)` it already calls:

```ts
const cells = allocatedCellsFor(run);
const occupied = cells.filter((c) => c.variantPageIds.length > 0).length;
const experimentStatus = classifyExperimentStatus({ occupied, total: cells.length });
```

Pick whichever path matches the codebase. The plan below uses the recompute path because it avoids a framework change.

- [ ] **Step 2: Write a failing test for experimentStatus persistence**

In `packages/orchestrator/src/stages/experiment.test.ts`, add (or extend an existing X3 test):
```ts
it("X3-write includes experimentStatus in the create call (degraded case)", () => {
  // Construct a RunState where allocatedCellsFor(run) yields 2-of-3 occupied.
  const run = makeRunWith2of3Cells(); // helper that mirrors existing test setup
  const step = x3Write.build(run);
  expect(step.kind).toBe("write");
  if (step.kind !== "write") throw new Error("expected write step");
  const createCall = step.calls.find(
    (c) => c.tool === "mcp__store__create" && c.label === "experiment",
  );
  expect(createCall).toBeDefined();
  const props = (createCall!.args as { props: Record<string, unknown> }).props;
  expect(props.experimentStatus).toBe("degraded");
});
```

If `makeRunWith2of3Cells` doesn't exist, look at how the existing X3 test seeds a run (mirroring the X1-query rows). Copy that pattern.

Run, confirm failure:
```bash
pnpm vitest run packages/orchestrator/src/stages/experiment.test.ts -t "experimentStatus"
```
Expected: FAIL (props.experimentStatus is undefined).

- [ ] **Step 3: Update X3-write to include experimentStatus**

In `experiment.ts`, find the `x3Write` step and the `mcp__store__create` call. Import the helper:
```ts
import { classifyExperimentStatus } from "@engineerdad/shared";
```

In the `build` function, after `const cells = allocatedCellsFor(run);`, add:
```ts
const occupied = cells.filter((c) => c.variantPageIds.length > 0).length;
const experimentStatus = classifyExperimentStatus({
  occupied,
  total: cells.length,
});
```

Update the `props` object:
```ts
props: {
  runId: run.runId,
  cells: JSON.stringify(cells),
  experimentStatus,
},
```

- [ ] **Step 4: Run test + build**

```bash
pnpm vitest run packages/orchestrator/src/stages/experiment.test.ts
pnpm --filter @engineerdad/orchestrator build
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/stages/experiment.ts packages/orchestrator/src/stages/experiment.test.ts
git commit -m "feat(orchestrator): X3-write persists experimentStatus (B-025)

Spec §3.2.4. Status computed from the same allocatedCellsFor(run)
the step already calls; persisted on every Experiments row (full,
degraded, single-cell all pass-states write it)."
```

---

### Task 5: Update store CRUD validator to accept the new column

**Files:**
- Modify: `packages/store/src/crud.ts` (or wherever the CRUD layer enforces enum membership — check `grep -rn "EXPERIMENT_STATUS\|experimentStatus" packages/store/src/`)
- Test: `packages/store/src/crud.test.ts`

- [ ] **Step 1: Locate the CRUD validator for Experiments writes**

```bash
grep -rn "Experiments\|experiments" packages/store/src/crud.ts packages/store/src/validators*.ts 2>/dev/null | head -20
```

Find where Experiments row props get validated. If there is no per-entity prop validator, this task may be a no-op — text columns accept any value. Skip to Step 4 in that case.

- [ ] **Step 2: Write a failing test for enum validation (if validator exists)**

```ts
it("rejects Experiments rows with an unknown experimentStatus", async () => {
  await expect(
    store.create("Experiments", { runId: "r", cells: "[]", experimentStatus: "nonsense" }),
  ).rejects.toThrow(/experimentStatus/);
});

it("accepts each valid ExperimentStatus value", async () => {
  for (const s of ["full", "degraded", "single-cell", "broken"]) {
    const row = await store.create("Experiments", {
      runId: "r",
      cells: "[]",
      experimentStatus: s,
    });
    expect(row.experimentStatus).toBe(s);
  }
});
```

- [ ] **Step 3: Add the enum check**

In the Experiments writer (if any), import `EXPERIMENT_STATUS` from `@engineerdad/shared` and assert `EXPERIMENT_STATUS.includes(props.experimentStatus)`. Mirror whatever pattern the existing per-entity validators use.

- [ ] **Step 4: Run tests + build**

```bash
pnpm vitest run packages/store/
pnpm --filter @engineerdad/store build
```

- [ ] **Step 5: Commit (only if changes made)**

```bash
git add packages/store/src/
git commit -m "feat(store): validate Experiments.experimentStatus against enum

Spec §3.2.2. Membership check at the CRUD boundary per E-029
no-Postgres-CHECK convention."
```

---

### Task 6: Wire `experimentStatus` into the X3-write → `data` round-trip (optional cleanup)

If Task 4 used the recompute path, this task is a no-op — skip and proceed to Part C.

If Task 4 used the data-handoff path (X2-verify's `VerifyResult.data` consumed by X3-write), confirm `RunState.steps[i].verifyResult` is populated in the engine and that the live walk wires correctly by running:
```bash
pnpm vitest run packages/orchestrator/src/
```

No additional commit — covered by Task 4's commit.

---

## Part C — B-027: Meta-paid D2a setup

### Task 7: Look up Meta locale IDs via Graph API

**Files:**
- Create: `scripts/lookup-meta-locale-ids.mjs`

- [ ] **Step 1: Write the lookup script**

Create `scripts/lookup-meta-locale-ids.mjs`:
```js
#!/usr/bin/env node
// One-shot lookup of Meta ad-locale IDs for English (US) and Malay.
// Run once at implementation time; paste the IDs into plan-distribution.ts.
// Re-run anytime Meta's API changes.

import "dotenv/config";

const TOKEN = process.env.META_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("META_ACCESS_TOKEN missing from environment (.env or .env.local).");
  process.exit(1);
}

async function lookup(q) {
  const url = `https://graph.facebook.com/v18.0/search?type=adlocale&q=${encodeURIComponent(q)}&access_token=${TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Lookup failed for "${q}": ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const json = await res.json();
  return json.data ?? [];
}

const english = await lookup("English");
const malay = await lookup("Malay");

console.log("\n=== Candidates for English ===");
for (const r of english.slice(0, 10)) console.log(`  ${r.key}\t${r.name}`);

console.log("\n=== Candidates for Malay ===");
for (const r of malay.slice(0, 10)) console.log(`  ${r.key}\t${r.name}`);

console.log("\nPaste the chosen `key` values into LOCALE_ID in");
console.log("packages/orchestrator/src/distribute/plan-distribution.ts");
```

- [ ] **Step 2: Run the script**

```bash
node scripts/lookup-meta-locale-ids.mjs
```

Expected: lists with `(key)  (name)` lines. Identify:
- For English: the row whose name is **"English (US)"** — note its integer `key`.
- For Malay: the row whose name is **"Malay"** (probably `ms_MY` in `language` field if shown) — note its integer `key`.

Write both IDs down — you'll paste them into Task 9.

- [ ] **Step 3: Commit the script**

```bash
git add scripts/lookup-meta-locale-ids.mjs
git commit -m "chore(scripts): one-shot Meta ad-locale ID lookup helper

Spec §3.3.3. Used at implementation time to discover the integer
locale IDs for en_US and ms_MY before pasting into the planner."
```

---

### Task 8: Add `is_adset_budget_sharing_enabled` to `create_campaign` MCP

**Files:**
- Modify: `mcp-servers/meta-ads/src/tools/create-campaign.ts`
- Test: `mcp-servers/meta-ads/src/tools/create-campaign.test.ts` (likely exists; extend)

- [ ] **Step 1: Inspect the current schema + Graph forwarder**

```bash
cat mcp-servers/meta-ads/src/tools/create-campaign.ts
```

Note the Zod input schema and the `fetch(...)` / Graph POST body assembly.

- [ ] **Step 2: Write the failing test**

In `create-campaign.test.ts`, add:
```ts
it("forwards is_adset_budget_sharing_enabled to Graph when set", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ id: "c_1" }), { status: 200 }),
  );
  await createCampaign({
    name: "test",
    objective: "OUTCOME_LEADS",
    is_adset_budget_sharing_enabled: true,
  });
  const body = fetchSpy.mock.calls[0][1]?.body;
  expect(String(body)).toContain("is_adset_budget_sharing_enabled");
  fetchSpy.mockRestore();
});

it("defaults is_adset_budget_sharing_enabled to false (omitted from body)", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ id: "c_2" }), { status: 200 }),
  );
  await createCampaign({ name: "test", objective: "OUTCOME_LEADS" });
  const body = String(fetchSpy.mock.calls[0][1]?.body);
  // Should be present with false (Meta needs the explicit value), not absent.
  expect(body).toMatch(/is_adset_budget_sharing_enabled.*false/);
  fetchSpy.mockRestore();
});
```

Run, confirm failure:
```bash
pnpm vitest run mcp-servers/meta-ads/src/tools/create-campaign.test.ts
```

- [ ] **Step 3: Add the field to the Zod input schema**

In `create-campaign.ts`, find the input schema (`z.object({ ... })`) and add:
```ts
  is_adset_budget_sharing_enabled: z.boolean().optional().default(false),
```

Find the Graph POST body assembly and include the field in the body:
```ts
const body = new URLSearchParams({
  // ... existing fields ...
  is_adset_budget_sharing_enabled: String(args.is_adset_budget_sharing_enabled),
});
```

(Adjust to match the actual body-construction style — JSON vs URLSearchParams.)

- [ ] **Step 4: Run tests + build**

```bash
pnpm vitest run mcp-servers/meta-ads/src/tools/create-campaign.test.ts
pnpm --filter '@engineerdad/mcp-meta-ads' build
```

- [ ] **Step 5: Commit**

```bash
git add mcp-servers/meta-ads/src/tools/create-campaign.ts mcp-servers/meta-ads/src/tools/create-campaign.test.ts
git commit -m "feat(mcp-meta-ads): expose is_adset_budget_sharing_enabled (B-027 #1)

Spec §3.3.1. Closes Meta API subcode 4834011 on campaign creation
when the campaign uses ad-set-level budgets (no CBO). Defaults to
false to match today's behavior."
```

---

### Task 9: Add `LOCALE_ID` constant + `targetingForCell` helper in plan-distribution.ts

**Files:**
- Modify: `packages/orchestrator/src/distribute/plan-distribution.ts`
- Test: `packages/orchestrator/src/distribute/plan-distribution.test.ts` (likely exists; extend)

- [ ] **Step 1: Write the failing test**

In `plan-distribution.test.ts`, add (use the locale IDs from Task 7 Step 2 — call them `EN_ID` and `MS_ID` below):
```ts
import { targetingForCell, LOCALE_ID } from "./plan-distribution.js"; // or the exported re-exports

it("targetingForCell returns minimum broad block with both locales", () => {
  const cell = { cellId: "A", factorLevels: { angle: "A" }, variantPageIds: [], allocationPct: 70 };
  const t = targetingForCell(cell);
  expect(t.geo_locations).toEqual({ countries: ["MY"] });
  expect(t.age_min).toBe(25);
  expect(t.age_max).toBe(55);
  expect(t.locales).toEqual([LOCALE_ID.en, LOCALE_ID.ms]);
});

it("LOCALE_ID has both keys populated and non-zero", () => {
  expect(LOCALE_ID.en).toBeGreaterThan(0);
  expect(LOCALE_ID.ms).toBeGreaterThan(0);
});
```

Run, confirm failure (`targetingForCell` undefined):
```bash
pnpm vitest run packages/orchestrator/src/distribute/plan-distribution.test.ts -t "targeting"
```

- [ ] **Step 2: Add the constant + helper at the top of plan-distribution.ts**

Open `packages/orchestrator/src/distribute/plan-distribution.ts`. Below the existing const declarations (around `const META = "Meta-paid";` near line 121), add:
```ts
// Meta locale IDs (integers from Meta's Graph API /search?type=adlocale).
// Source: scripts/lookup-meta-locale-ids.mjs, retrieved YYYY-MM-DD.
export const LOCALE_ID = { en: <EN_ID_FROM_TASK_7>, ms: <MS_ID_FROM_TASK_7> } as const;

export interface MetaTargeting {
  geo_locations: { countries: string[] };
  age_min: number;
  age_max: number;
  locales: number[];
}

/**
 * Minimum broad targeting per Andromeda doctrine (creative-as-targeting).
 * One adset per cell, bilingual ads attached → both locales on every adset.
 * `_cell` is unused today but kept in the signature: future per-cell
 * targeting (E-042 persona-as-factor) reads it.
 *
 * Spec §3.3.3.
 */
export function targetingForCell(_cell: AllocatedCell): MetaTargeting {
  return {
    geo_locations: { countries: ["MY"] },
    age_min: 25,
    age_max: 55,
    locales: [LOCALE_ID.en, LOCALE_ID.ms],
  };
}
```

Replace `<EN_ID_FROM_TASK_7>` + `<MS_ID_FROM_TASK_7>` with the integers from Task 7 + add today's date in the comment.

- [ ] **Step 3: Run tests + build**

```bash
pnpm vitest run packages/orchestrator/src/distribute/plan-distribution.test.ts -t "targeting"
pnpm --filter @engineerdad/orchestrator build
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/distribute/plan-distribution.ts packages/orchestrator/src/distribute/plan-distribution.test.ts
git commit -m "feat(orchestrator): targetingForCell + LOCALE_ID constants (B-027 #3)

Spec §3.3.3. Locale IDs looked up via scripts/lookup-meta-locale-ids.mjs.
Minimum broad targeting: MY geo, 25–55 age, both EN + MS locales on
every adset. Helper not yet wired into adsetStep — that's the next task."
```

---

### Task 10: Fix budget math + wire targeting into `adsetStep`

**Files:**
- Modify: `packages/orchestrator/src/distribute/plan-distribution.ts`
- Test: `packages/orchestrator/src/distribute/plan-distribution.test.ts`

- [ ] **Step 1: Write failing tests for the new `adsetStep` shape**

```ts
it("adsetStep computes daily_budget_cents as MYR × allocationPct × 100", () => {
  const cell = { cellId: "A", factorLevels: { angle: "A" }, variantPageIds: ["v1"], allocationPct: 70 };
  const step = adsetStep("r1", cell, 10);
  expect(step.args.daily_budget_cents).toBe(700); // 10 * 0.70 * 100
});

it("adsetStep floors daily_budget_cents to 1 when budget is 0", () => {
  const cell = { cellId: "A", factorLevels: { angle: "A" }, variantPageIds: ["v1"], allocationPct: 70 };
  const step = adsetStep("r1", cell, 0);
  expect(step.args.daily_budget_cents).toBe(1);
});

it("adsetStep includes a targeting block", () => {
  const cell = { cellId: "A", factorLevels: { angle: "A" }, variantPageIds: ["v1"], allocationPct: 70 };
  const step = adsetStep("r1", cell, 10);
  expect(step.args.targeting).toBeDefined();
  expect(step.args.targeting.geo_locations.countries).toEqual(["MY"]);
});
```

(If `adsetStep` is not exported today, export it for testing — or test through `planMetaPaidSetup` if that's the public surface. Inspect file to pick.)

Run, confirm failure:
```bash
pnpm vitest run packages/orchestrator/src/distribute/plan-distribution.test.ts -t "adsetStep"
```

- [ ] **Step 2: Update `adsetStep` (around line 149)**

Replace the existing function body:
```ts
function adsetStep(runId: string, cell: AllocatedCell, dailyBudgetMyr: number): ToolStep {
  return {
    tool: "mcp__meta-ads__create_adset",
    args: {
      name: `${runId}__${cell.cellId}`,
      daily_budget_cents: Math.max(1, Math.round(dailyBudgetMyr * cell.allocationPct * 100)),
      optimization_goal: "LEAD_GENERATION",
      billing_event: "IMPRESSIONS",
      targeting: targetingForCell(cell),
      client_request_id: `${runId}::${cell.cellId}`,
    },
    captures: `adset:${cell.cellId}`,
    needs: ["campaign"],
  };
}
```

Three deltas vs today:
1. `Math.round(...)` → `Math.max(1, Math.round(... * 100))` (added `* 100`, added floor).
2. New `targeting: targetingForCell(cell)` line.
3. Note `allocationPct` is in percent (e.g., `70`), not fraction. Check the `AllocatedCell` shape: if it's a percent (0–100), the math needs `/ 100`:

```ts
daily_budget_cents: Math.max(1, Math.round(dailyBudgetMyr * (cell.allocationPct / 100) * 100)),
// which simplifies to:
daily_budget_cents: Math.max(1, Math.round(dailyBudgetMyr * cell.allocationPct)),
```

**Verify before settling.** Read `packages/orchestrator/src/experiment/allocation.ts` and check whether `allocationPct` is 70 or 0.70. The test expectation in Step 1 (700 cents for 10 MYR × 0.70) assumes the value is 0.70 in math terms; rewrite the assertion to match the actual convention. If `allocationPct = 70` (percent), the right formula is:

```ts
daily_budget_cents: Math.max(1, Math.round(dailyBudgetMyr * cell.allocationPct)),
```

(no `× 100` because the existing `cents = MYR × pct(0-100)` is mathematically `MYR × 100 × pct/100`, which is correct).

**Picks one convention, fixes the test, fixes the formula.** Document the chosen convention in a comment on the line.

- [ ] **Step 3: Run tests + build**

```bash
pnpm vitest run packages/orchestrator/src/distribute/plan-distribution.test.ts
pnpm --filter @engineerdad/orchestrator build
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/distribute/plan-distribution.ts packages/orchestrator/src/distribute/plan-distribution.test.ts
git commit -m "fix(orchestrator): correct adset budget math + add targeting block (B-027 #2 + #3)

Spec §3.3.2 + §3.3.3. Floor at 1 cent so a zero-budget run still
produces a legal Meta call. targetingForCell attaches MY geo + age
band + both locales on every adset (one adset per cell with bilingual
ads — language is not a per-adset split)."
```

---

### Task 11: Thread `dailyBudgetMyr` source-of-truth through distribute stage

**Files:**
- Modify: `packages/orchestrator/src/stages/distribute.ts`
- Test: `packages/orchestrator/src/stages/distribute.test.ts` (likely exists)

- [ ] **Step 1: Locate where `dailyBudgetMyr` is read today**

```bash
grep -n "dailyBudgetMyr" packages/orchestrator/src/stages/distribute.ts
```

Expected: lines around 437 + 559 read `params.dailyBudgetMyr ?? 0` from `run.params as unknown as DistributeParams`.

- [ ] **Step 2: Add the helper that reads Brain memo first**

In `distribute.ts`, near the other small helpers, add:
```ts
import type { DecisionMemoV2 } from "@engineerdad/shared";

function dailyBudgetMyrFor(run: RunState): number {
  const memo = run.steps.find((s) => s.stepId === "S1-reason")?.result as DecisionMemoV2 | undefined;
  const fromMemo = memo?.experimentParams?.dailyBudgetMyr;
  if (typeof fromMemo === "number" && fromMemo > 0) return fromMemo;
  const params = run.params as unknown as { dailyBudgetMyr?: number };
  return params.dailyBudgetMyr ?? 0;
}
```

- [ ] **Step 3: Write failing tests**

```ts
it("dailyBudgetMyrFor prefers Brain memo over run.params", () => {
  const run = makeRun({
    s1Result: { experimentParams: { dailyBudgetMyr: 25 } },
    runParams: { dailyBudgetMyr: 10 },
  });
  expect(dailyBudgetMyrFor(run)).toBe(25);
});

it("dailyBudgetMyrFor falls back to run.params when memo is absent", () => {
  const run = makeRun({ s1Result: undefined, runParams: { dailyBudgetMyr: 15 } });
  expect(dailyBudgetMyrFor(run)).toBe(15);
});

it("dailyBudgetMyrFor returns 0 when neither source provides", () => {
  const run = makeRun({ s1Result: undefined, runParams: {} });
  expect(dailyBudgetMyrFor(run)).toBe(0);
});
```

Run, confirm failure (helper not exported / not present):
```bash
pnpm vitest run packages/orchestrator/src/stages/distribute.test.ts -t "dailyBudgetMyrFor"
```

- [ ] **Step 4: Replace inline reads with the helper**

Replace `params.dailyBudgetMyr ?? 0` at both occurrences (around lines 442 + 565) with `dailyBudgetMyrFor(run)`. Export the helper if the tests need it.

- [ ] **Step 5: Run tests + build**

```bash
pnpm vitest run packages/orchestrator/src/stages/distribute.test.ts
pnpm --filter @engineerdad/orchestrator build
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/stages/distribute.ts packages/orchestrator/src/stages/distribute.test.ts
git commit -m "feat(orchestrator): distribute reads dailyBudgetMyr Brain-memo-first (B-027 follow-up)

Spec §3.3.2. Read order: Brain experimentParams.dailyBudgetMyr →
run.params.dailyBudgetMyr → 0. Brain's hypothesis carries the
experimental budget; CLI --daily-budget is the operator override."
```

---

### Task 12: Audit `run-args.ts` default

**Files:**
- Modify: `packages/orchestrator/src/run-args.ts` (only if default is non-zero)

- [ ] **Step 1: Read the current default**

```bash
grep -n "dailyBudgetMyr" packages/orchestrator/src/run-args.ts
```

If the default is `0`, this task is a no-op — skip to Task 13.

If the default is a non-zero hard-coded number (e.g. `20`), change it to `0` so the CLI doesn't silently mask a missing Brain-memo value:
```ts
// Was: dailyBudgetMyr: parsed.dailyBudgetMyr ?? 20,
   dailyBudgetMyr: parsed.dailyBudgetMyr ?? 0,
```

- [ ] **Step 2: Commit (if changed)**

```bash
git add packages/orchestrator/src/run-args.ts
git commit -m "fix(orchestrator): run-args dailyBudgetMyr defaults to 0 (B-027 follow-up)

Spec §3.3.2. Prevents the CLI default from masking a missing Brain
experimentParams.dailyBudgetMyr — the planner falls through to the
Math.max(1, …) floor instead, surfacing the gap in Ads Manager."
```

---

### Task 13: Integration test — full Meta-paid plan against fixture run

**Files:**
- Modify: `packages/orchestrator/src/distribute/plan-distribution.test.ts`

- [ ] **Step 1: Write the integration test**

Add a test that exercises `planMetaPaid` end-to-end with a 2-cell fixture, asserts the campaign step + adset steps + creative steps line up, and confirms each adset has non-zero budget + targeting:
```ts
it("planMetaPaid produces campaign + per-cell adsets with targeting and budgets", () => {
  const variants = [/* 2 fixture DistVariant rows under 2 different cells */];
  const cells = [/* AllocatedCell A (70%), AllocatedCell B (30%) */];
  const part = planMetaPaid("r_test", variants, cells, 10);

  const campaignStep = part.setup.find((s) => s.tool === "mcp__meta-ads__create_campaign");
  expect(campaignStep).toBeDefined();

  const adsetSteps = part.setup.filter((s) => s.tool === "mcp__meta-ads__create_adset");
  expect(adsetSteps).toHaveLength(2);
  for (const a of adsetSteps) {
    expect(a.args.daily_budget_cents).toBeGreaterThan(0);
    expect(a.args.targeting).toBeDefined();
    expect(a.args.targeting.locales).toEqual([LOCALE_ID.en, LOCALE_ID.ms]);
  }
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm vitest run packages/orchestrator/src/distribute/plan-distribution.test.ts
git add packages/orchestrator/src/distribute/plan-distribution.test.ts
git commit -m "test(orchestrator): integration test for planMetaPaid (B-027 traceability)"
```

---

## Part D — B-026: angle taxonomy enforcement

### Task 14: Update `brief-writer.md` agent prompt

**Files:**
- Modify: `.claude/agents/brief-writer.md`

- [ ] **Step 1: Read the current prompt structure**

```bash
sed -n '1,80p' .claude/agents/brief-writer.md
```

Identify the section that talks about Brief structure / angle. Find a natural insertion point (likely after the strategic-inputs section, before the per-Brief field rules).

- [ ] **Step 2: Insert the canonical-angle-taxonomy section**

Add this new section to `.claude/agents/brief-writer.md`:
```markdown
## Canonical angle taxonomy (HARD RULE)

The spawn prompt's `DECISION MEMO INPUTS.recommendedAngles` is the
canonical list of angle keys for this run. You MUST set `brief.angle`
to one of those strings VERBATIM on every Brief you create.

- No renaming (`epf-shortfall-parent-worry` → `epf-shortfall-math` is a halt).
- No abbreviation, paraphrasing, or "improving" the key.
- The verifier (`verify-brief.ts`) hard-fails on any off-taxonomy angle.

If you cannot reach 12 Briefs within these angles plus the other axes
(persona, promise, proof_type, funnel_stage, budget_bucket), emit
fewer Briefs and surface the shortfall in your return JSON. **Skip,
don't pad.** A shortfall is a signal to upstream (more angles needed);
inventing an off-taxonomy angle is a silent corruption.
```

- [ ] **Step 3: Verify `pnpm sync:agents:check` still passes (no fragment drift)**

```bash
pnpm sync:agents:check
```

Expected: PASS (you added content above what sync touches; the paste regions are unaffected).

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/brief-writer.md
git commit -m "feat(agents/brief-writer): canonical angle taxonomy contract (B-026)

Spec §3.1.1 + §3.1.2. brief.angle must match Brain's
recommendedAngles verbatim. Skip-don't-pad if the 12-Brief count is
infeasible within the angle set."
```

---

### Task 15: Stage `recommendedAngles` in B1-write spawn prompt

**Files:**
- Modify: `packages/orchestrator/src/stages/brief.ts`
- Test: `packages/orchestrator/src/stages/brief.test.ts` (likely exists)

- [ ] **Step 1: Confirm `memoInputs` already extracts `recommendedAngles`**

```bash
grep -n "recommendedAngles" packages/orchestrator/src/stages/brief.ts
```

If line 30 of `brief.ts` already reads `recommendedAngles: memo["recommendedAngles"] ?? []`, the inputs flow is in place — but the spawn prompt may not call attention to it. Verify by reading the spawn-prompt template (around lines 38–50).

- [ ] **Step 2: Update the spawn prompt to spotlight the canonical-taxonomy rule**

In `brief.ts`, replace the `spawnPrompt` array with:
```ts
    spawnPrompt: [
      `Run ${run.runId}: you are brief-writer. Translate the Decision Memo`,
      "inputs below into a pack of 12 message-angle Briefs — one store row",
      "each, bilingual EN/BM, across the 70/20/10 budget buckets. Follow your",
      "agent instructions exactly. Return { angles: [...] } as your final JSON.",
      "",
      "DECISION MEMO INPUTS:",
      JSON.stringify(memoInputs(run), null, 2),
      "",
      "CANONICAL ANGLE TAXONOMY (HARD RULE):",
      "Every brief.angle MUST be one of recommendedAngles above, VERBATIM.",
      "The verifier hard-fails on any off-taxonomy angle.",
      "If you cannot reach 12 within these angles, emit fewer — skip, don't pad.",
    ].join("\n"),
```

- [ ] **Step 3: Write a test that asserts the spawn prompt carries the rule + the angles**

```ts
it("B1-write spawn prompt includes recommendedAngles and the canonical-taxonomy rule", () => {
  const run = makeRunWithMemo({
    recommendedAngles: ["angle-a", "angle-b"],
  });
  const step = b1Write.build(run);
  if (step.kind !== "spawn") throw new Error("expected spawn");
  expect(step.spawnPrompt).toContain("angle-a");
  expect(step.spawnPrompt).toContain("angle-b");
  expect(step.spawnPrompt).toMatch(/canonical angle taxonomy/i);
  expect(step.spawnPrompt).toMatch(/verbatim/i);
});
```

Run, confirm pass:
```bash
pnpm vitest run packages/orchestrator/src/stages/brief.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/stages/brief.ts packages/orchestrator/src/stages/brief.test.ts
git commit -m "feat(orchestrator/brief): spotlight canonical-taxonomy rule in spawn prompt (B-026)

Spec §3.1.2. recommendedAngles already flowed into the spawn prompt
via memoInputs; this elevates the verbatim rule from agent-prompt
inference to an explicit spawn-prompt line. Matches Phase 0's
experimentParams pattern."
```

---

### Task 16: Extend `verify-brief` to assert angle ∈ recommendedAngles

**Files:**
- Modify: `packages/orchestrator/src/verifiers/verify-brief.ts`
- Modify: `packages/orchestrator/src/stages/brief.ts` (the `verify` call site)
- Test: `packages/orchestrator/src/verifiers/verify-brief.test.ts` (likely exists)

- [ ] **Step 1: Change the verifier signature**

`verifyBrief` today is `(result: unknown) => VerifyResult`. It needs access to (a) Brain's `recommendedAngles` and (b) the actual Brief rows the worker created. The agent's return JSON is `{ angles: [...] }` — the angles array probably carries the strings the agent claims it used. Use those.

Update the signature:
```ts
export interface BriefResult {
  angles?: unknown;
}

export function verifyBrief(
  result: unknown,
  recommendedAngles: string[] | undefined,
): VerifyResult {
  if (result === null || typeof result !== "object") {
    return { ok: false, problems: ["brief-writer produced no result"] };
  }
  const angles = (result as BriefResult).angles;
  if (!Array.isArray(angles) || angles.length === 0) {
    return { ok: false, problems: ["brief-writer created no Brief angles"] };
  }

  // Skip-when-absent: Brain emitted no recommendedAngles (legitimate-skip path).
  if (!recommendedAngles || recommendedAngles.length === 0) {
    return { ok: true, problems: [] };
  }

  const allowed = new Set(recommendedAngles);
  const problems: string[] = [];
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i];
    const angleStr = typeof a === "string" ? a : (a as { angle?: unknown })?.angle;
    if (typeof angleStr !== "string") {
      problems.push(`angle[${i}]: not a string`);
      continue;
    }
    if (!allowed.has(angleStr)) {
      problems.push(`angle[${i}] "${angleStr}" not in recommendedAngles`);
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, problems: [] };
}
```

(The exact path to the angle string in each element depends on what brief-writer returns — `["angle-a", "angle-b"]` vs `[{ angle: "angle-a" }, ...]`. The verifier handles both.)

- [ ] **Step 2: Update the call site in brief.ts**

Find the `verify` call in `b1Write` (around line 51):
```ts
  verify: (_run, result): VerifyResult => verifyBrief(result),
```
Change to:
```ts
  verify: (run, result): VerifyResult => {
    const inputs = memoInputs(run) as { recommendedAngles?: string[] };
    return verifyBrief(result, inputs.recommendedAngles);
  },
```

- [ ] **Step 3: Write failing tests**

In `verify-brief.test.ts`:
```ts
describe("verifyBrief angle-taxonomy assertion", () => {
  it("passes when every angle is in recommendedAngles", () => {
    const r = verifyBrief({ angles: ["a", "b"] }, ["a", "b", "c"]);
    expect(r.ok).toBe(true);
  });

  it("fails when any angle is off-taxonomy, listing all offenders", () => {
    const r = verifyBrief({ angles: ["a", "x", "y", "b"] }, ["a", "b"]);
    expect(r.ok).toBe(false);
    expect(r.problems).toHaveLength(2);
    expect(r.problems.join(" ")).toContain('"x"');
    expect(r.problems.join(" ")).toContain('"y"');
  });

  it("skips assertion when recommendedAngles is absent (legitimate-skip)", () => {
    const r = verifyBrief({ angles: ["whatever"] }, undefined);
    expect(r.ok).toBe(true);
  });

  it("skips assertion when recommendedAngles is empty array", () => {
    const r = verifyBrief({ angles: ["whatever"] }, []);
    expect(r.ok).toBe(true);
  });
});
```

Run, confirm failure before Step 1 implementation, pass after:
```bash
pnpm vitest run packages/orchestrator/src/verifiers/verify-brief.test.ts
```

- [ ] **Step 4: Build + commit**

```bash
pnpm --filter @engineerdad/orchestrator build
git add packages/orchestrator/src/verifiers/verify-brief.ts packages/orchestrator/src/verifiers/verify-brief.test.ts packages/orchestrator/src/stages/brief.ts
git commit -m "feat(orchestrator): verify-brief enforces canonical angle taxonomy (B-026)

Spec §3.1.3. Hard-fails on any off-taxonomy angle, collecting all
violations in one halt message. Skip-when-absent preserves the
legitimate-skip path Brain Initiative Phase 0 allows for cold-start
single-angle runs."
```

---

## Part E — `/reflect` downstream consumer

### Task 17: Update `reflect.md` + `brain.md` for experimentStatus branching

**Files:**
- Modify: `.claude/commands/reflect.md`
- Modify: `.claude/agents/brain.md`

- [ ] **Step 1: Read the current Reflect procedure**

```bash
cat .claude/commands/reflect.md
grep -n "Reflect\|§B-step-2\|hypothesis\|graduate" .claude/agents/brain.md | head -20
```

- [ ] **Step 2: Add the experimentStatus branch to reflect.md**

In `.claude/commands/reflect.md`, find where the prior cycle's Experiment row is read. Add (after the read, before grading):

```markdown
**Tri-state branching.** Read `experimentStatus` from the prior cycle's
Experiments row. Branch:

- `full` — grade all cells; standard Hypothesis graduation pass.
- `degraded` — grade only the cells with variants; mark un-populated
  cells `inconclusive — no data`. Still a valid comparison across the
  populated cells.
- `single-cell` — **skip Hypothesis graduation entirely.** A single
  cell is not a comparison; nothing to confirm or refute. Write the
  Performance Report's "what we learned" section as a single-arm
  observation (uplift vs baseline if baseline exists; otherwise no
  graduation signal).
- `broken` — this should not be reached (verify-experiment fails
  closed on `broken`). If you see it, halt and ask the operator.
```

- [ ] **Step 3: Mirror the branch in brain.md §B-step-2**

In `.claude/agents/brain.md`, find the §B-step-2 Reflect procedure. Add a parallel paragraph about reading `experimentStatus` and branching as above. Cross-reference `.claude/commands/reflect.md`.

- [ ] **Step 4: Sync agents**

```bash
pnpm sync:agents
pnpm sync:agents:check
```

- [ ] **Step 5: Commit**

```bash
git add .claude/commands/reflect.md .claude/agents/brain.md
git commit -m "feat(reflect): branch on experimentStatus tri-state (B-025 follow-up)

Spec §3.2.6. single-cell skips hypothesis graduation; degraded
grades only populated cells; broken would halt (verify-experiment
fails closed before reaching reflect)."
```

---

## Part F — Webapp angle-visibility surface

### Task 18: New list config — `briefs.ts`

**Files:**
- Create: `apps/webapp/src/app/lib/listConfigs/briefs.ts`
- Modify: `apps/webapp/src/app/lib/listConfigs/index.ts`

- [ ] **Step 1: Inspect existing list configs for the right pattern**

```bash
cat apps/webapp/src/app/lib/listConfigs/creative-variants.ts apps/webapp/src/app/lib/listConfigs/experiments.ts apps/webapp/src/app/lib/listConfigs/index.ts
```

Note the `ListConfig` shape, column types, filter shape, and how `index.ts` registers configs.

- [ ] **Step 2: Create briefs.ts**

```ts
import type { ListConfig } from "../types.js";
import { APPROVAL_STATUS } from "@engineerdad/store";

export const briefsList: ListConfig = {
  columns: [
    { field: "title", label: "Title", type: "text", sortable: true },
    { field: "angle", label: "Angle", type: "badge", sortable: true },
    { field: "persona", label: "Persona", type: "badge", sortable: true },
    { field: "funnelStage", label: "Stage", type: "badge", sortable: true },
    { field: "budgetBucket", label: "Bucket", type: "badge", sortable: true },
    { field: "approvalStatus", label: "Status", type: "status" },
    { field: "runId", label: "Run", type: "runId" },
  ],
  defaultSort: { field: "angle", dir: "asc" as const },
  filters: [
    { field: "approvalStatus", label: "Approval", type: "select", options: APPROVAL_STATUS },
    { field: "angle", label: "Angle", type: "text" },
  ],
};
```

- [ ] **Step 3: Register in index.ts**

In `apps/webapp/src/app/lib/listConfigs/index.ts`, add:
```ts
import { briefsList } from "./briefs.js";
```

Add the entry to whatever registry/switch maps entity name → config:
```ts
case "Briefs": return briefsList;
```

- [ ] **Step 4: Smoke check**

```bash
pnpm --filter @engineerdad/webapp build
```

Expected: builds clean. (Webapp visual verification deferred to E2E walk.)

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/app/lib/listConfigs/briefs.ts apps/webapp/src/app/lib/listConfigs/index.ts
git commit -m "feat(webapp): briefs list config with Angle column (Part 4.2)"
```

---

### Task 19: New list config — `scripts.ts`

**Files:**
- Create: `apps/webapp/src/app/lib/listConfigs/scripts.ts`
- Modify: `apps/webapp/src/app/lib/listConfigs/index.ts`

- [ ] **Step 1: Create scripts.ts**

```ts
import type { ListConfig } from "../types.js";
import { APPROVAL_STATUS } from "@engineerdad/store";

export const scriptsList: ListConfig = {
  columns: [
    { field: "title", label: "Title", type: "text", sortable: true },
    { field: "angle", label: "Angle", type: "badge", sortable: true },  // joined via Brief
    { field: "approvalStatus", label: "Status", type: "status" },
    { field: "runId", label: "Run", type: "runId" },
  ],
  defaultSort: { field: "angle", dir: "asc" as const },
  filters: [
    { field: "approvalStatus", label: "Approval", type: "select", options: APPROVAL_STATUS },
  ],
};
```

- [ ] **Step 2: Register in index.ts**

```ts
import { scriptsList } from "./scripts.js";
// ...
case "Scripts": return scriptsList;
```

- [ ] **Step 3: Build + commit**

```bash
pnpm --filter @engineerdad/webapp build
git add apps/webapp/src/app/lib/listConfigs/scripts.ts apps/webapp/src/app/lib/listConfigs/index.ts
git commit -m "feat(webapp): scripts list config with derived Angle column (Part 4.2)"
```

---

### Task 20: Add Angle column to `creative-variants.ts`

**Files:**
- Modify: `apps/webapp/src/app/lib/listConfigs/creative-variants.ts`

- [ ] **Step 1: Add the column**

Open `apps/webapp/src/app/lib/listConfigs/creative-variants.ts`. Insert into `columns` after `aspect`:
```ts
    { field: "angle", label: "Angle", type: "badge", sortable: true },
```

- [ ] **Step 2: Commit**

```bash
pnpm --filter @engineerdad/webapp build
git add apps/webapp/src/app/lib/listConfigs/creative-variants.ts
git commit -m "feat(webapp): variants list — add derived Angle column (Part 4.2)"
```

---

### Task 21: Extend `review/[entity]/page.tsx` to join Brief data for Scripts + Variants

**Files:**
- Modify: `apps/webapp/src/app/review/[entity]/page.tsx`

- [ ] **Step 1: Read the existing CreativeVariants script-prefix pattern**

The route already has a pre-fetch loop for CreativeVariants → Scripts (around lines 50–60). Mirror it: for Scripts entities, pre-fetch the linked Briefs; for CreativeVariants entities, pre-fetch the linked Scripts AND the Briefs reached through them.

- [ ] **Step 2: Add the joins**

After the existing CreativeVariants block, add:
```ts
// Scripts: enrich each row with the linked brief's angle.
if (entity === "Scripts" && rows.length) {
  const briefIds = [...new Set(
    rows.map((r) => (r as Record<string, unknown>).brief as string).filter(Boolean)
  )];
  const briefMap = new Map<string, string>();
  await Promise.all(
    briefIds.map(async (id) => {
      const b = await store.get("Briefs", id);
      if (b) briefMap.set(id, String((b as Record<string, unknown>).angle ?? ""));
    })
  );
  rows = rows.map((r) => {
    const briefId = (r as Record<string, unknown>).brief as string;
    return { ...r, angle: briefMap.get(briefId) ?? "" };
  });
}

// CreativeVariants: also enrich with angle via Script → Brief.
if (entity === "CreativeVariants" && rows.length) {
  const scriptToBrief = new Map<string, string>();
  const scriptIds = [...new Set(
    rows.map((r) => (r as Record<string, unknown>).script as string).filter(Boolean)
  )];
  await Promise.all(
    scriptIds.map(async (id) => {
      const s = await store.get("Scripts", id);
      const briefId = s ? String((s as Record<string, unknown>).brief ?? "") : "";
      if (briefId) scriptToBrief.set(id, briefId);
    })
  );
  const briefIds = [...new Set(scriptToBrief.values())];
  const briefAngle = new Map<string, string>();
  await Promise.all(
    briefIds.map(async (id) => {
      const b = await store.get("Briefs", id);
      if (b) briefAngle.set(id, String((b as Record<string, unknown>).angle ?? ""));
    })
  );
  rows = rows.map((r) => {
    const scriptId = (r as Record<string, unknown>).script as string;
    const briefId = scriptToBrief.get(scriptId) ?? "";
    return { ...r, angle: briefAngle.get(briefId) ?? "" };
  });
}
```

- [ ] **Step 3: Build + commit**

```bash
pnpm --filter @engineerdad/webapp build
git add apps/webapp/src/app/review/[entity]/page.tsx
git commit -m "feat(webapp): join Brief.angle into Scripts + CreativeVariants list rows (Part 4.2)"
```

---

### Task 22: Run header — angle chips on `runs/[runId]/page.tsx`

**Files:**
- Modify: `apps/webapp/src/app/runs/[runId]/page.tsx`
- Possibly create: `apps/webapp/src/app/components/RunAngleChips.tsx`

- [ ] **Step 1: Read the current run-detail page**

```bash
cat apps/webapp/src/app/runs/[runId]/page.tsx
```

Identify where the page header renders and where to insert the chips.

- [ ] **Step 2: Create RunAngleChips component**

Create `apps/webapp/src/app/components/RunAngleChips.tsx`:
```tsx
import { db } from "@engineerdad/store"; // adjust import to existing pattern
import { sql } from "drizzle-orm";

interface AngleChip {
  key: string;
  rationale?: string;
  briefCount: number;
}

export async function RunAngleChips({ runId }: { runId: string }) {
  // Read S1-reason step result from orchestrator.step_results
  // (adjust the query to match the existing read pattern)
  const memo = await fetchS1Memo(runId);
  const angles: string[] = (memo?.recommendedAngles as string[] | undefined) ?? [];
  const rationaleByAngle: Record<string, string> =
    (memo?.angleRationales as Record<string, string> | undefined) ?? {};

  if (angles.length === 0) {
    return <div style={{ color: "#666", fontSize: 13 }}>No recommendedAngles emitted for this run (cold-start path).</div>;
  }

  // Count Briefs per angle
  const briefs = await db.execute(
    sql`SELECT angle, COUNT(*) AS n FROM briefs WHERE run_id = ${runId} GROUP BY angle`
  );
  const countByAngle = new Map<string, number>();
  for (const row of briefs as Array<{ angle: string; n: number }>) {
    countByAngle.set(row.angle, Number(row.n));
  }

  const chips: AngleChip[] = angles.map((a) => ({
    key: a,
    rationale: rationaleByAngle[a],
    briefCount: countByAngle.get(a) ?? 0,
  }));

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
      {chips.map((c) => (
        <div
          key={c.key}
          title={c.rationale ?? ""}
          style={{
            background: "#eef",
            color: "#335",
            padding: "4px 10px",
            borderRadius: 12,
            fontSize: 13,
            fontFamily: "monospace",
          }}
        >
          {c.key} <span style={{ color: "#669" }}>· {c.briefCount}</span>
        </div>
      ))}
    </div>
  );
}

async function fetchS1Memo(runId: string): Promise<Record<string, unknown> | null> {
  // Implement to match the existing step-result read pattern.
  // Likely: SELECT payload FROM orchestrator.step_results
  //         WHERE run_id = $1 AND step_id = 'S1-reason'
  //         ORDER BY created_at DESC LIMIT 1;
  const result = await db.execute(
    sql`SELECT payload FROM orchestrator.step_results
        WHERE run_id = ${runId} AND step_id = 'S1-reason'
        ORDER BY created_at DESC LIMIT 1`
  );
  const row = (result as Array<{ payload: unknown }>)[0];
  return (row?.payload as Record<string, unknown>) ?? null;
}
```

(Adjust imports to match how `apps/webapp` accesses the DB / step_results — there may already be a helper.)

- [ ] **Step 3: Mount the component in the run-detail page**

In `apps/webapp/src/app/runs/[runId]/page.tsx`, import and render the component near the top of the page body:
```tsx
import { RunAngleChips } from "../../components/RunAngleChips.js";
// ...
<RunAngleChips runId={runId} />
```

- [ ] **Step 4: Build + commit**

```bash
pnpm --filter @engineerdad/webapp build
git add apps/webapp/src/app/components/RunAngleChips.tsx apps/webapp/src/app/runs/[runId]/page.tsx
git commit -m "feat(webapp): run-header angle chips with Brief counts (Part 4.1)"
```

---

### Task 23: HG1 approval-guidance preview component

**Files:**
- Create: `apps/webapp/src/app/components/BriefApprovalGuidance.tsx`
- Modify: `apps/webapp/src/app/review/[entity]/page.tsx`

- [ ] **Step 1: Create the component (server-recompute path per spec §3.4.3)**

Create `apps/webapp/src/app/components/BriefApprovalGuidance.tsx`:
```tsx
import { classifyExperimentStatus, type ExperimentStatus } from "@engineerdad/shared";
import { db } from "@engineerdad/store"; // adjust import
import { sql } from "drizzle-orm";

interface AngleCoverage {
  angle: string;
  approved: number;
  total: number;
}

export async function BriefApprovalGuidance({ runId }: { runId: string }) {
  if (!runId) return null;

  // Pull all Briefs for the run grouped by angle.
  const rows = await db.execute(
    sql`SELECT angle,
               COUNT(*) FILTER (WHERE approval_status = 'Approved') AS approved,
               COUNT(*) AS total
        FROM briefs WHERE run_id = ${runId} GROUP BY angle ORDER BY angle`
  );
  const coverage: AngleCoverage[] = (rows as Array<{ angle: string; approved: number; total: number }>).map((r) => ({
    angle: r.angle,
    approved: Number(r.approved),
    total: Number(r.total),
  }));

  if (coverage.length === 0) return null;

  const occupied = coverage.filter((c) => c.approved > 0).length;
  const status: ExperimentStatus = classifyExperimentStatus({
    occupied,
    total: coverage.length,
  });

  const verdict = {
    full: "Approving as-is will produce a FULL experiment (all cells populated).",
    degraded: "Approving as-is will produce a DEGRADED experiment (≥2 cells, but ≥1 empty).",
    "single-cell": "Approving as-is will produce a SINGLE-CELL result (routing, not experiment).",
    broken: "WARNING: no angles have approved Briefs yet — this will halt at verify-experiment.",
  }[status];

  return (
    <div
      style={{
        background: status === "broken" ? "#ffeded" : status === "single-cell" ? "#fff8dc" : "#f0f7ed",
        border: "1px solid #ddd",
        borderRadius: 6,
        padding: "10px 14px",
        margin: "12px 0",
        fontSize: 13,
        fontFamily: "-apple-system, sans-serif",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{verdict}</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {coverage.map((c) => (
          <li key={c.angle} style={{ fontFamily: "monospace" }}>
            {c.angle} · {c.approved} of {c.total} approved
            {c.approved === 0 && <span style={{ color: "#c04040" }}> ← empty cell</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Render conditionally on the entity page when entity === "Briefs"**

In `apps/webapp/src/app/review/[entity]/page.tsx`, near the top of the rendered JSX, add:
```tsx
import { BriefApprovalGuidance } from "../../components/BriefApprovalGuidance.js";
// ...
{entity === "Briefs" && filter.runId ? (
  <BriefApprovalGuidance runId={String(filter.runId)} />
) : null}
```

(Adjust the runId source — the existing page extracts it from search params + filter; use whichever is already in scope.)

- [ ] **Step 3: Build + commit**

```bash
pnpm --filter @engineerdad/webapp build
git add apps/webapp/src/app/components/BriefApprovalGuidance.tsx apps/webapp/src/app/review/[entity]/page.tsx
git commit -m "feat(webapp): HG1 approval-guidance preview with tri-state (Part 4.3)

Spec §3.4.3. Server-recompute on each approval (Option A — consistent
with existing approve-flow revalidation). Shared classifyExperimentStatus
helper ensures webapp + verify-experiment cannot diverge."
```

---

## Part G — Acceptance walk

### Task 24: Execute the §7 end-to-end walk

**Reference:** `docs/superpowers/specs/2026-05-29-meta-paid-unblock-design.html` §7

This is a manual walk against a real test Meta ad account, not a TDD task. The spec spells out each gate's pre-flight, approval, snapshot, and acceptance queries verbatim. Run it after every Part A–F task is committed and `pnpm test` is green.

- [ ] **Step 1: Pre-flight per spec §7.1**

```bash
pnpm db:sandbox
pnpm -r --filter='!@engineerdad/webapp' build
pnpm test
grep META_AD_ACCOUNT_ID .env.local   # confirm sandbox value, not production
mkdir -p data/e2e-snapshots/$(date +%Y%m%d)
export SNAP_DIR=data/e2e-snapshots/$(date +%Y%m%d)
export SANDBOX_DB=$(grep DATABASE_URL .env.local | sed 's|.*/||')
```

Restart Claude Code so MCP picks up the sandbox DB URL.

- [ ] **Step 2: Walk HG1 per spec §7.2**

```bash
# In a fresh Claude Code session:
/loop-once
# Wait for HG1 halt message.
docker exec engineerdad-postgres pg_dump -U engineerdad -d $SANDBOX_DB > $SNAP_DIR/01-hg1-pre.sql
```
Open `localhost:3030`. Verify run-header angle chips, then HG1 approval-guidance preview, then approve 2 Briefs from 2 different angles.
```bash
docker exec engineerdad-postgres pg_dump -U engineerdad -d $SANDBOX_DB > $SNAP_DIR/02-hg1-approved.sql
```

- [ ] **Step 3: Walk HG2 per spec §7.3**

```bash
/content --run=<runId>
docker exec engineerdad-postgres pg_dump -U engineerdad -d $SANDBOX_DB > $SNAP_DIR/03-hg2-pre.sql
# Approve 1 Script per approved Brief in the webapp.
docker exec engineerdad-postgres pg_dump -U engineerdad -d $SANDBOX_DB > $SNAP_DIR/04-hg2-approved.sql
```

- [ ] **Step 4: Walk HG3 per spec §7.4**

```bash
/produce --run=<runId>
docker exec engineerdad-postgres pg_dump -U engineerdad -d $SANDBOX_DB > $SNAP_DIR/05-hg3-pre.sql
# Approve 1 Carousel (4:5) + 1 Feed (4:5) variant via webapp.
docker exec engineerdad-postgres pg_dump -U engineerdad -d $SANDBOX_DB > $SNAP_DIR/06-hg3-approved.sql
```

- [ ] **Step 5: Walk to HG4 per spec §7.5**

```bash
/distribute --run=<runId>
docker exec engineerdad-postgres pg_dump -U engineerdad -d $SANDBOX_DB > $SNAP_DIR/07-hg4-final.sql
```

- [ ] **Step 6: Acceptance per spec §7.6 + §7.7**

Run the three DB queries in spec §7.6, then `mcp__meta-ads__list_campaigns` / `list_ads` per §7.7. All assertions must pass.

If any fail, use the §7.8 failure-replay loop: identify snapshot, patch, restore, restart Claude Code, resume.

- [ ] **Step 7: Teardown per spec §7.9**

Pause/archive the test Meta entities. Do NOT flip ACTIVE during validation. Keep snapshots as regression baseline.

---

## Part H — Rollout

### Task 25: Open PR + close bug rows

- [ ] **Step 1: Push branch + open PR**

```bash
git push -u origin feat/meta-paid-unblock
gh pr create --title "Meta-paid unblock: B-025 + B-026 + B-027 + webapp angle surface" --body "$(cat <<'EOF'
## Summary

- Closes B-025 (verify-experiment tri-state)
- Closes B-026 (brief-writer canonical angle taxonomy enforced)
- Closes B-027 (Meta-paid D2a: is_adset_budget_sharing_enabled, budget math, targeting)
- Adds webapp angle-visibility surface (run-header chips, Angle column on Briefs/Scripts/Variants, HG1 approval-guidance preview)
- Tightens briefs.angle to NOT NULL

Spec: docs/superpowers/specs/2026-05-29-meta-paid-unblock-design.html
Plan: docs/superpowers/plans/2026-05-29-meta-paid-unblock.md

## Test plan

- [x] Unit suite green (verify-experiment tri-state, verify-brief angle assertion, plan-distribution budget + targeting, create-campaign schema)
- [x] Schema migration applies cleanly on sandbox; lint:migrations passes
- [x] End-to-end §7 walk reaches HG4 with PAUSED Meta-paid entities (Carousel + Feed)
- [x] DB queries from spec §7.6 all pass
- [x] Meta sandbox shows campaign + ≥2 adsets + ≥2 ads, all PAUSED, non-zero budgets, MY+25-55+EN/MS targeting

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: After merge — run live migration**

```bash
git checkout main && git pull
# Final safety check — verify counts unchanged since spec was written:
docker exec engineerdad-postgres psql -U engineerdad -d engineerdad -c "SELECT COUNT(*) FROM experiments;"
docker exec engineerdad-postgres psql -U engineerdad -d engineerdad -c "SELECT COUNT(*) FROM briefs WHERE angle IS NULL;"
# Both must be 0. Then:
pnpm db:migrate
```

- [ ] **Step 3: Update TASKS.md**

Move B-025, B-026, B-027 to a Recently-closed style entry. Add a new row:

```markdown
### E-044 `v1.5` `P3` `orchestrator` `agents` — Partial-rework retry for brief-writer drift
Carved out from the Meta-paid unblock spec (2026-05-29). Today's
recovery contract on verify-brief failure is whole-worker re-spawn
(loop.md:56–63) or manual unblock. A partial-rework contract — verifier
returns per-row bad IDs; orchestrator re-spawns brief-writer with
"fix only these N Briefs, leave the other M alone" — would cap blast
radius further. Needs new verifier return shape, conductor retry
logic, and brief-writer idempotency contract.

**Trigger to re-open**: ≥2 cycles where post-fix brief-writer still
drifts on retry despite the structured recommendedAngles spawn-prompt arg.
```

- [ ] **Step 4: Commit + push the TASKS.md update**

```bash
git add TASKS.md
git commit -m "docs(tasks): close B-025/B-026/B-027; file E-044 partial-rework retry"
git push
```

---

## Self-review checklist (run after all tasks)

- [ ] Every spec §3 sub-section maps to at least one task in the plan.
- [ ] No `TBD` / `TODO` / "implement later" markers in any task description.
- [ ] Method signatures used across tasks match (`classifyExperimentStatus`, `targetingForCell`, `LOCALE_ID`, `dailyBudgetMyrFor`, `verifyBrief(result, recommendedAngles)`).
- [ ] Each TDD task has: red-test step → minimal impl step → green-test step → commit step.
- [ ] All commits cite the spec section.
- [ ] §7 acceptance walk is positioned after all code commits, before rollout.
