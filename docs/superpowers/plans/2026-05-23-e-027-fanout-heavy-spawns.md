# E-027 — Fan out C1 content-writer and P1 creative-director — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the heavy single-spawn `C1-write` and `P1-creative` steps with per-unit worker fanouts so neither stage exhausts a subagent's ~200k context window, unblocking `run_1779446750`.

**Architecture:** A new "read approved units" write step precedes each stage's heavy work, exposing fan-out granularity at plan time. Then a `kind: "fanout"` step dispatches one specialist worker (`content-writer` per Brief; `creative-director` per Script) on a scoped prompt carrying only that unit's data. A verifier folds the per-unit array back into the existing `ContentResult` / `CreativePlan` shape downstream code already consumes — no changes to `deriveSpecs`, `verifyProduce`, P2-render, P3-persist, P4-enrich, P5-confirm, P6-gate.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, Claude Code subagents (`content-writer.md`, `creative-director.md`), the orchestrator `StageDefinition` registry in `packages/orchestrator/src/stages/`.

**Stage-ID migration:** The only blocked run is `run_1779446750` at `produce`/`P1-creative` (failed, not done). Its `content` stage is fully done (advances are recorded by stage-marker, not by re-checking individual step IDs — the engine walks forward from `run.stage`, never back). Renaming `C1-write → C1-fanout` / `P1-creative → P1-fanout` is therefore safe: the engine plans from `produce`, hits the new `P0-scripts` (no done marker → runs), then `P1-fanout` (no done marker → runs), then existing `P2-render` onward. No `oldStepIds` aliasing or state migration needed.

---

## Task 1: Per-unit verifier — split `verifyContent` into unit + aggregator

**Files:**
- Modify: `packages/orchestrator/src/verifiers/verify-content.ts`
- Modify: `packages/orchestrator/src/verifiers/verify-content.test.ts`

The current `verifyContent` validates one `ContentResult` (`{ scripts, hookBanks }`). We need two functions:

- `verifyContentUnit(unit)` — validates **one** worker's output `{ briefId, hooks, scripts, proofRefs, notes }`. Runs the §8 Piliero check on that one Brief's hooks and the per-Brief proof rule (`≥80%`).
- `verifyContent(result)` — folds an array of units into a `ContentResult`, then re-runs the existing checks on the union as defence in depth.

The fanout step's `result` is `unknown[]` (array of unit outputs). When called by the C1-fanout `verify`, `verifyContent` must accept an array; when called by legacy / test paths it must still accept the canonical object. Detect by shape.

- [ ] **Step 1: Write failing per-unit tests**

Append to `packages/orchestrator/src/verifiers/verify-content.test.ts` **before** the existing `describe("verifyContent", ...)` block:

```ts
import { verifyContentUnit } from "./verify-content.js";

/** A valid per-Brief unit — 30 hooks across 6 registers, 5 scripts all with proofRefs. */
function validUnit(briefId = "b1") {
  return {
    briefId,
    hooks: hooks(5),
    scripts: [
      { id: "s1", proofRefs: ["a.md"] },
      { id: "s2", proofRefs: ["b.md"] },
      { id: "s3", proofRefs: ["c.md"] },
      { id: "s4", proofRefs: ["d.md"] },
      { id: "s5", proofRefs: ["e.md"] },
    ],
  };
}

describe("verifyContentUnit", () => {
  it("passes a unit with 30 hooks across 6 registers and ≥80% proof", () => {
    expect(verifyContentUnit(validUnit())).toEqual({ ok: true, problems: [] });
  });

  it("fails a unit missing a register", () => {
    const noFear = hooks(6).filter((h) => h.register !== "fear");
    expect(
      verifyContentUnit({ briefId: "b1", hooks: noFear, scripts: validUnit().scripts }).ok,
    ).toBe(false);
  });

  it("fails a unit with <30 hooks", () => {
    expect(
      verifyContentUnit({ briefId: "b1", hooks: hooks(3), scripts: validUnit().scripts }).ok,
    ).toBe(false);
  });

  it("fails a unit with proofRatio below 0.80", () => {
    const scripts = [
      { id: "s1", proofRefs: ["a.md"] },
      { id: "s2", proofRefs: [] },
      { id: "s3", proofRefs: [] },
      { id: "s4", proofRefs: [] },
      { id: "s5", proofRefs: [] },
    ];
    const result = verifyContentUnit({ briefId: "b1", hooks: hooks(5), scripts });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("proof");
  });

  it("passes a unit with exactly 80% proof", () => {
    const scripts = [
      { id: "s1", proofRefs: ["a.md"] },
      { id: "s2", proofRefs: ["b.md"] },
      { id: "s3", proofRefs: ["c.md"] },
      { id: "s4", proofRefs: ["d.md"] },
      { id: "s5", proofRefs: [] },
    ];
    expect(verifyContentUnit({ briefId: "b1", hooks: hooks(5), scripts })).toEqual({
      ok: true,
      problems: [],
    });
  });

  it("names the offending Brief in unit problems", () => {
    const result = verifyContentUnit({ briefId: "brief-xyz", hooks: hooks(3), scripts: [] });
    expect(result.problems.join(" ")).toContain("brief-xyz");
  });

  it("fails a non-object / null unit", () => {
    expect(verifyContentUnit(null).ok).toBe(false);
    expect(verifyContentUnit("nope").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run unit tests — expect fail**

Run: `pnpm --filter @engineerdad/orchestrator vitest run src/verifiers/verify-content.test.ts`
Expected: every `verifyContentUnit` test fails with "verifyContentUnit is not a function".

- [ ] **Step 3: Refactor `verify-content.ts` — extract per-unit, add aggregator-as-array path**

Replace the current `verifyContent` function (and add `verifyContentUnit`) so the file reads:

```ts
import type { VerifyResult } from "../types.js";

export interface HookEntry {
  en?: unknown;
  ms?: unknown;
  register?: unknown;
}

export interface HookBankEntry {
  briefId?: unknown;
  hooks?: unknown;
}

export interface ContentResult {
  scripts?: unknown;
  hookBanks?: unknown;
  proofRatio?: unknown;
}

export interface ContentUnit {
  briefId?: unknown;
  hooks?: unknown;
  scripts?: unknown;
}

const REQUIRED_REGISTERS = [
  "fear",
  "aspiration",
  "curiosity",
  "proof",
  "contrarian",
  "identity",
] as const;

const MIN_HOOKS = 30;
const MIN_PER_REGISTER = 3;
const MIN_PROOF_RATIO = 0.8;

function verifyHookBank(bank: unknown, label: string, problems: string[]): void {
  if (bank === null || typeof bank !== "object") {
    problems.push(`${label} is not a hook-bank object`);
    return;
  }
  const hooks = (bank as HookBankEntry).hooks;
  if (!Array.isArray(hooks)) {
    problems.push(`${label} has no hooks array`);
    return;
  }

  const counts: Record<string, number> = {};
  for (const hook of hooks) {
    if (hook !== null && typeof hook === "object") {
      const register = (hook as HookEntry).register;
      if (typeof register === "string") counts[register] = (counts[register] ?? 0) + 1;
    }
  }
  const countOf = (r: string): number => counts[r] ?? 0;

  const missing = REQUIRED_REGISTERS.filter((r) => countOf(r) <= 0);
  if (missing.length > 0) {
    problems.push(`${label} hook bank missing register(s): ${missing.join(", ")}`);
  }

  const thin = REQUIRED_REGISTERS.filter((r) => {
    const c = countOf(r);
    return c > 0 && c < MIN_PER_REGISTER;
  });
  if (thin.length > 0) {
    problems.push(
      `${label} hook bank has register(s) below ${MIN_PER_REGISTER} hooks: ` +
        thin.map((r) => `${r} (${countOf(r)})`).join(", "),
    );
  }

  if (hooks.length < MIN_HOOKS) {
    problems.push(
      `${label} hook bank has ${hooks.length} hooks — below the ${MIN_HOOKS}-hook minimum (§8 Piliero rule)`,
    );
  }
}

function proofRatioOf(scripts: unknown): { withProof: number; total: number; ratio: number } {
  if (!Array.isArray(scripts) || scripts.length === 0) return { withProof: 0, total: 0, ratio: 1 };
  let withProof = 0;
  for (const s of scripts) {
    if (s !== null && typeof s === "object") {
      const refs = (s as { proofRefs?: unknown }).proofRefs;
      if (Array.isArray(refs) && refs.length > 0) withProof++;
    }
  }
  return { withProof, total: scripts.length, ratio: withProof / scripts.length };
}

/** Validate one C1-fanout worker's output (one Brief). */
export function verifyContentUnit(unit: unknown): VerifyResult {
  if (unit === null || typeof unit !== "object") {
    return { ok: false, problems: ["content unit is not an object"] };
  }
  const { briefId, scripts } = unit as ContentUnit;
  const label = typeof briefId === "string" ? `Brief ${briefId}` : "unit";
  const problems: string[] = [];

  verifyHookBank(unit, label, problems);

  if (!Array.isArray(scripts) || scripts.length === 0) {
    problems.push(`${label} authored no scripts`);
  } else {
    const { ratio, withProof, total } = proofRatioOf(scripts);
    if (ratio < MIN_PROOF_RATIO) {
      problems.push(
        `${label} proof ratio ${withProof}/${total} = ${ratio.toFixed(2)} — below the ${MIN_PROOF_RATIO} per-Brief minimum`,
      );
    }
  }

  return problems.length === 0 ? { ok: true, problems: [] } : { ok: false, problems };
}

/**
 * The content-stage acceptance test. Accepts either:
 *   • a canonical ContentResult { scripts, hookBanks } (legacy / single-spawn path), or
 *   • an array of per-unit outputs from a C1-fanout — folded then re-validated.
 */
export function verifyContent(result: unknown): VerifyResult {
  if (Array.isArray(result)) return verifyContentArray(result);

  if (result === null || typeof result !== "object") {
    return { ok: false, problems: ["content-writer produced no result"] };
  }
  const { scripts, hookBanks } = result as ContentResult;
  const problems: string[] = [];

  if (!Array.isArray(scripts) || scripts.length === 0) {
    problems.push("content-writer authored no scripts");
  }

  if (!Array.isArray(hookBanks) || hookBanks.length === 0) {
    problems.push("content-writer emitted no hook banks");
  } else {
    hookBanks.forEach((bank, i) => {
      const briefId =
        bank !== null && typeof bank === "object"
          ? (bank as HookBankEntry).briefId
          : undefined;
      const label = typeof briefId === "string" ? `Brief ${briefId}` : `hook bank #${i + 1}`;
      verifyHookBank(bank, label, problems);
    });
  }

  return problems.length === 0 ? { ok: true, problems: [] } : { ok: false, problems };
}

function verifyContentArray(units: unknown[]): VerifyResult {
  if (units.length === 0) {
    return { ok: false, problems: ["C1-fanout produced no per-Brief units"] };
  }
  const problems: string[] = [];
  const allScripts: unknown[] = [];
  for (const u of units) {
    const r = verifyContentUnit(u);
    if (!r.ok) problems.push(...r.problems);
    if (u !== null && typeof u === "object") {
      const scripts = (u as ContentUnit).scripts;
      if (Array.isArray(scripts)) allScripts.push(...scripts);
    }
  }
  // Defence in depth: re-check union proof ratio.
  const { ratio, withProof, total } = proofRatioOf(allScripts);
  if (total > 0 && ratio < MIN_PROOF_RATIO) {
    problems.push(
      `union proof ratio ${withProof}/${total} = ${ratio.toFixed(2)} — below ${MIN_PROOF_RATIO}`,
    );
  }
  return problems.length === 0 ? { ok: true, problems: [] } : { ok: false, problems };
}

/** Fold a C1-fanout's per-unit array into a ContentResult for downstream stepResult readers. */
export function foldContentUnits(units: unknown[]): ContentResult {
  const scripts: unknown[] = [];
  const hookBanks: { briefId: unknown; hooks: unknown }[] = [];
  for (const u of units) {
    if (u === null || typeof u !== "object") continue;
    const unit = u as ContentUnit;
    if (Array.isArray(unit.scripts)) scripts.push(...unit.scripts);
    if (Array.isArray(unit.hooks)) hookBanks.push({ briefId: unit.briefId, hooks: unit.hooks });
  }
  const { ratio } = proofRatioOf(scripts);
  return { scripts, hookBanks, proofRatio: ratio };
}
```

- [ ] **Step 4: Run unit tests — expect pass**

Run: `pnpm --filter @engineerdad/orchestrator vitest run src/verifiers/verify-content.test.ts`
Expected: every test green (existing `verifyContent` cases + the new `verifyContentUnit` cases).

- [ ] **Step 5: Add aggregator + fold tests**

Append to `packages/orchestrator/src/verifiers/verify-content.test.ts`:

```ts
import { foldContentUnits } from "./verify-content.js";

describe("verifyContent — array (C1-fanout) path", () => {
  it("passes an array of valid per-Brief units", () => {
    expect(verifyContent([validUnit("b1"), validUnit("b2"), validUnit("b3")])).toEqual({
      ok: true,
      problems: [],
    });
  });

  it("fails an empty array", () => {
    const r = verifyContent([]);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("no per-Brief units");
  });

  it("surfaces the first failing unit even if the union proof ratio is ≥0.80", () => {
    const good = validUnit("b1"); // 5/5 proof
    const bad = {
      briefId: "b2",
      hooks: hooks(5),
      scripts: [
        { id: "s1", proofRefs: ["a.md"] },
        { id: "s2", proofRefs: [] },
        { id: "s3", proofRefs: [] },
        { id: "s4", proofRefs: [] },
        { id: "s5", proofRefs: [] },
      ],
    };
    // Union = 6 with proof / 10 total = 0.60 — but even if union were ≥0.80,
    // the per-Brief check on b2 must surface.
    const r = verifyContent([good, bad]);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toContain("b2");
  });
});

describe("foldContentUnits", () => {
  it("flattens scripts and emits one hookBanks entry per unit", () => {
    const folded = foldContentUnits([validUnit("b1"), validUnit("b2")]);
    expect(folded.scripts).toHaveLength(10);
    expect(folded.hookBanks).toEqual([
      { briefId: "b1", hooks: validUnit("b1").hooks },
      { briefId: "b2", hooks: validUnit("b2").hooks },
    ]);
  });

  it("recomputes proofRatio across the union", () => {
    const folded = foldContentUnits([validUnit("b1"), validUnit("b2")]);
    expect(folded.proofRatio).toBeCloseTo(1.0);
  });

  it("ignores non-object units", () => {
    const folded = foldContentUnits([null, validUnit("b1")]);
    expect(folded.hookBanks).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run all verifier tests — expect pass**

Run: `pnpm --filter @engineerdad/orchestrator vitest run src/verifiers/verify-content.test.ts`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator/src/verifiers/verify-content.ts \
        packages/orchestrator/src/verifiers/verify-content.test.ts
git commit -m "feat(verify-content): split into verifyContentUnit + aggregator + foldContentUnits

E-027 — preparation for C1-fanout. Per-unit checker enforces §8 Piliero
and the per-Brief 80% proof rule; aggregator folds a per-unit array into
a ContentResult and re-runs the union proof check as defence in depth."
```

---

## Task 2: Content stage — `C0-briefs → C1-fanout → C2-articles → C3-gate`

**Files:**
- Modify: `packages/orchestrator/src/stages/content.ts`
- Modify: `packages/orchestrator/src/stages/content.test.ts`

The single `C1-write` spawn becomes a write step that pulls approved Briefs, a fanout that dispatches one `content-writer` per Brief, a small spawn for the cross-Brief articles, then the gate.

- [ ] **Step 1: Write the failing stage-shape tests**

Replace `packages/orchestrator/src/stages/content.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { contentStage } from "./content.js";
import type { RunState, RunStepState } from "../types.js";

function runWith(steps: RunStepState[] = []): RunState {
  return { runId: "run_c", stage: "content", status: "active", params: {}, steps };
}

function doneStep(stepId: string, result: unknown): RunStepState {
  return { stepId, stage: "content", status: "done", result, problems: [], attempts: 1 };
}

const REGISTERS = ["fear", "aspiration", "curiosity", "proof", "contrarian", "identity"] as const;
function hooks(n: number) {
  return REGISTERS.flatMap((register) =>
    Array.from({ length: n }, (_, i) => ({ en: `en ${register} ${i}`, ms: `ms ${register} ${i}`, register })),
  );
}
function validUnit(briefId: string) {
  return {
    briefId,
    hooks: hooks(5),
    scripts: [
      { id: `${briefId}-s1`, proofRefs: ["a.md"] },
      { id: `${briefId}-s2`, proofRefs: ["b.md"] },
      { id: `${briefId}-s3`, proofRefs: ["c.md"] },
      { id: `${briefId}-s4`, proofRefs: ["d.md"] },
      { id: `${briefId}-s5`, proofRefs: ["e.md"] },
    ],
  };
}

describe("contentStage", () => {
  it("has C0-briefs → C1-fanout → C2-articles → C3-gate", () => {
    expect(contentStage.id).toBe("content");
    expect(contentStage.steps.map((s) => s.id)).toEqual([
      "C0-briefs",
      "C1-fanout",
      "C2-articles",
      "C3-gate",
    ]);
    expect(contentStage.steps.map((s) => s.kind)).toEqual(["write", "fanout", "spawn", "gate"]);
  });

  it("C0-briefs queries approved Briefs for this run", () => {
    const step = contentStage.steps[0]!.build(runWith());
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(1);
    expect(step.calls[0]!.tool).toBe("mcp__notion__query");
    const args = step.calls[0]!.args as { db: string; filter: unknown };
    expect(args.db).toBe("Briefs");
    expect(JSON.stringify(args.filter)).toContain("run_c");
    expect(JSON.stringify(args.filter)).toContain("Approved");
  });

  it("C1-fanout dispatches one content-writer per approved Brief", () => {
    const briefsResult = {
      results: [
        { id: "brief-1", properties: { Persona: { select: { name: "young_parents_25_35" } } } },
        { id: "brief-2", properties: { Persona: { select: { name: "engineer_dads" } } } },
      ],
    };
    const run = runWith([doneStep("C0-briefs", [briefsResult])]);
    const step = contentStage.steps[1]!.build(run);
    if (step.kind !== "fanout") throw new Error("expected fanout");
    expect(step.worker).toBe("content-writer");
    expect(step.units).toHaveLength(2);
    expect(step.units[0]!.spawnPrompt).toContain("brief-1");
    expect(step.units[1]!.spawnPrompt).toContain("brief-2");
    expect(step.units[0]!.spawnPrompt).toContain("Single-Brief worker mode");
  });

  it("C1-fanout throws if C0-briefs returned no Briefs", () => {
    const run = runWith([doneStep("C0-briefs", [{ results: [] }])]);
    expect(() => contentStage.steps[1]!.build(run)).toThrow(/no approved Briefs/);
  });

  it("C1-fanout.verify accepts an array of valid per-Brief units", () => {
    const spec = contentStage.steps[1]!;
    const goodArray = [validUnit("b1"), validUnit("b2")];
    expect(spec.verify!(runWith(), goodArray).ok).toBe(true);
    expect(spec.verify!(runWith(), []).ok).toBe(false);
  });

  it("C2-articles spawns content-writer in article mode", () => {
    const briefsResult = {
      results: [
        { id: "brief-1", properties: { Topic: { rich_text: [{ plain_text: "Education" }] } } },
      ],
    };
    const run = runWith([
      doneStep("C0-briefs", [briefsResult]),
      doneStep("C1-fanout", [validUnit("brief-1")]),
    ]);
    const step = contentStage.steps[2]!.build(run);
    if (step.kind !== "spawn") throw new Error("expected spawn");
    expect(step.agent).toBe("content-writer");
    expect(step.spawnPrompt).toContain("Article mode");
    expect(step.spawnPrompt).toContain("run_c");
  });

  it("C3-gate is HG2 with a Scripts-approved check", () => {
    const step = contentStage.steps[3]!.build(runWith());
    if (step.kind !== "gate") throw new Error("expected gate");
    expect(step.gate).toBe("HG2");
    expect(step.check?.tool).toBe("mcp__notion__query");
  });

  it("C3.verify clears the gate only when an approved Script exists", () => {
    const gate = contentStage.steps[3]!;
    expect(gate.verify!(runWith(), { results: [{ id: "sc1" }] }).ok).toBe(true);
    expect(gate.verify!(runWith(), { results: [] }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run stage tests — expect fail**

Run: `pnpm --filter @engineerdad/orchestrator vitest run src/stages/content.test.ts`
Expected: every test fails (step IDs don't match yet).

- [ ] **Step 3: Rewrite `content.ts`**

Replace `packages/orchestrator/src/stages/content.ts` with:

```ts
import type { RunState, StageDefinition, Step, StepSpec, VerifyResult } from "../types.js";
import { verifyContent } from "../verifiers/verify-content.js";

/**
 * The content stage — replaces the Phase-6 single content-writer spawn with a
 * per-Brief fanout (E-027). C0-briefs reads the run's approved Briefs;
 * C1-fanout dispatches one content-writer worker per Brief (Single-Brief
 * worker mode); C2-articles authors the cross-Brief AEO/GEO articles in a
 * single light spawn; C3-gate is HG2.
 */

function rowsOf(callResult: unknown): unknown[] {
  if (Array.isArray(callResult)) return callResult;
  if (callResult !== null && typeof callResult === "object" && "results" in callResult) {
    const r = (callResult as { results: unknown }).results;
    return Array.isArray(r) ? r : [];
  }
  return [];
}

function notionEquals(prop: string, value: string) {
  return { property: prop, rich_text: { equals: value } };
}

const APPROVED = { property: "Approval Status", select: { equals: "Approved" } };

function stepResult<T>(run: RunState, stepId: string): T | undefined {
  return run.steps.find((s) => s.stepId === stepId)?.result as T | undefined;
}

/** Extract the Briefs array from C0-briefs' write-step result (an array of call results). */
function briefsOf(run: RunState): unknown[] {
  const c0 = stepResult<unknown[]>(run, "C0-briefs");
  if (!Array.isArray(c0) || c0.length === 0) return [];
  return rowsOf(c0[0]);
}

// ── C0-briefs ────────────────────────────────────────────────────────────

const c0Briefs: StepSpec = {
  id: "C0-briefs",
  kind: "write",
  build: (run): Step => ({
    kind: "write",
    stepId: "C0-briefs",
    calls: [
      {
        tool: "mcp__notion__query",
        args: {
          db: "Briefs",
          filter: { and: [notionEquals("Run ID", run.runId), APPROVED] },
        },
      },
    ],
  }),
  verify: (_run, result): VerifyResult => {
    const arr = Array.isArray(result) ? result : [];
    return rowsOf(arr[0]).length > 0
      ? { ok: true, problems: [] }
      : { ok: false, problems: ["C0-briefs returned no approved Briefs for this run"] };
  },
};

// ── C1-fanout ────────────────────────────────────────────────────────────

function briefIdOf(brief: unknown): string {
  if (brief !== null && typeof brief === "object") {
    const id = (brief as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return "";
}

const c1Fanout: StepSpec = {
  id: "C1-fanout",
  kind: "fanout",
  build: (run): Step => {
    const briefs = briefsOf(run);
    if (briefs.length === 0) {
      throw new Error(
        "C1-fanout: no approved Briefs in the C0-briefs result — cannot dispatch content-writer workers",
      );
    }
    return {
      kind: "fanout",
      stepId: "C1-fanout",
      worker: "content-writer",
      units: briefs.map((brief) => ({
        spawnPrompt: [
          `Run ${run.runId}: you are content-writer in Single-Brief worker mode.`,
          "Operate on EXACTLY ONE Brief — the one carried in the BRIEF JSON below.",
          "Do NOT query Notion for the Briefs DB. Produce ≥30 bilingual hooks",
          "across all six emotional registers (≥3 each), ≥3 scripts permuted",
          "from your hook bank × value bank, and write only the Scripts to Notion",
          "(no hook-bank column). Enforce proofRatio ≥ 0.80 on YOUR scripts.",
          "Return your unit JSON { briefId, hooks, scripts, proofRefs?, notes? }.",
          "",
          `BRIEF id=${briefIdOf(brief)}:`,
          JSON.stringify(brief),
        ].join("\n"),
      })),
    };
  },
  verify: (_run, result): VerifyResult => verifyContent(result),
};

// ── C2-articles ──────────────────────────────────────────────────────────

const c2Articles: StepSpec = {
  id: "C2-articles",
  kind: "spawn",
  build: (run): Step => {
    const briefs = briefsOf(run);
    return {
      kind: "spawn",
      stepId: "C2-articles",
      agent: "content-writer",
      spawnPrompt: [
        `Run ${run.runId}: you are content-writer in Article mode.`,
        "Identify 1–2 cross-Brief AEO/GEO themes from the BRIEFS JSON below and",
        "author one bilingual authority article per theme (800–1500 words, markdown",
        "body + FAQ block + citations). Write each to AuthorityArticles. Do NOT",
        "produce hooks or Scripts — those are owned by C1-fanout workers.",
        "Return { articles: [...], notes?: [...] }.",
        "",
        "BRIEFS:",
        JSON.stringify(briefs),
      ].join("\n"),
    };
  },
};

// ── C3-gate ──────────────────────────────────────────────────────────────

const c3Gate: StepSpec = {
  id: "C3-gate",
  kind: "gate",
  build: (run): Step => ({
    kind: "gate",
    stepId: "C3-gate",
    gate: "HG2",
    message:
      "Scripts and articles authored. Awaiting HUMAN GATE 2 — review the " +
      "content in Notion, then approve to proceed to produce.",
    check: {
      tool: "mcp__notion__query",
      args: {
        db: "Scripts",
        filter: { and: [notionEquals("Run ID", run.runId), APPROVED] },
      },
    },
  }),
  verify: (_run, result): VerifyResult =>
    rowsOf(result).length > 0
      ? { ok: true, problems: [] }
      : { ok: false, problems: ["HG2 not cleared — no approved Scripts for this run"] },
};

export const contentStage: StageDefinition = {
  id: "content",
  steps: [c0Briefs, c1Fanout, c2Articles, c3Gate],
};
```

- [ ] **Step 4: Run stage tests — expect pass**

Run: `pnpm --filter @engineerdad/orchestrator vitest run src/stages/content.test.ts`
Expected: all green.

- [ ] **Step 5: Run full orchestrator suite — no regressions**

Run: `pnpm --filter @engineerdad/orchestrator vitest run`
Expected: all green. If any test outside `content.test.ts` / `verify-content.test.ts` fails, it depended on the old C1-write step ID — fix it by updating to the new IDs.

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/stages/content.ts \
        packages/orchestrator/src/stages/content.test.ts
git commit -m "feat(content): fan out C1 into per-Brief workers + dedicated article spawn

E-027 — replaces the single content-writer spawn that exhausted its
context window. C0-briefs reads approved Briefs; C1-fanout dispatches
one content-writer per Brief (Single-Brief worker mode); C2-articles
authors the 1–2 cross-Brief AEO/GEO articles; C3-gate is HG2."
```

---

## Task 3: Produce stage — `P0-scripts → P1-fanout` (P2–P6 unchanged)

**Files:**
- Modify: `packages/orchestrator/src/stages/produce.ts`
- Modify: `packages/orchestrator/src/stages/produce.test.ts`

Insert a new `P0-scripts` write step that queries the run's approved Scripts (the orchestrator now owns this query, not the agent); replace the single `P1-creative` spawn with `P1-fanout` that dispatches one `creative-director` worker per Script with that Script's parent Brief's hook bank already injected.

- [ ] **Step 1: Write failing tests for the new shape**

Append to `packages/orchestrator/src/stages/produce.test.ts` (keep all existing tests; just update the ones referencing `P1-creative` to use `P1-fanout` and read the new step list):

Look for the test asserting the existing step IDs (likely a `produceStage.steps.map((s) => s.id)` assertion). Update it to:

```ts
it("has P0-scripts → P1-fanout → P2-render → P3-persist → P4-enrich → P5-confirm → P6-gate", () => {
  expect(produceStage.steps.map((s) => s.id)).toEqual([
    "P0-scripts",
    "P1-fanout",
    "P2-render",
    "P3-persist",
    "P4-enrich",
    "P5-confirm",
    "P6-gate",
  ]);
});
```

Add new tests:

```ts
describe("produceStage — P0-scripts + P1-fanout (E-027)", () => {
  it("P0-scripts queries approved Scripts for the run", () => {
    const run = runWith([]);
    const step = produceStage.steps[0]!.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls[0]!.tool).toBe("mcp__notion__query");
    const args = step.calls[0]!.args as { db: string; filter: unknown };
    expect(args.db).toBe("Scripts");
    expect(JSON.stringify(args.filter)).toContain("run_p");
  });

  it("P1-fanout dispatches one creative-director per approved Script with that Script's Brief hook bank", () => {
    const scriptsResult = {
      results: [
        { id: "script-1", properties: { Brief: { relation: [{ id: "brief-1" }] } } },
        { id: "script-2", properties: { Brief: { relation: [{ id: "brief-1" }] } } },
      ],
    };
    const hookBanks = [
      { briefId: "brief-1", hooks: [{ en: "h", ms: "h", register: "curiosity" }] },
    ];
    const run = runWith([
      { stepId: "C1-fanout", stage: "content", status: "done",
        result: [{ briefId: "brief-1", hooks: hookBanks[0]!.hooks, scripts: [] }],
        problems: [], attempts: 1 },
      doneStep("P0-scripts", [scriptsResult]),
    ]);
    const step = produceStage.steps[1]!.build(run);
    if (step.kind !== "fanout") throw new Error("expected fanout");
    expect(step.worker).toBe("creative-director");
    expect(step.units).toHaveLength(2);
    expect(step.units[0]!.spawnPrompt).toContain("script-1");
    expect(step.units[0]!.spawnPrompt).toContain("brief-1");
    expect(step.units[0]!.spawnPrompt).toContain("Single-Script worker mode");
    expect(step.units[0]!.spawnPrompt).toContain("curiosity");
  });

  it("P1-fanout throws if P0-scripts returned no Scripts", () => {
    const run = runWith([
      { stepId: "C1-fanout", stage: "content", status: "done",
        result: [{ briefId: "brief-1", hooks: [], scripts: [] }],
        problems: [], attempts: 1 },
      doneStep("P0-scripts", [{ results: [] }]),
    ]);
    expect(() => produceStage.steps[1]!.build(run)).toThrow(/no approved Scripts/);
  });

  it("P1-fanout still surfaces the unit array as the CreativePlan source for P2-render", () => {
    // P2-render's build reads stepResult<CreativePlan>(run, "P1-fanout"). After
    // the fanout completes, the result is an array; the produce stage exposes
    // a foldCreativePlan(units) helper so P2 sees a flat plan.
    // (This is exercised in the engine integration test below.)
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run produce tests — expect fail**

Run: `pnpm --filter @engineerdad/orchestrator vitest run src/stages/produce.test.ts`
Expected: the new tests fail (step IDs / shape don't match yet); pre-existing tests referencing `P1-creative` also fail until the rename is applied.

- [ ] **Step 3: Rewrite the P0/P1 section of `produce.ts`**

Open `packages/orchestrator/src/stages/produce.ts`. Make these edits in order:

(a) Add a `foldCreativePlan` helper near the top of the file (after `STATIC_FORMATS`):

```ts
import type { CreativePlan, CreativeUnit } from "@engineerdad/shared/derive";

/** Fold a P1-fanout's per-Script unit array into a flat CreativePlan. */
function foldCreativePlan(runId: string, units: unknown): CreativePlan {
  const creatives: CreativeUnit[] = [];
  if (Array.isArray(units)) {
    for (const u of units) {
      if (u !== null && typeof u === "object") {
        const c = (u as { creatives?: unknown }).creatives;
        if (Array.isArray(c)) creatives.push(...(c as CreativeUnit[]));
      }
    }
  }
  return { runId, creatives };
}
```

(b) Add a `briefIdForScript` helper that reads the Brief relation:

```ts
function briefIdForScript(script: unknown): string {
  if (script === null || typeof script !== "object") return "";
  const props = (script as { properties?: unknown }).properties;
  if (props === null || typeof props !== "object") return "";
  const brief = (props as Record<string, unknown>)["Brief"];
  if (brief === null || typeof brief !== "object") return "";
  const rel = (brief as { relation?: unknown }).relation;
  if (!Array.isArray(rel) || rel.length === 0) return "";
  const id = (rel[0] as { id?: unknown }).id;
  return typeof id === "string" ? id : "";
}

function scriptId(script: unknown): string {
  if (script !== null && typeof script === "object") {
    const id = (script as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return "";
}
```

(c) Insert a `p0Scripts` step **before** the current `p1Creative`:

```ts
const p0Scripts: StepSpec = {
  id: "P0-scripts",
  kind: "write",
  build: (run): Step => ({
    kind: "write",
    stepId: "P0-scripts",
    calls: [
      {
        tool: "mcp__notion__query",
        args: {
          db: "Scripts",
          filter: { and: [notionEquals("Run ID", run.runId), APPROVED] },
          filter_properties: [
            "Script EN",
            "Script BM",
            "CTA EN",
            "CTA BM",
            "Duration (sec)",
            "Funnel Stage",
            "Hook EN",
            "Hook BM",
            "Brief",
          ],
        },
      },
    ],
  }),
  verify: (_run, result): VerifyResult => {
    const arr = Array.isArray(result) ? result : [];
    return rowsOf(arr[0]).length > 0
      ? { ok: true, problems: [] }
      : { ok: false, problems: ["P0-scripts returned no approved Scripts for this run"] };
  },
};
```

(d) Replace the `p1Creative` definition with `p1Fanout`:

```ts
const p1Fanout: StepSpec = {
  id: "P1-fanout",
  kind: "fanout",
  build: (run): Step => {
    const content = stepResult<unknown>(run, "C1-fanout");
    const banks =
      Array.isArray(content)
        ? (content as { briefId: string; hooks: unknown }[]).map((u) => ({
            briefId: u.briefId,
            hooks: u.hooks,
          }))
        : [];
    if (banks.length === 0) {
      throw new Error(
        "P1-fanout: C1-fanout produced no hook banks — cannot dispatch creative-director workers",
      );
    }

    const p0 = stepResult<unknown[]>(run, "P0-scripts");
    const scripts = Array.isArray(p0) ? rowsOf(p0[0]) : [];
    if (scripts.length === 0) {
      throw new Error(
        "P1-fanout: P0-scripts returned no approved Scripts — cannot dispatch creative-director workers",
      );
    }

    const bankFor = (briefId: string): unknown =>
      banks.find((b) => b.briefId === briefId)?.hooks ?? [];

    return {
      kind: "fanout",
      stepId: "P1-fanout",
      worker: "creative-director",
      units: scripts.map((script) => {
        const sid = scriptId(script);
        const bid = briefIdForScript(script);
        return {
          spawnPrompt: [
            `Run ${run.runId}: you are creative-director in Single-Script worker mode.`,
            "Operate on EXACTLY ONE Script — the one carried in SCRIPT below.",
            "Produce exactly 4 distinct CreativeUnits for it (Reel, Feed, YT-Long,",
            "Carousel), rotating 4 distinct hooks across emotional registers from",
            "the HOOK BANK below. Do NOT query Notion. Return",
            "{ scriptId, creatives: [4 units] } as your final JSON.",
            "",
            `SCRIPT id=${sid} briefId=${bid}:`,
            JSON.stringify(script),
            "",
            `HOOK BANK for brief ${bid}:`,
            JSON.stringify(bankFor(bid)),
          ].join("\n"),
        };
      }),
    };
  },
};
```

(e) Update `p2Render`, `p3Persist`, `p5Confirm`, and any other step that read `stepResult<CreativePlan>(run, "P1-creative")` to read from `"P1-fanout"` and fold first. Pattern:

```ts
// OLD
const plan = stepResult<CreativePlan>(run, "P1-creative");
// NEW
const plan = foldCreativePlan(run.runId, stepResult<unknown>(run, "P1-fanout"));
```

Apply this substitution in `p2Render.build`, `p3Persist.build`, and `p5Confirm.verify`. After the change, `plan` is always a fully-realised `CreativePlan` (possibly with an empty `creatives` if upstream hasn't run), so the `?? []` guards already in place still work.

(f) Replace the `export const produceStage` definition's `steps` array:

```ts
export const produceStage: StageDefinition = {
  id: "produce",
  steps: [p0Scripts, p1Fanout, p2Render, p3Persist, p4Enrich, p5Confirm, p6Gate],
};
```

- [ ] **Step 4: Run produce tests — expect pass**

Run: `pnpm --filter @engineerdad/orchestrator vitest run src/stages/produce.test.ts`
Expected: all green.

- [ ] **Step 5: Run the orchestrator suite — no regressions**

Run: `pnpm --filter @engineerdad/orchestrator vitest run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/stages/produce.ts \
        packages/orchestrator/src/stages/produce.test.ts
git commit -m "feat(produce): fan out P1 into per-Script creative-director workers

E-027 — replaces the single creative-director spawn that exhausted its
context. P0-scripts queries the run's approved Scripts; P1-fanout
dispatches one creative-director per Script (Single-Script worker mode)
with that Script's Brief hook bank injected. foldCreativePlan unions
per-Script units into the flat CreativePlan that P2–P5 already consume."
```

---

## Task 4: Agent prompts — add Single-Brief / Single-Script worker mode sections

**Files:**
- Modify: `.claude/agents/content-writer.md`
- Modify: `.claude/agents/creative-director.md`
- Modify: `packages/shared/src/prompts/` (if any fragment is shared — likely none)

The agents stay specialists; we add a worker-mode section that overrides Steps 3 (read Briefs / read Scripts) and trims batch-level validation when the orchestrator drove a single-unit prompt.

- [ ] **Step 1: Add Single-Brief worker mode to `content-writer.md`**

After Step 3 (or at the top of the "Hard rules" section — wherever fits the existing structure), insert:

````markdown
## Worker mode (E-027) — Single-Brief

If the spawn prompt begins with "you are content-writer in Single-Brief worker
mode" and carries a `BRIEF` JSON block, **do NOT query the Briefs DB**. Use the
Brief data in the prompt verbatim. Produce the §8 outputs for that ONE Brief
only:

- ≥30 bilingual hooks across all six registers (≥3 each) — return them in the
  `hooks` array of your final JSON.
- ≥3 scripts permuted from your hook bank × your value bank. Write each Script
  to Notion (`mcp__notion__create_page` to `Scripts`) with the Brief relation
  set correctly.
- Enforce `proofRatio ≥ 0.80` on YOUR scripts; if you cannot satisfy it, fix
  before returning.

**Do not produce Authority Articles in this mode** — those are owned by the
C2-articles spawn (Article mode below).

Return shape (strict):

```json
{
  "briefId": "<the BRIEF id from the prompt>",
  "hooks": [{ "en": "…", "ms": "…", "register": "fear" }],
  "scripts": [{ "id": "<notion page_id>", "proofRefs": ["…"] }],
  "notes": ["…"]
}
```

## Worker mode (E-027) — Article

If the spawn prompt begins with "you are content-writer in Article mode" and
carries a `BRIEFS` JSON array, author 1–2 bilingual AEO/GEO authority articles
spanning multiple Briefs. **Do NOT produce hooks or Scripts** — those are
owned by C1-fanout workers.

Return:

```json
{ "articles": [{ "id": "…", "topic": "…", "targetQuery": "…" }], "notes": [] }
```
````

- [ ] **Step 2: Add Single-Script worker mode to `creative-director.md`**

Insert before the `## Hard rules` section:

````markdown
## Worker mode (E-027) — Single-Script

If the spawn prompt begins with "you are creative-director in Single-Script
worker mode" and carries a `SCRIPT` JSON block + `HOOK BANK` JSON array, **do
NOT query the Scripts DB**. Use the Script data and the hook bank verbatim.
Produce exactly 4 `CreativeUnit`s for that ONE Script (Reel, Feed, YT-Long,
Carousel), rotating 4 distinct hooks across emotional registers.

Return shape (strict):

```json
{
  "scriptId": "<the SCRIPT id from the prompt>",
  "creatives": [
    { "scriptId": "…", "format": "Reel", "hook": { "en": "…", "ms": "…", "register": "curiosity" }, "shotlistEn": [...], "shotlistBm": [...], "thumbnailBrief": "…", "paletteEmphasis": "calm", "estCostMyr": 350, "source": {…} }
  ]
}
```

The orchestrator aggregates per-Script outputs into the canonical
`CreativePlan` — you do not produce the `runId` or the top-level plan shape.
````

- [ ] **Step 3: Sync agent prompts**

Run: `pnpm sync:agents`
Expected: no error; if the script reports drift in unrelated files, revert them — only the two `.claude/agents/*.md` files should change.

- [ ] **Step 4: Verify the sync check**

Run: `pnpm sync:agents:check`
Expected: PASS (no drift).

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/content-writer.md .claude/agents/creative-director.md
git commit -m "feat(agents): add Single-Brief/Single-Script worker modes for E-027 fanouts

content-writer gains a Single-Brief mode (one Brief from the prompt, no DB
query, no batch validation, no articles) and an Article mode (cross-Brief
articles only). creative-director gains a Single-Script mode (one Script
from the prompt, hook bank from the prompt, no DB query, returns
{ scriptId, creatives } not a full CreativePlan)."
```

---

## Task 5: Full build + test sweep

- [ ] **Step 1: Build sequentially (never parallel — see README §Resuming)**

Run: `pnpm -r build`
Expected: every package builds.

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: all green. Count must be ≥459 (we added tests, none removed).

- [ ] **Step 3: Agent sync gate**

Run: `pnpm sync:agents:check`
Expected: PASS.

- [ ] **Step 4: Smoke `plan()` for `run_1779446750`**

Run a one-off vitest-style scratch (or REPL via `pnpm tsx`):

```ts
import { plan } from "./packages/orchestrator/dist/engine.js";
import { defaultRegistry } from "./packages/orchestrator/dist/registry.js";
const { step } = plan("run_1779446750", defaultRegistry);
console.log(step);
```

Expected: `step.kind === "write"` and `step.stepId === "P0-scripts"` — confirms the migration: the blocked run picks up the new shape from `produce`.

If instead it returns a step from the `content` stage, the run's persisted `stage` field is somehow not `produce` — stop and inspect `data/engineerdad.sqlite` before continuing.

- [ ] **Step 5: Commit a checkpoint if Step 4 surprised you**

If Step 4 produced unexpected output, document it in the commit — do not paper over it.

```bash
git add -A
git commit -m "chore(e-027): verify plan() walks run_1779446750 onto P0-scripts"
```

---

## Task 6: Update TASKS.md / DONE.md

**Files:**
- Modify: `TASKS.md`
- Modify: `DONE.md`

- [ ] **Step 1: Move E-027 to DONE.md**

Cut the E-027 block (currently in TASKS.md around line 155) and paste it under the most recent v1.5 section in `DONE.md`, prepending a short closer:

```markdown
### E-027 `v1.5` `P0` `agent` — fan out the heavy single-spawn agents — SHIPPED 2026-05-23

Replaced the single `content-writer` and `creative-director` spawns with per-unit
fanouts. New stage shapes:
- content: `C0-briefs → C1-fanout → C2-articles → C3-gate`
- produce: `P0-scripts → P1-fanout → P2-render → P3-persist → P4-enrich → P5-confirm → P6-gate`

Per-Brief / per-Script worker modes added to the agent prompts. Verifiers split
into `verifyContentUnit` + aggregator `verifyContent` with array-path defence in
depth on the 80% proof rule. Unblocks `run_1779446750` at P0-scripts.

(Original task description preserved below.)

[paste the original E-027 block here]
```

- [ ] **Step 2: Update TASKS.md top summary**

Edit the "Open" bullet near the top of `TASKS.md`: remove the "E-027 is now P0" clause, decrement the enhancement count by 1, and remove the line about `run_1779446750` being blocked at `produce`/`P1-creative` by E-027.

- [ ] **Step 3: Commit**

```bash
git add TASKS.md DONE.md
git commit -m "docs: close E-027 — C1/P1 fanout shipped"
```

---

## Task 7: Update RESUME.md

**Files:**
- Modify: `RESUME.md`

- [ ] **Step 1: Refresh the snapshot**

Replace the "Resuming the loop run" section with:

```markdown
## Resuming the loop run

`run_1779446750` is **unblocked** as of 2026-05-23 — E-027's fanout fix shipped.
Next step is `/produce` (or `/loop`) to walk the run through `P0-scripts →
P1-fanout → P2-render → …` and park at HG3.

The new stage shapes:
- content: `C0-briefs → C1-fanout → C2-articles → C3-gate` (HG2)
- produce: `P0-scripts → P1-fanout → P2-render → P3-persist → P4-enrich → P5-confirm → P6-gate` (HG3)
```

Also bump the "Latest work" line at the top and the test count if Task 5 Step 2 raised it.

- [ ] **Step 2: Commit**

```bash
git add RESUME.md
git commit -m "docs: refresh RESUME.md — E-027 shipped, run_1779446750 unblocked"
```

---

## Self-review checklist

After execution, verify:

- [ ] §5 target shape in the spec matches `produceStage.steps` and `contentStage.steps` exactly.
- [ ] §6 aggregation contract: `foldContentUnits` returns the `ContentResult` shape consumers expect (`{ scripts, hookBanks, proofRatio }`); `foldCreativePlan` returns `{ runId, creatives }` with `creatives` flat.
- [ ] §7 agent prompt split: option 1 implemented (specialist agents with worker-mode sections), not option 2.
- [ ] §8 proof rule: per-Brief enforcement is in `verifyContentUnit`; union check is in `verifyContent` array path.
- [ ] §9 files touched: every file in the spec's list has a commit in this plan.
- [ ] §10 test plan: every bullet has at least one corresponding step in Tasks 1–3.
- [ ] §11 stage-ID migration: confirmed by Task 5 Step 4 (`plan()` returns `P0-scripts` for the blocked run).
- [ ] No subagent spawn carries more than one Brief or one Script's worth of data — verify by reading the `units[*].spawnPrompt` strings in the produce.test.ts assertions.
- [ ] `pnpm -r build` + `pnpm test` + `pnpm sync:agents:check` all green at the final commit.
