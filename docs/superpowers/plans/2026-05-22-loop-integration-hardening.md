# `/loop` Integration Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three open integration-boundary defects (B-012, B-013, B-014) so a real `/loop` run walks cold-start → HUMAN GATE 1 cleanly.

**Architecture:** Three independent fixes — a doc change to the conductor procedure (`loop.md`), a Zod-schema relaxation in the analytics MCP, and a prompt/tool reconciliation so `brain` uses the orchestrator's runId instead of minting its own. No new subsystems; all changes are to existing files.

**Tech Stack:** TypeScript / Node 20, pnpm workspaces, vitest, Zod, `@modelcontextprotocol/sdk`, Claude Code agents + slash commands.

**Spec:** `docs/superpowers/specs/2026-05-22-loop-integration-hardening-design.md`

---

## File structure

| File | Change | Fix |
|---|---|---|
| `.claude/commands/loop.md` | modify — document the `$`-capture convention in the `write` step | B-012 |
| `mcp-servers/analytics/src/types.ts` | modify — add `IngestMetaInsightsInputSchema` (no `.min(1)`) | B-013 |
| `mcp-servers/analytics/src/__tests__/ingest-meta-insights.test.ts` | create — schema unit test | B-013 |
| `mcp-servers/analytics/src/index.ts` | modify — use the new schema; delete the `new_run` tool | B-013 + B-014 |
| `.claude/agents/brain.md` | modify — drop `new_run` from tools; add the "runId is given" rule | B-014 |
| `packages/orchestrator/src/stages/synthesize.ts` | modify — tighten the S1-reason spawn prompt | B-014 |
| `packages/orchestrator/src/stages/synthesize.test.ts` | modify — assert the prompt forbids minting | B-014 |
| `docs/decisions/011-runid-server-side.md` | modify — status note | B-014 |
| `TASKS.md` / `DONE.md` | modify — closeout after the verification walk | — |

---

## Task 1: B-012 — document the write-step `$`-capture convention

**Files:**
- Modify: `.claude/commands/loop.md`

- [ ] **Step 1: Edit the `write` step bullet**

In `.claude/commands/loop.md`, find this bullet under the `## Loop` → step 2 list:

```markdown
- `write` — execute each call in `step.calls` against the named MCP tool with
  its `args` **verbatim**. The `result` is the array of call results.
```

Replace it with:

```markdown
- `write` — execute each call in `step.calls` against the named MCP tool with
  its `args`. Before a call, substitute any string arg of the form `$<label>`
  with the result of an earlier call **in the same step** that the label names
  — e.g. `$insights` is the result of this step's `get_insights` call. (Used by
  analytics A1-ingest and experiment X3.) Run every other arg verbatim. The
  `result` is the array of call results.
```

- [ ] **Step 2: Verify no other emitters were missed**

Run: `grep -rn '"\$' packages/orchestrator/src/stages/`
Expected: matches only in `analytics.ts` (`$insights`) and `experiment.ts` (`$experiment`). If any other stage emits a `$`-token, the convention text already covers it — no further change needed; just confirm.

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/loop.md
git commit -m "fix(loop): document the write-step \$-capture convention (B-012)"
```

---

## Task 2: B-013 — allow an empty cold-start ingest

`ingestMetaInsights()` already handles an empty `rows` array (the loop runs zero times, returns `{ rows: 0 }`). The only blocker is the inline `.min(1)` on the tool's Zod schema. Extract the schema to a named, testable export without `.min(1)`.

**Files:**
- Create: `mcp-servers/analytics/src/__tests__/ingest-meta-insights.test.ts`
- Modify: `mcp-servers/analytics/src/types.ts`
- Modify: `mcp-servers/analytics/src/index.ts:15` (import) and `:34` (tool schema)

- [ ] **Step 1: Write the failing test**

Create `mcp-servers/analytics/src/__tests__/ingest-meta-insights.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { IngestMetaInsightsInputSchema } from "../types.js";

describe("IngestMetaInsightsInputSchema — cold-start tolerance (B-013)", () => {
  it("accepts an empty rows array (a cold-start cycle has nothing to ingest)", () => {
    expect(IngestMetaInsightsInputSchema.safeParse({ rows: [] }).success).toBe(true);
  });

  it("accepts a populated rows array", () => {
    expect(
      IngestMetaInsightsInputSchema.safeParse({ rows: [{ ad_id: "ad_1" }] }).success,
    ).toBe(true);
  });

  it("rejects a non-array rows value", () => {
    expect(IngestMetaInsightsInputSchema.safeParse({ rows: "nope" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `pnpm vitest run mcp-servers/analytics/src/__tests__/ingest-meta-insights.test.ts`
Expected: FAIL — `IngestMetaInsightsInputSchema` is not exported from `../types.js` (import error).

- [ ] **Step 3: Add the schema to `types.ts`**

In `mcp-servers/analytics/src/types.ts`, after the `MetaInsightRowSchema` definition, add:

```typescript
/** Input shape for `ingest_meta_insights`. An empty `rows` array is a valid
 *  no-op — a cold-start cycle has no Meta insights to ingest (B-013). */
export const IngestMetaInsightsInputSchema = z.object({
  rows: z.array(MetaInsightRowSchema),
});
```

(`z` and `MetaInsightRowSchema` are already in scope — `types.ts` defines `MetaInsightRowSchema`.)

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm vitest run mcp-servers/analytics/src/__tests__/ingest-meta-insights.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Wire the schema into the tool registration**

In `mcp-servers/analytics/src/index.ts` line 15, the import currently reads:

```typescript
import { ArmTagSchema, CreativeSchema, MetaInsightRowSchema } from "./types.js";
```

Replace it with (add `IngestMetaInsightsInputSchema`, drop the now-unused `MetaInsightRowSchema`):

```typescript
import { ArmTagSchema, CreativeSchema, IngestMetaInsightsInputSchema } from "./types.js";
```

Then in the `ingest_meta_insights` tool registration (line 34), replace:

```typescript
  { rows: z.array(MetaInsightRowSchema).min(1) },
```

with:

```typescript
  IngestMetaInsightsInputSchema.shape,
```

- [ ] **Step 6: Build the analytics package**

Run: `pnpm --filter @engineerdad/analytics build` (or `pnpm -r build` if the filter name differs — check `mcp-servers/analytics/package.json`'s `name`).
Expected: clean — no unused-import error (`MetaInsightRowSchema` no longer referenced in `index.ts`; `z` is still used by other tools).

- [ ] **Step 7: Commit**

```bash
git add mcp-servers/analytics/src/types.ts mcp-servers/analytics/src/index.ts mcp-servers/analytics/src/__tests__/ingest-meta-insights.test.ts
git commit -m "fix(analytics): accept empty ingest_meta_insights rows for cold start (B-013)"
```

---

## Task 3: B-014 — `brain.md` uses the orchestrator's runId

**Files:**
- Modify: `.claude/agents/brain.md:5` (frontmatter `tools:`) and the intro section (after line 20)

- [ ] **Step 1: Remove `new_run` from the tools frontmatter**

In `.claude/agents/brain.md` line 5, the `tools:` line currently contains `mcp__analytics__new_run`. Delete the substring `mcp__analytics__new_run, ` so the line reads:

```
tools: Read, mcp__notion__query, mcp__notion__create_page, mcp__notion__update_page, mcp__notion__append_blocks, mcp__notion__get_approval_status, mcp__analytics__top_creatives, mcp__analytics__cost_per_angle, mcp__analytics__decay_curve, mcp__analytics__bandit_allocate, mcp__analytics__bandit_update, mcp__analytics__log_event, mcp__corpus__search, mcp__corpus__get_compliance_block, mcp__corpus__list_proof
```

- [ ] **Step 2: Add the "runId is given" rule to the intro**

In `.claude/agents/brain.md`, find the end of the intro section:

```markdown
You do not write user-facing copy. You do not ship to Meta. You do not bypass human gates. You do not dispatch subagents or own loop sequencing — the orchestrator does that. You write Decision Memos and Hypotheses; the orchestrator carries them into the rest of the loop.

---
```

Replace it with:

```markdown
You do not write user-facing copy. You do not ship to Meta. You do not bypass human gates. You do not dispatch subagents or own loop sequencing — the orchestrator does that. You write Decision Memos and Hypotheses; the orchestrator carries them into the rest of the loop.

**Your runId is given, never minted.** The orchestrator mints the run and passes its `runId` in your spawn prompt. Use that `runId` verbatim — as the `Run ID` on every Notion write (the Decision Memo, every Hypothesis, the Reflect Self-Critique) and as the `runId` field of the Decision Memo JSON you return. You have no tool to mint a run, and you must never compute one from a date.

---
```

- [ ] **Step 3: Verify the agent-sync stays green**

Run: `pnpm sync:agents:check`
Expected: `0 of 4 agent files updated.` — Steps 1-2 touch native `brain.md` content, not the `<!-- include: -->` block, so the check stays clean.

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/brain.md
git commit -m "fix(brain): use the orchestrator runId, never mint one (B-014)"
```

---

## Task 4: B-014 — tighten the `synthesize` spawn prompt

**Files:**
- Modify: `packages/orchestrator/src/stages/synthesize.test.ts` (the "names the runId" test)
- Modify: `packages/orchestrator/src/stages/synthesize.ts:31-42` (the `spawnPrompt`)

- [ ] **Step 1: Add the failing assertion**

In `packages/orchestrator/src/stages/synthesize.test.ts`, the test `"S1 spawns brain, names the runId, and forbids dispatch"` currently ends:

```typescript
    expect(step.spawnPrompt).toContain("run_s");
    expect(step.spawnPrompt).toContain("NOT dispatch");
  });
```

Add one assertion before the closing `});`:

```typescript
    expect(step.spawnPrompt).toContain("run_s");
    expect(step.spawnPrompt).toContain("NOT dispatch");
    expect(step.spawnPrompt).toMatch(/not mint a run/i);
  });
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `pnpm vitest run packages/orchestrator/src/stages/synthesize.test.ts`
Expected: FAIL — `"S1 spawns brain, names the runId, and forbids dispatch"` fails the `/not mint a run/i` match; the other 3 tests pass.

- [ ] **Step 3: Tighten the spawn prompt**

In `packages/orchestrator/src/stages/synthesize.ts`, replace the `spawnPrompt` array (the `[...].join("\n")` block inside `s1Reason.build`):

```typescript
    spawnPrompt: [
      `Run ${run.runId}: you are brain, the strategic reasoner. Run the §B`,
      "9-step reasoning scaffold over the analytics-stage signal below and emit",
      "the §C Decision Memo as your final JSON message.",
      "",
      "Do NOT dispatch any subagent and do NOT call the Task tool — the",
      "orchestrator owns loop sequencing. Reason only; the Memo's",
      "recommendedAngles flow into the brief stage next.",
      "",
      "ANALYTICS SIGNAL:",
      JSON.stringify(analyticsSignal(run), null, 2),
    ].join("\n"),
```

with:

```typescript
    spawnPrompt: [
      `You are brain, the strategic reasoner, for orchestrator run ${run.runId}.`,
      `Use runId "${run.runId}" verbatim — as the Run ID on every Notion write`,
      "(the Decision Memo, every Hypothesis, the Reflect Self-Critique) and as",
      "the runId field of the JSON you return. Do NOT mint a run — you have no",
      "tool to, and the orchestrator already owns this run's identity.",
      "",
      "Run the §B 9-step reasoning scaffold over the analytics-stage signal",
      "below and emit the §C Decision Memo as your final JSON message.",
      "",
      "Do NOT dispatch any subagent and do NOT call the Task tool — the",
      "orchestrator owns loop sequencing. The Memo's recommendedAngles flow",
      "into the brief stage next.",
      "",
      "ANALYTICS SIGNAL:",
      JSON.stringify(analyticsSignal(run), null, 2),
    ].join("\n"),
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm vitest run packages/orchestrator/src/stages/synthesize.test.ts`
Expected: PASS — 4 tests (the new assertion plus the 3 unchanged `toContain` checks, which still hold: the prompt still contains `run_s` and `NOT dispatch`).

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/stages/synthesize.ts packages/orchestrator/src/stages/synthesize.test.ts
git commit -m "fix(orchestrator): synthesize prompt forbids brain minting a run (B-014)"
```

---

## Task 5: B-014 — retire the `new_run` tool + ADR-011 status note

`new_run` has zero runtime callers after Task 3 (verified: a repo-wide grep finds it only in `brain.md`'s old tools line, `index.ts`'s registration, and docs). It is a pure stateless string generator with no DB write — `engine.ts` already mints runIds with the identical formula.

**Files:**
- Modify: `mcp-servers/analytics/src/index.ts` (delete the `new_run` registration, lines ~177-182)
- Modify: `docs/decisions/011-runid-server-side.md`

- [ ] **Step 1: Delete the `new_run` tool registration**

In `mcp-servers/analytics/src/index.ts`, delete this entire block (and the blank line directly above it):

```typescript
server.tool(
  "new_run",
  "Generate a fresh runId from the current server clock. Returns { runId: 'run_<unix_seconds>' }. Always call this to mint a runId instead of computing it from a date string — agent date-math has historically produced off-by-a-year values.",
  {},
  () => toolResult({ runId: `run_${Math.floor(Date.now() / 1000)}` }),
);
```

The file should end with the `engagement_per_angle` registration followed by the transport block:

```typescript
const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Confirm nothing else references `new_run`**

Run: `grep -rn 'new_run' mcp-servers packages --include='*.ts'`
Expected: no matches (the only TypeScript reference was the registration just deleted).

- [ ] **Step 3: Add the ADR-011 status note**

In `docs/decisions/011-runid-server-side.md`, the header reads:

```markdown
# 011 — Server-side runId minting

Status: Accepted
Date: 2026-05-09
Source: TASKS.md Phase 8.8
```

Insert a status-note blockquote directly after the `Source:` line (before `## Context`):

```markdown
# 011 — Server-side runId minting

Status: Accepted
Date: 2026-05-09
Source: TASKS.md Phase 8.8

> **Status note (2026-05-22):** superseded — the orchestrator now mints runIds itself in `packages/orchestrator/src/engine.ts` (`run_<unix_seconds>`, the same formula). The `mcp__analytics__new_run` tool and brain's call to it are retired (B-014); agentic cells receive the runId from the orchestrator's spawn prompt. The principle below — a system-clock value belongs in code, not an agent prompt — still stands.
```

- [ ] **Step 4: Build the analytics package**

Run: `pnpm --filter @engineerdad/analytics build` (or `pnpm -r build`).
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add mcp-servers/analytics/src/index.ts docs/decisions/011-runid-server-side.md
git commit -m "fix(analytics): retire the orphaned new_run tool; ADR-011 status note (B-014)"
```

---

## Task 6: Full regression green

**Files:** none — verification only.

- [ ] **Step 1: Sequential build**

Run: `pnpm -r build`
Expected: all workspace projects build clean. (Sequential — never `pnpm -r --parallel build`; it races on `@engineerdad/shared`.)

- [ ] **Step 2: Full test suite**

Run: `pnpm vitest run`
Expected: all tests pass — the prior 451 plus 3 new (`ingest-meta-insights.test.ts`) and 1 changed (`synthesize.test.ts` gains an assertion, still 4 tests) = 454 passing.

- [ ] **Step 3: Agent sync check**

Run: `pnpm sync:agents:check`
Expected: `0 of 4 agent files updated.`

If any of the three is not green, stop and fix before Task 7.

---

## Task 7: Verification walk + closeout

This task is operator-driven — it needs a Claude Code restart, so it cannot run inside a subagent. Do it in the main session.

- [ ] **Step 1: Restart Claude Code**

Quit and relaunch so the analytics + orchestrator MCP server processes reload the rebuilt `dist/`.

- [ ] **Step 2: Walk a fresh run to HUMAN GATE 1**

Run `/loop-once` and drive the conductor per `.claude/commands/loop.md` through `tracking → analytics → synthesize → brief`.

- [ ] **Step 3: Confirm the acceptance criteria**

- every `verify` call returns `ok: true` with no manual work-around;
- the cold-start path runs clean — an empty `get_insights` no longer blocks A1-ingest (the conductor passes `ingest_meta_insights` an empty `rows` array and it succeeds);
- the Decision Memo, every Hypothesis, and the 12 Briefs all carry the **same** orchestrator-minted runId (the one `plan` returned — not a brain-minted `run_*`);
- the run parks at HG1 with status `awaiting_gate`.

If a new integration defect surfaces past synthesize, file it as a new `B-NNN` in `TASKS.md` — it is a finding, not a failure of this plan.

- [ ] **Step 4: Close out the tracker**

In `TASKS.md`, remove B-011, B-012, B-013, B-014 from `## Open bugs` and update the `## Status` snapshot. In `DONE.md`'s `## Closed bugs/enhancements`, add:

```markdown
- [x] **B-011** /loop conductor — structured `result` stringified at the orchestrator MCP boundary (closed 2026-05-22) — `coerceResult()` JSON-parses a stringified `result` in the `verify`/`advance` handlers; verified end-to-end by the cold-start walk to HG1.
- [x] **B-012** loop.md write-step `$`-capture convention (closed 2026-05-22) — documented the intra-step capture substitution in the conductor procedure.
- [x] **B-013** cold-start ingest (closed 2026-05-22) — `ingest_meta_insights` accepts an empty `rows` array; extracted `IngestMetaInsightsInputSchema` (no `.min(1)`).
- [x] **B-014** brain ↔ orchestrator run-identity (closed 2026-05-22) — brain uses the orchestrator-supplied runId; `new_run` tool retired; ADR-011 status-noted.
```

B-010 stays open in `TASKS.md` — its `/distribute --dry-run` end-to-end path is past HG1 and not exercised by this walk.

- [ ] **Step 5: Commit the closeout**

```bash
git add TASKS.md DONE.md
git commit -m "docs: close out B-011..B-014 — /loop walks cold-start to HG1"
```

---

## Self-review

**Spec coverage:** B-012 → Task 1. B-013 → Task 2. B-014 (brain.md) → Task 3, (synthesize.ts) → Task 4, (retire `new_run` + ADR-011) → Task 5. Verification walk to HG1 → Task 7. Regression green → Task 6. All spec sections covered.

**Placeholder scan:** every code/edit step shows the exact before/after text or the full new file; every command has an expected result. No TBD/TODO.

**Type consistency:** `IngestMetaInsightsInputSchema` is defined in Task 2 Step 3 and consumed in Task 2 Step 5 (`.shape`) and the Task 2 test — same name throughout. The `synthesize` `spawnPrompt` change in Task 4 keeps the substrings (`run_s` via `${run.runId}`, `NOT dispatch`) that synthesize.test.ts's unchanged assertions depend on.

**Scope:** three fixes + verification, one implementation plan. Cosmetic agent staleness and anything past HG1 are explicitly out of scope per the spec.
