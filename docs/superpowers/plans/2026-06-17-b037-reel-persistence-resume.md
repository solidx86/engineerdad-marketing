# B-037 Reel Persistence + Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HeyGen Reels persist their assets reliably and self-heal on poll-timeout, so a Reel can never silently reach HG3 with empty `assetFiles`.

**Architecture:** Four layers. **L1** makes the orchestrator authoritative for reel `assetFiles` (writes them from the worker payload to the row UUID, killing the id-key mismatch). **L2** adds a `verify` to the `P2-render` fanout that holds the stage open on a reel poll-timeout so the engine re-enters and the worker resumes. **L3** adds a `verifyProduce` backstop that halts before HG3 if a reel claims success with empty assets. **L4** hardens `store.update`/`create` to reject unknown/ill-typed props loudly. Resume is worker-self-detected (forced by ADR-024: a stage `build` may do no I/O except `ctx.stageInput`).

**Tech Stack:** TypeScript, pnpm workspaces, drizzle-orm 0.36.4 (Postgres), vitest, the orchestrator step engine, the HeyGen reel-render-worker prompt.

**Spec:** `docs/superpowers/specs/2026-06-17-b037-reel-persistence-resume-design.html`

**Reference facts (verified against the code):**
- `RENDER_STATE` enum (`packages/store/src/schema.ts:69`, `packages/shared/src/zod.ts:167`): `"HeygenGenerating" | "HeygenCompleted" | "Uploaded" | "RenderFailed"`. Column `render_state` is `text`, **nullable, no default** (null for statics / fresh rows).
- `creative_variants.asset_files` is `jsonb` typed `{ url: string; sha256: string }[]`, **nullable, no default**.
- `ReelWorkerInput` (`packages/orchestrator/src/produce/reel-worker-input.ts`) carries both `id` (row UUID) and `variantId` (12-hex hash). The hash equals `shared::variantId(scriptId,"Reel","9:16")`.
- `reelRowIdByVariantId(run)` (`produce.ts`) already maps the hash → row UUID.
- `store.update` `fillOnlyIfEmpty` writes a field only when the existing value is `null`/`undefined`/`""` (`crud.ts:114`).
- ADR-024 (`build-context.ts`): a `build`'s only I/O is `ctx.stageInput`.
- `EDOS_REEL_PIPELINE=on` is the kill switch (`reelPipelineEnabled()` in `produce.ts`).

**No schema migration** — `assetFiles`, `renderState`, `reelHeygenJobId`, `renderStartedAt` all already exist; the phantom `durationSeconds`/`subtitleUrl` keys are removed from the worker, not added as columns.

**Build order rationale:** L4 + worker prompt + L1 (persist) first so reels actually work; then L3 (a true net, not a blanket halt); then L2 (resume). Ordering L3 before L1 would halt every reel run in the interim.

**Test commands:** Pure unit tests run from the repo root, e.g. `pnpm vitest run packages/store/src/validate-props.test.ts`. No `DATABASE_URL` is needed for the pure tests in Tasks 1–6 (none call `truncatePg`). Build sequentially with `pnpm -r --filter='!@engineerdad/webapp' build` (never the parallel form).

---

### Task 1: L4 — `store.update`/`create` prop validation

Reject props that name a non-existent column (the `durationSeconds`/`subtitleUrl` phantom-key class) or write a string into a timestamp column (the `value.toISOString is not a function` mid-write throw). A pure helper, unit-tested without a DB, then wired into CRUD.

**Files:**
- Create: `packages/store/src/validate-props.ts`
- Create: `packages/store/src/validate-props.test.ts`
- Modify: `packages/store/src/crud.ts` (add validation to `create` ~line 66 and `update` ~line 94)

- [ ] **Step 1: Write the failing test**

Create `packages/store/src/validate-props.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { creativeVariants } from "./schema.js";
import { validateProps } from "./validate-props.js";

describe("validateProps", () => {
  it("rejects unknown columns (the B-037 phantom keys)", () => {
    const problems = validateProps(creativeVariants, {
      assetFiles: [{ url: "https://x/y.mp4", sha256: "abc" }],
      durationSeconds: 28.7,
      subtitleUrl: "https://x/y.vtt",
    });
    expect(problems).toContain('unknown column "durationSeconds"');
    expect(problems).toContain('unknown column "subtitleUrl"');
  });

  it("accepts real columns", () => {
    expect(
      validateProps(creativeVariants, { assetFiles: [], renderState: "Uploaded" }),
    ).toEqual([]);
  });

  it("rejects a string written to a timestamp column", () => {
    const problems = validateProps(creativeVariants, {
      renderStartedAt: "2026-06-17T00:00:00Z",
    });
    expect(problems).toContain('column "renderStartedAt" expects a Date, got string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/store/src/validate-props.test.ts`
Expected: FAIL — `Failed to resolve import "./validate-props.js"`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/store/src/validate-props.ts`:

```ts
import { getTableColumns, type Table } from "drizzle-orm";

/**
 * Validate caller props against a drizzle table's real columns before a write.
 * Catches the B-037 class: unknown columns (silently dropped by drizzle) and
 * strings written to timestamp columns (which throw mid-write, corrupting the
 * row partially). Pure — table + props in, problem strings out.
 */
export function validateProps(table: Table, props: Record<string, unknown>): string[] {
  const columns = getTableColumns(table) as Record<string, { dataType?: string } | undefined>;
  const problems: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    const col = columns[key];
    if (!col) {
      problems.push(`unknown column "${key}"`);
      continue;
    }
    if (col.dataType === "date" && typeof value === "string") {
      problems.push(`column "${key}" expects a Date, got string`);
    }
  }
  return problems;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/store/src/validate-props.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into `crud.ts`**

In `packages/store/src/crud.ts`, add the import near the top (it already imports `eq` from `drizzle-orm`):

```ts
import { validateProps } from "./validate-props.js";
```

In `create` (currently the body starts at line 69 with `const scan = await deps.complianceScan(...)`), insert validation as the first lines of the function body, before the scan:

```ts
    async create<E extends EntityName>(
      entity: E,
      props: Record<string, unknown>,
    ): Promise<CreateResult> {
      const invalid = validateProps(ENTITIES[entity], props);
      if (invalid.length > 0) return { ok: false, problems: invalid };

      const scan = await deps.complianceScan(entity, props);
      if (!scan.ok) return { ok: false, problems: scan.problems };
      // ...rest unchanged
```

In `update` (body starts at line 100 with the scan), insert the same guard before the scan:

```ts
    async update<E extends EntityName>(
      entity: E,
      id: string,
      props: Record<string, unknown>,
      opts?: { fillOnlyIfEmpty?: boolean },
    ): Promise<UpdateResult> {
      const invalid = validateProps(ENTITIES[entity], props);
      if (invalid.length > 0) return { ok: false, problems: invalid };

      const scan = await deps.complianceScan(entity, props);
      if (!scan.ok) return { ok: false, problems: scan.problems };
      // ...rest unchanged
```

- [ ] **Step 6: Build the store package**

Run: `pnpm -r --filter='@engineerdad/store' build`
Expected: clean compile (no TS errors — `UpdateResult`/`CreateResult` already carry `problems`).

- [ ] **Step 7: Commit**

```bash
git add packages/store/src/validate-props.ts packages/store/src/validate-props.test.ts packages/store/src/crud.ts
git commit -m "feat(B-037 L4): validate props against real columns in store create/update

Reject unknown columns (durationSeconds/subtitleUrl phantom keys) and
string-into-timestamp writes loudly, instead of drizzle silently dropping
them or throwing mid-write.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 2: Worker prompt — correct write key, self-detect resume, emit `renderState`

`corpus/templates/worker-prompts/reel-render-worker.md` writes its row keyed on `input.variantId` (the hash) instead of `input.id` (the row UUID) — defect A. It also never self-detects a resume from its own row, and its return payload omits `renderState`. No automated test (it's an instruction file); verified by diff review and an empirical re-walk later (Task 7).

**Files:**
- Modify: `corpus/templates/worker-prompts/reel-render-worker.md`

- [ ] **Step 1: Read the regions to edit**

Run: `sed -n '74,80p;168,212p;242,246p' corpus/templates/worker-prompts/reel-render-worker.md`
Note the exact current text of: the Step 0 resume note (~74–78), Step 4a (~169–175), Step 4b (~177–185), Step 5 (~187–199), the return JSON (~203–212), and the timeout row (~244).

- [ ] **Step 2: Fix the write key in Step 4a and Step 5**

In **Step 4a** and **Step 5**, change the `mcp__store__update` target from `id: input.variantId` to `id: input.id`. Both writes must hit the pre-created row's UUID. Example for Step 4a:

```
    mcp__store__update({ entity: "CreativeVariants", id: input.id, props: {
      reelHeygenJobId: jobId, renderState: "HeygenGenerating",
      renderStartedAt: <a real Date, or omit> } })
```

If `renderStartedAt` is being written, it must be a `Date`, not a string (Task 1's validation now rejects a string here). If the worker cannot construct a `Date` cleanly, **omit `renderStartedAt`** from the props — it is not load-bearing.

- [ ] **Step 3: Remove the phantom keys from Step 5**

In **Step 5**, the terminal `mcp__store__update` must write only real columns. Replace its props with:

```
    mcp__store__update({ entity: "CreativeVariants", id: input.id, props: {
      renderState: "Uploaded",
      assetFiles: [{ url, sha256 }] } })
```

Delete the `durationSeconds:` and `subtitleUrl:` lines — they are not columns. (Duration already rides inside the asset object downstream if needed; it is not consumed today.)

- [ ] **Step 4: Add `renderState` to the return payload**

The return JSON (Step 5 / the "Return" block, ~line 203) must carry `renderState` so the orchestrator's L1 persist and L2 verify can read the worker's terminal state from the payload. The success payload:

```json
{
  "variantId": "<input.variantId>",
  "renderState": "Uploaded",
  "assetFiles": [{ "url": "<asset-store url>", "sha256": "<hex>" }],
  "reelHeygenJobId": "<jobId>"
}
```

On **RenderFailed** (HeyGen `status:"failed"`, chart-not-found, or submit-retries-exhausted), return:

```json
{ "variantId": "<input.variantId>", "renderState": "RenderFailed", "assetFiles": [], "error": "<reason>" }
```

On **poll-timeout**, the worker still exits non-fatally, but its payload (if any) must NOT carry `assetFiles` and must NOT be `RenderFailed` — leave `renderState` as `"HeygenGenerating"` so L2 classifies it as in-flight and resumes.

- [ ] **Step 5: Add Step 0 self-detect (resume + idempotent short-circuit)**

Replace the Step 0 resume note (the paragraph beginning "If `resumeFromJobId` is non-null…") with a row-driven self-detect. Insert this as the worker's Step 0, before Step 1:

```
### Step 0. Resume / idempotency self-detect (read your row FIRST)

Before anything else, read your row:
    mcp__store__get({ entity: "CreativeVariants", id: input.id })

Branch on its current `renderState`:
- `renderState === "Uploaded"` AND `assetFiles` non-empty → ALREADY DONE.
  Do NOT call HeyGen. Return the success payload using the row's existing
  `assetFiles` and `reelHeygenJobId`. (This is the idempotent short-circuit
  for a re-spawn of an already-finished reel — no double HeyGen spend.)
- `renderState === "HeygenGenerating"` AND `reelHeygenJobId` set → RESUME.
  Skip Steps 2–4 (build/upload/submit); jump straight to Step 4b (poll) using
  the row's `reelHeygenJobId`. The job was submitted on a prior pass.
- otherwise → FRESH RENDER. Proceed to Step 1 normally.
```

- [ ] **Step 6: Correct the stale resume claim**

At the timeout row (~line 244), the parenthetical currently promises "Next `/produce --run=<id>` pass resumes via the `resumeFromJobId` path (Step 4b)." Replace with the now-true statement:

```
| HeyGen poll timeout (5 min) | Persist remains intact (`reelHeygenJobId` + `renderState: "HeygenGenerating"`). Exit non-zero NON-fatally. The `P2-render` verify (B-037 L2) holds the stage open: the conductor re-spawns this unit (or the next `/produce --run=<id>` pass re-enters the un-advanced `P2-render`), and Step 0 self-detect resumes the job by polling `reelHeygenJobId`. |
```

- [ ] **Step 7: Review the diff**

Run: `git --no-pager diff corpus/templates/worker-prompts/reel-render-worker.md`
Confirm: every `store.update` keys on `input.id`; no `durationSeconds`/`subtitleUrl` remain; the return payload carries `renderState`; Step 0 self-detect is present; line 244 is corrected.

- [ ] **Step 8: Commit**

```bash
git add corpus/templates/worker-prompts/reel-render-worker.md
git commit -m "fix(B-037 L1/L2): reel worker writes to row UUID, self-detects resume

- store.update keys on input.id (row UUID), not input.variantId (hash) — the
  root cause of assetFiles never landing on the pre-created row
- drop phantom durationSeconds/subtitleUrl keys; emit renderState in payload
- Step 0 reads the row first: short-circuit if Uploaded, resume-poll if
  HeygenGenerating, else fresh render (idempotent re-spawn, no double spend)
- correct the now-true 'resumes next pass' timeout claim

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 3: L1a — `reelRenderResultsOf` extraction helper

A pure helper that reads the `P2-render` payloads and returns, per reel `variantId` hash, the `assetFiles` and `renderState` the worker reported. The orchestrator will persist these authoritatively in Task 4.

**Files:**
- Modify: `packages/orchestrator/src/stages/produce.ts` (add helper near `reelRowIdByVariantId`, ~line 566)
- Modify: `packages/orchestrator/src/stages/produce.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test**

Add to `packages/orchestrator/src/stages/produce.test.ts`. (Import `reelRenderResultsOf` alongside the file's existing imports; if the test file builds a `RunState` fixture already, reuse that helper — otherwise this inline fixture is self-contained.)

```ts
import { describe, it, expect } from "vitest";
import { reelRenderResultsOf } from "./produce.js";
import { variantId } from "@engineerdad/shared/derive";

function runWith(p1: unknown, p2: unknown[]): any {
  return {
    runId: "run_test",
    stage: "produce",
    status: "active",
    params: {},
    steps: [
      { stepId: "P1-fanout", stage: "produce", status: "done", result: p1, problems: [], attempts: 1 },
      { stepId: "P2-render", stage: "produce", status: "done", result: p2, problems: [], attempts: 1 },
    ],
  };
}

describe("reelRenderResultsOf", () => {
  const scriptId = "scr_1";
  const reelHash = variantId(scriptId, "Reel", "9:16");
  const p1 = [{ scriptId, creatives: [{ scriptId, format: "Reel", shotlistEn: [] }] }];

  it("maps a finished reel payload by variantId hash → assetFiles + renderState", () => {
    const p2 = [{ variantId: reelHash, renderState: "Uploaded", assetFiles: [{ url: "https://r2/x.mp4", sha256: "abc" }] }];
    const out = reelRenderResultsOf(runWith(p1, p2));
    expect(out.get(reelHash)).toEqual({
      assetFiles: [{ url: "https://r2/x.mp4", sha256: "abc" }],
      renderState: "Uploaded",
    });
  });

  it("captures a RenderFailed payload with empty assetFiles", () => {
    const p2 = [{ variantId: reelHash, renderState: "RenderFailed", assetFiles: [], error: "moderation" }];
    expect(reelRenderResultsOf(runWith(p1, p2)).get(reelHash)).toEqual({
      assetFiles: [],
      renderState: "RenderFailed",
    });
  });

  it("ignores static payloads (no matching reel hash)", () => {
    const p2 = [{ scenes: [{ variantId: "static_x", url: "u", sha256: "s" }] }];
    expect(reelRenderResultsOf(runWith(p1, p2)).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/orchestrator/src/stages/produce.test.ts -t "reelRenderResultsOf"`
Expected: FAIL — `reelRenderResultsOf is not exported`.

- [ ] **Step 3: Write minimal implementation**

In `packages/orchestrator/src/stages/produce.ts`, add (export it) just below `reelRowIdByVariantId` (~line 577):

```ts
/**
 * Extract per-reel asset results from the P2-render payloads, keyed by the
 * deterministic variantId hash. The orchestrator persists these authoritatively
 * (L1) rather than relying on the worker's own row write. Reel payloads carry a
 * top-level `assetFiles` + `renderState`; statics carry `scenes`/`rendered` and
 * are skipped (their hash never matches a reel unit).
 */
export function reelRenderResultsOf(
  run: RunState,
): Map<string, { assetFiles: { url: string; sha256: string }[]; renderState: string | null }> {
  const reelHashes = new Set(
    reelUnitsFromP1(run).map((u) => variantId(u.scriptId, "Reel", "9:16")),
  );
  const p2 = stepResult<unknown[]>(run, "P2-render") ?? [];
  const out = new Map<string, { assetFiles: { url: string; sha256: string }[]; renderState: string | null }>();
  for (const raw of p2) {
    let payload: unknown = raw;
    if (typeof payload === "string" && payload.trimStart().startsWith("{")) {
      try {
        payload = JSON.parse(payload);
      } catch {
        continue;
      }
    }
    if (payload === null || typeof payload !== "object") continue;
    const vid = (payload as { variantId?: unknown }).variantId;
    if (typeof vid !== "string" || !reelHashes.has(vid)) continue;
    const af = (payload as { assetFiles?: unknown }).assetFiles;
    const rs = (payload as { renderState?: unknown }).renderState;
    out.set(vid, {
      assetFiles: Array.isArray(af) ? (af as { url: string; sha256: string }[]) : [],
      renderState: typeof rs === "string" ? rs : null,
    });
  }
  return out;
}
```

`variantId` is already imported from `@engineerdad/shared/derive` at the top of `produce.ts`; `RunState`, `reelUnitsFromP1`, `stepResult` are all already in scope.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/orchestrator/src/stages/produce.test.ts -t "reelRenderResultsOf"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/stages/produce.ts packages/orchestrator/src/stages/produce.test.ts
git commit -m "feat(B-037 L1a): reelRenderResultsOf — extract reel assets from P2 payloads

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 4: L1b — persist reel assets authoritatively in `P3-persist`

Change the reel branch of `P3-persist` to write `assetFiles` + `renderState` **definitively** from `reelRenderResultsOf` (not `fillOnlyIfEmpty`, which skips a non-null/non-empty existing value), while keeping packaging fields fill-only so human HG3 edits survive a re-walk.

**Files:**
- Modify: `packages/orchestrator/src/stages/produce.ts` (`p3Persist.build`, ~lines 582–612)
- Modify: `packages/orchestrator/src/stages/produce.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `produce.test.ts` (reuse the `runWith` fixture from Task 3; extend it to include the `P1a-reels-prepare` result the reel-row lookup needs):

```ts
import { p3PersistCalls } from "./produce.js"; // test seam added in Step 3

describe("P3-persist reel branch (L1b)", () => {
  const scriptId = "scr_1";
  const reelHash = variantId(scriptId, "Reel", "9:16");
  const rowUuid = "11111111-1111-1111-1111-111111111111";

  function run(): any {
    return {
      runId: "run_test", stage: "produce", status: "active", params: {},
      steps: [
        { stepId: "P1-fanout", stage: "produce", status: "done", attempts: 1, problems: [],
          result: [{ scriptId, creatives: [{ scriptId, format: "Reel", shotlistEn: [], shotlistBm: [] }] }] },
        { stepId: "P1a-reels-prepare", stage: "produce", status: "done", attempts: 1, problems: [],
          result: [{ ok: true, id: rowUuid }] },
        { stepId: "P2-render", stage: "produce", status: "done", attempts: 1, problems: [],
          result: [{ variantId: reelHash, renderState: "Uploaded", assetFiles: [{ url: "https://r2/x.mp4", sha256: "abc" }] }] },
      ],
    };
  }

  it("emits a definitive assetFiles+renderState update (no fillOnlyIfEmpty) to the row UUID", () => {
    const calls = p3PersistCalls(run());
    const assetUpdate = calls.find(
      (c: any) => c.tool === "mcp__store__update" && c.args.id === rowUuid && c.args.props.assetFiles,
    );
    expect(assetUpdate).toBeDefined();
    expect(assetUpdate.args.props.assetFiles).toEqual([{ url: "https://r2/x.mp4", sha256: "abc" }]);
    expect(assetUpdate.args.props.renderState).toBe("Uploaded");
    expect(assetUpdate.args.opts?.fillOnlyIfEmpty).toBeFalsy();
  });

  it("still emits a fill-only packaging update that does NOT carry assetFiles", () => {
    const calls = p3PersistCalls(run());
    const pkg = calls.find(
      (c: any) => c.tool === "mcp__store__update" && c.args.id === rowUuid && c.args.opts?.fillOnlyIfEmpty === true,
    );
    expect(pkg).toBeDefined();
    expect(pkg.args.props.assetFiles).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/orchestrator/src/stages/produce.test.ts -t "P3-persist reel branch"`
Expected: FAIL — `p3PersistCalls is not exported`.

- [ ] **Step 3: Extract a testable `p3PersistCalls` seam and implement the reel split**

In `produce.ts`, refactor the `p3Persist.build` body into an exported pure function so it can be unit-tested, and change the reel branch from one `fillOnlyIfEmpty` update to a fill-only packaging update **plus** a definitive asset update. Replace the `p3Persist` definition (lines 579–636) with:

```ts
export function p3PersistCalls(run: RunState): { tool: string; args: Record<string, unknown> }[] {
  const plan = foldCreativePlan(run.runId, stepResult<unknown>(run, "P1-fanout"));
  const specs = deriveSpecs(plan, renderResultsOf(run));
  const reelRowIds = reelRowIdByVariantId(run);
  const reelResults = reelRenderResultsOf(run);
  return [
    ...specs.flatMap((v) => {
      if (v.format === "Reel") {
        const id = reelRowIds.get(v.variantId);
        if (!id) {
          // No pre-created row (pipeline off / no reels) — fall back to create.
          return [
            {
              tool: "mcp__store__create",
              args: { entity: "CreativeVariants", props: variantProperties(v, run.runId) },
            },
          ];
        }
        // Packaging fill-only (preserve human HG3 edits on a re-walk); strip
        // assetFiles so it never rides the fill-only path (where an existing
        // null/[] would be ambiguous).
        const { assetFiles: _omitAssets, ...packaging } = variantProperties(v, run.runId);
        const calls: { tool: string; args: Record<string, unknown> }[] = [
          {
            tool: "mcp__store__update",
            args: { entity: "CreativeVariants", id, props: packaging, opts: { fillOnlyIfEmpty: true } },
          },
        ];
        // Definitive asset write from the worker payload (the L1 fix).
        const rr = reelResults.get(v.variantId);
        if (rr) {
          const assetProps: Record<string, unknown> = {};
          if (rr.renderState) assetProps.renderState = rr.renderState;
          if (rr.assetFiles.length > 0) assetProps.assetFiles = rr.assetFiles;
          if (Object.keys(assetProps).length > 0) {
            calls.push({
              tool: "mcp__store__update",
              args: { entity: "CreativeVariants", id, props: assetProps },
            });
          }
        }
        return calls;
      }
      return [
        {
          tool: "mcp__store__create",
          args: { entity: "CreativeVariants", props: variantProperties(v, run.runId) },
        },
      ];
    }),
    // Trailing call: the approved AuthorityArticles for P4's article pass.
    {
      tool: "mcp__store__query",
      args: {
        entity: "AuthorityArticles",
        filter: { runId: run.runId, approvalStatus: "Approved" },
        fields: [
          "titleEn", "topic", "targetQuery", "bodyEn", "slug",
          "description", "readingTime", "keywords", "topicTag", "ogImageUrl",
        ],
      },
    },
  ];
}

const p3Persist: StepSpec = {
  id: "P3-persist",
  kind: "write",
  build: (run): Step => ({ kind: "write", stepId: "P3-persist", calls: p3PersistCalls(run) }),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/orchestrator/src/stages/produce.test.ts -t "P3-persist reel branch"`
Expected: PASS (2 tests). Also run the whole file to confirm no regression: `pnpm vitest run packages/orchestrator/src/stages/produce.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/stages/produce.ts packages/orchestrator/src/stages/produce.test.ts
git commit -m "feat(B-037 L1b): persist reel assetFiles definitively in P3-persist

Orchestrator writes assetFiles+renderState from the P2 payload to the row
UUID (definitive, not fillOnlyIfEmpty); packaging stays fill-only. Reels are
now symmetric with statics; no longer depends on the worker's row write.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 5: L3 — `verifyProduce` reel backstop + P5 wiring

A reel that reaches `P5-confirm` with empty `assetFiles` is a `halt` (unless it is legitimately `RenderFailed`, which is a soft flag to HG3). Gated by `reelPipelineEnabled()`.

**Files:**
- Modify: `packages/orchestrator/src/verifiers/verify-produce.ts` (`ProduceVariant` interface; `verifyProduce` signature + reel block)
- Modify: `packages/orchestrator/src/verifiers/verify-produce.test.ts`
- Modify: `packages/orchestrator/src/stages/produce.ts` (`projectVariant`; `P5-confirm` query fields; the `verifyProduce(...)` call)

- [ ] **Step 1: Write the failing test**

Add to `packages/orchestrator/src/verifiers/verify-produce.test.ts`. Use a small builder for the existing `ProduceVariant` shape (mirror the fields the file's other tests use, adding `renderState`):

```ts
import { describe, it, expect } from "vitest";
import { verifyProduce, type ProduceVariant } from "./verify-produce.js";

function reel(over: Partial<ProduceVariant> = {}): ProduceVariant {
  return {
    id: "v_reel", scriptId: "scr_1", format: "Reel", aspect: "9:16",
    channels: ["Meta-paid"], assetFiles: [], renderState: "Uploaded",
    metaSpecComplete: true, organicSpecComplete: true, complianceCheck: true,
    estCostMyr: 0, organicCaptionEn: "", organicCaptionBm: "", ...over,
  };
}

describe("verifyProduce reel backstop (L3)", () => {
  // One script, 5 variants required by the matrix — stub the other 4 as valid statics/yt.
  const scripts = [{ id: "scr_1" }];
  function five(reelOver: Partial<ProduceVariant>): ProduceVariant[] {
    const filler = (format: string, channels: string[]): ProduceVariant => ({
      id: `v_${format}`, scriptId: "scr_1", format, aspect: "x", channels,
      assetFiles: format === "Feed" || format === "Carousel" ? [{ url: "u", sha256: "s" }] : [],
      renderState: "", metaSpecComplete: true, organicSpecComplete: true,
      complianceCheck: true, estCostMyr: 0, organicCaptionEn: "", organicCaptionBm: "",
    });
    return [
      reel(reelOver),
      filler("Feed", ["Meta-paid"]),
      filler("Carousel", ["Meta-paid"]),
      filler("Carousel", ["Meta-paid"]),
      filler("YT-Long", ["YouTube"]),
    ];
  }

  it("HALTS an Uploaded reel with empty assetFiles when pipeline is on", () => {
    const r = verifyProduce(scripts, five({ renderState: "Uploaded", assetFiles: [] }), 0, 1, true);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.includes("v_reel") && p.includes("B-037"))).toBe(true);
  });

  it("SOFT-FLAGS (does not halt) a RenderFailed reel with empty assetFiles", () => {
    const r = verifyProduce(scripts, five({ renderState: "RenderFailed", assetFiles: [] }), 0, 1, true);
    expect(r.problems.some((p) => p.includes("v_reel"))).toBe(false);
    expect((r.data?.flags as string[] | undefined)?.some((f) => f.includes("v_reel"))).toBe(true);
  });

  it("passes a reel that has assetFiles", () => {
    const r = verifyProduce(scripts, five({ renderState: "Uploaded", assetFiles: [{ url: "u", sha256: "s" }] }), 0, 1, true);
    expect(r.problems.some((p) => p.includes("v_reel"))).toBe(false);
  });

  it("does NOT check reels when the pipeline is off", () => {
    const r = verifyProduce(scripts, five({ renderState: "", assetFiles: [] }), 0, 1, false);
    expect(r.problems.some((p) => p.includes("v_reel"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/orchestrator/src/verifiers/verify-produce.test.ts -t "reel backstop"`
Expected: FAIL — `verifyProduce` takes 4 args / `ProduceVariant` has no `renderState`.

- [ ] **Step 3: Implement — interface, signature, reel block**

In `packages/orchestrator/src/verifiers/verify-produce.ts`:

(a) Add `renderState` to the `ProduceVariant` interface (after `assetFiles`):

```ts
  assetFiles: { url: string; sha256: string }[];
  renderState: string;
```

(b) Change the `verifyProduce` signature and add the reel backstop. Update the function header:

```ts
export function verifyProduce(
  scripts: ProduceScript[],
  variants: ProduceVariant[],
  reportedTotalMyr: number,
  renderWorkersRan: number,
  reelPipelineEnabled: boolean,
): VerifyResult {
  const problems: string[] = [];
  const flags: string[] = [];
  const FORMAT_MATRIX = 5; // Reel, Feed, YT-Long, Carousel x2
```

(c) Before the final `return`, add the reel backstop and fold flags into the result:

```ts
  // ── B-037 L3: a reel must carry an asset by P5, unless it legitimately
  //    failed to render. Gated by the kill switch — pipeline-off reels are
  //    asset-less by design. Any non-RenderFailed reel with empty assetFiles
  //    is stranded (claims Uploaded, stuck HeygenGenerating, or never rendered).
  if (reelPipelineEnabled) {
    for (const v of variants.filter((x) => x.format === "Reel")) {
      if (v.assetFiles.length > 0) continue;
      if (v.renderState === "RenderFailed") {
        flags.push(`reel ${v.id}: RenderFailed — no asset; review/regenerate at HG3`);
      } else {
        problems.push(
          `reel ${v.id}: empty Asset Files with renderState "${v.renderState}" — reel did not persist (B-037)`,
        );
      }
    }
  }

  const res: VerifyResult = { ok: problems.length === 0, problems };
  if (flags.length > 0) res.data = { flags };
  return res;
}
```

Replace the old `return { ok: problems.length === 0, problems };` at the end of the function with the `res` block above.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/orchestrator/src/verifiers/verify-produce.test.ts -t "reel backstop"`
Expected: PASS (4 tests). Run the whole file too: `pnpm vitest run packages/orchestrator/src/verifiers/verify-produce.test.ts` → existing tests still PASS.

- [ ] **Step 5: Wire P5-confirm (query field, projection, call site)**

In `packages/orchestrator/src/stages/produce.ts`:

(a) `projectVariant` — add `renderState` (after the `assetFiles` line):

```ts
    assetFiles: arr("assetFiles") as { url: string; sha256: string }[],
    renderState: str("renderState"),
```

(b) `p5Confirm.build` — add `"renderState"` to the `CreativeVariants` query `fields` array (the list that currently ends with `"estimatedCostMyr"`):

```ts
            "complianceCheck",
            "estimatedCostMyr",
            "renderState",
```

(c) `p5Confirm.verify` — pass the kill-switch flag to `verifyProduce`:

```ts
    const base = verifyProduce(scripts, variants, reportedTotal, renderWorkersRan, reelPipelineEnabled());
```

`reelPipelineEnabled()` is already defined in this file.

- [ ] **Step 6: Build the orchestrator package**

Run: `pnpm -r --filter='@engineerdad/orchestrator' build`
Expected: clean compile.

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator/src/verifiers/verify-produce.ts packages/orchestrator/src/verifiers/verify-produce.test.ts packages/orchestrator/src/stages/produce.ts
git commit -m "feat(B-037 L3): verifyProduce halts a stranded reel before HG3

A pipeline-on reel reaching P5 with empty assetFiles halts (renderState
Uploaded/HeygenGenerating/HeygenCompleted) or soft-flags (RenderFailed).
P5 query + projection now read renderState.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 6: L2 — `P2-render` verify (resume trigger)

Add a `verify` to the `P2-render` fanout. Statics pass. A reel passes if its payload reports a finished asset or a genuine `RenderFailed`; an in-flight/timeout reel returns `ok:false` with a transient-flavoured message, so the conductor re-spawns (Step-0 self-detect resumes the job) or — if still generating — STOPs for a later `/produce` re-entry.

**Files:**
- Modify: `packages/orchestrator/src/stages/produce.ts` (`p2Render` — add `verify`)
- Modify: `packages/orchestrator/src/stages/produce.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `produce.test.ts` (reuse `variantId`):

```ts
import { p2RenderVerify } from "./produce.js"; // test seam added in Step 3

describe("P2-render verify (L2 resume trigger)", () => {
  const scriptId = "scr_1";
  const reelHash = variantId(scriptId, "Reel", "9:16");
  const run = (): any => ({
    runId: "run_test", stage: "produce", status: "active", params: {},
    steps: [{ stepId: "P1-fanout", stage: "produce", status: "done", attempts: 1, problems: [],
      result: [{ scriptId, creatives: [{ scriptId, format: "Reel", shotlistEn: [] }] }] }],
  });

  it("passes a finished reel (payload has assetFiles)", () => {
    const r = p2RenderVerify(run(), [{ variantId: reelHash, renderState: "Uploaded", assetFiles: [{ url: "u", sha256: "s" }] }], true);
    expect(r.ok).toBe(true);
  });

  it("transient-fails an in-flight reel (no assetFiles, HeygenGenerating)", () => {
    const r = p2RenderVerify(run(), [{ variantId: reelHash, renderState: "HeygenGenerating", assetFiles: [] }], true);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/still rendering|resume|re-run/i);
  });

  it("passes (flags) a RenderFailed reel — does not loop", () => {
    const r = p2RenderVerify(run(), [{ variantId: reelHash, renderState: "RenderFailed", assetFiles: [], error: "moderation" }], true);
    expect(r.ok).toBe(true);
    expect((r.data?.flags as string[] | undefined)?.length).toBeGreaterThan(0);
  });

  it("passes when the reel pipeline is off", () => {
    const r = p2RenderVerify(run(), [{ variantId: reelHash, renderState: "HeygenGenerating", assetFiles: [] }], false);
    expect(r.ok).toBe(true);
  });

  it("passes a statics-only fanout result", () => {
    const r = p2RenderVerify(run(), [{ scenes: [{ variantId: "static_x", url: "u", sha256: "s" }] }], true);
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/orchestrator/src/stages/produce.test.ts -t "P2-render verify"`
Expected: FAIL — `p2RenderVerify is not exported`.

- [ ] **Step 3: Implement the verify**

In `produce.ts`, add the exported pure verify function just above the `p2Render` definition, then attach it. Insert before `const p2Render: StepSpec = {`:

```ts
/**
 * B-037 L2 — the reel resume trigger. Statics pass (synchronous renders; their
 * real check is P5). A reel passes when its payload reports a finished asset or
 * a genuine RenderFailed; an in-flight/timeout reel (no assetFiles, not failed)
 * transient-fails so the conductor re-spawns (Step-0 self-detect resumes) or
 * STOPs for a later /produce re-entry. Gated by the kill switch.
 */
export function p2RenderVerify(
  run: RunState,
  result: unknown,
  reelPipelineEnabled: boolean,
): VerifyResult {
  if (!reelPipelineEnabled) return { ok: true, problems: [] };
  const reelHashes = new Set(
    reelUnitsFromP1(run).map((u) => variantId(u.scriptId, "Reel", "9:16")),
  );
  const payloads = Array.isArray(result) ? result : [];
  const problems: string[] = [];
  const flags: string[] = [];
  for (const raw of payloads) {
    let payload: unknown = raw;
    if (typeof payload === "string" && payload.trimStart().startsWith("{")) {
      try {
        payload = JSON.parse(payload);
      } catch {
        continue;
      }
    }
    if (payload === null || typeof payload !== "object") continue;
    const vid = (payload as { variantId?: unknown }).variantId;
    if (typeof vid !== "string" || !reelHashes.has(vid)) continue; // statics & non-reels skip
    const af = (payload as { assetFiles?: unknown }).assetFiles;
    const rs = (payload as { renderState?: unknown }).renderState;
    if (Array.isArray(af) && af.length > 0) continue; // done
    if (rs === "RenderFailed") {
      flags.push(`reel ${vid}: RenderFailed — no asset; review at HG3`);
      continue;
    }
    problems.push(
      `reel ${vid} still rendering on HeyGen (renderState=${typeof rs === "string" ? rs : "unknown"}); re-run /produce to resume`,
    );
  }
  const res: VerifyResult = { ok: problems.length === 0, problems };
  if (flags.length > 0) res.data = { flags };
  return res;
}
```

Then attach it to `p2Render` by adding a `verify` property to the `StepSpec` object (after the `build` closes, before the object's closing brace):

```ts
const p2Render: StepSpec = {
  id: "P2-render",
  kind: "fanout",
  build: async (run, ctx): Promise<Step> => {
    // ...unchanged...
  },
  verify: (run, result): VerifyResult => p2RenderVerify(run, result, reelPipelineEnabled()),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/orchestrator/src/stages/produce.test.ts -t "P2-render verify"`
Expected: PASS (5 tests). Whole file: `pnpm vitest run packages/orchestrator/src/stages/produce.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/stages/produce.ts packages/orchestrator/src/stages/produce.test.ts
git commit -m "feat(B-037 L2): P2-render verify holds the stage open on reel timeout

Statics pass; a finished/RenderFailed reel passes; an in-flight reel
transient-fails so the conductor re-spawns (worker Step-0 self-detect
resumes) or STOPs for a later /produce re-entry.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

---

### Task 7: Integration test, docs, full build

Prove the three reel paths end-to-end through the verify layer, update the tracker, and confirm the whole workspace builds and the touched packages' suites pass.

**Files:**
- Modify: `packages/orchestrator/src/stages/produce.test.ts` (an integration-style describe wiring P2-verify → P3 calls → P5 `verifyProduce`)
- Modify: `docs/TASKS.md` (B-037 status)
- Modify: `docs/archive/DONE.md` (only if closing; otherwise annotate TASKS.md)

- [ ] **Step 1: Write the cross-layer test**

Add to `produce.test.ts` — drive a single reel through L2 → L1 → L3 for each outcome, asserting the layer hand-off is coherent:

```ts
import { verifyProduce } from "../verifiers/verify-produce.js";

describe("B-037 cross-layer reel outcomes", () => {
  const scriptId = "scr_1";
  const reelHash = variantId(scriptId, "Reel", "9:16");

  it("timeout → L2 transient-fails (stage held, never reaches P3/P5)", () => {
    const run: any = { runId: "r", stage: "produce", status: "active", params: {},
      steps: [{ stepId: "P1-fanout", status: "done", stage: "produce", attempts: 1, problems: [],
        result: [{ scriptId, creatives: [{ scriptId, format: "Reel", shotlistEn: [] }] }] }] };
    const v = p2RenderVerify(run, [{ variantId: reelHash, renderState: "HeygenGenerating", assetFiles: [] }], true);
    expect(v.ok).toBe(false); // conductor re-spawns / STOPs — P3 never runs
  });

  it("done → L1 persists assetFiles → L3 passes", () => {
    // L3 sees the persisted row (renderState Uploaded + assetFiles present)
    const variants = [{
      id: "v_reel", scriptId, format: "Reel", aspect: "9:16", channels: ["Meta-paid"],
      assetFiles: [{ url: "https://r2/x.mp4", sha256: "abc" }], renderState: "Uploaded",
      metaSpecComplete: true, organicSpecComplete: true, complianceCheck: true,
      estCostMyr: 0, organicCaptionEn: "", organicCaptionBm: "",
    }];
    // matrix needs 5; this focuses the reel rule, so assert no reel problem specifically
    const r = verifyProduce([{ id: scriptId }], variants as any, 0, 1, true);
    expect(r.problems.some((p) => p.includes("v_reel"))).toBe(false);
  });

  it("RenderFailed → L3 soft-flags, does not halt", () => {
    const variants = [{
      id: "v_reel", scriptId, format: "Reel", aspect: "9:16", channels: ["Meta-paid"],
      assetFiles: [], renderState: "RenderFailed",
      metaSpecComplete: true, organicSpecComplete: true, complianceCheck: true,
      estCostMyr: 0, organicCaptionEn: "", organicCaptionBm: "",
    }];
    const r = verifyProduce([{ id: scriptId }], variants as any, 0, 1, true);
    expect(r.problems.some((p) => p.includes("v_reel"))).toBe(false);
    expect((r.data?.flags as string[] | undefined)?.some((f) => f.includes("v_reel"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the cross-layer test**

Run: `pnpm vitest run packages/orchestrator/src/stages/produce.test.ts -t "cross-layer"`
Expected: PASS (3 tests).

- [ ] **Step 3: Full build of touched packages (sequential — never parallel)**

Run: `pnpm -r --filter='@engineerdad/store' --filter='@engineerdad/orchestrator' build`
Expected: clean compile.

- [ ] **Step 4: Run the touched suites**

Run:
```bash
pnpm vitest run packages/store/src/validate-props.test.ts
pnpm vitest run packages/orchestrator/src/verifiers/verify-produce.test.ts
pnpm vitest run packages/orchestrator/src/stages/produce.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Update the tracker**

In `docs/TASKS.md`, update the B-037 entry: note the four layers shipped (L1 orchestrator-authoritative persist, L2 P2-render resume verify, L3 verifyProduce backstop, L4 store prop validation), the worker write-key fix, and that defect A + B now self-heal. Keep the manual-recovery history. Refresh the Status header's open-bug list (remove B-037 from "Open" if fully closed; otherwise annotate "fix landed, E2E walk pending"). Move to `docs/archive/DONE.md` only after the empirical walk (Step 7) passes — retain the `B-037` ID per the convention.

- [ ] **Step 6: Commit docs + tests**

```bash
git add packages/orchestrator/src/stages/produce.test.ts docs/TASKS.md
git commit -m "test(B-037): cross-layer reel outcomes + tracker update

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

- [ ] **Step 7: Empirical walk (manual, post-merge gate — not a code step)**

The worker prompt has no automated test. Before closing B-037 in `DONE.md`, run a real reel `/produce` with `EDOS_REEL_PIPELINE=on` on a branch sandbox and confirm: (a) a clean reel lands `assetFiles` on its row and clears P5; (b) a forced poll-timeout re-enters `P2-render` on a second `/produce --run=<id>` and resumes without a second HeyGen submission; (c) a row left empty fails P5 with the B-037 message. Record the runId in the TASKS.md/DONE.md entry. This is the same evidence the E-004 G4 gate consumes.

---

## Notes for the implementer

- **Why two `store.update` calls for a reel in P3 (Task 4):** `fillOnlyIfEmpty` writes only when the existing value is null/undefined/"". The skeleton row's `assetFiles` is null, so it would write *once*, but on any re-walk an existing non-empty value would block the refresh. Splitting the definitive asset write out makes the latest render authoritative every pass, while packaging stays fill-only to preserve human HG3 edits.
- **Why the worker fix (Task 2) is required for L2 (Task 6) to be safe:** L2's transient-fail makes the conductor re-spawn the fanout, which re-runs *all* reel workers. Without the Step-0 self-detect, a re-spawned finished reel would re-submit to HeyGen (double spend) and an in-flight reel would start a *new* job instead of polling the existing one. Step-0 self-detect (short-circuit / resume-poll) is what makes the re-spawn idempotent.
- **Out of scope (do not add):** pixel/vision compliance of rendered assets; a build-level "skip Uploaded reels" optimization (forbidden by ADR-024 — the build does no I/O); YT-Long 16:9 (E-004a); carrying reel `duration` on `assetFiles` (column type is `{url,sha256}[]`; revisit as a separate schema decision if a consumer needs it).
- **Reel `complianceCheck` flag:** unchanged by this work. Banned reel content already fails loudly (the P3 `store.update` content scan returns `{ok:false}` → write-step halt). Refreshing the flag on the P3 update is a noted polish, not required here.
