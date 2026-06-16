# Hook-Bank Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop persisting the 30-hook candidate bank on Notion Script rows; carry it from the content stage to the produce stage inside the C1-write result the orchestrator already persists.

**Architecture:** `content-writer` returns the full per-Brief hook banks in its C1-write result JSON instead of writing a `Hook Bank` column onto every Script row. The orchestrator persists that result (it already does, for every step). The produce stage's `P1-creative.build()` reads it via the existing `stepResult()` helper and injects the banks into the `creative-director` spawn prompt. The `Hook Bank` Notion column, its compliance-scan special-case, and the now-dead `Hook` Zod cluster are removed.

**Tech Stack:** TypeScript, Zod, Vitest, pnpm workspace (sequential `pnpm -r build` — never `--parallel`), Notion + orchestrator MCP servers, Claude Code subagent prompt files (`.claude/agents/*.md`) with role-tagged fragments synced from `packages/shared/src/prompts/`.

**Spec:** `docs/superpowers/specs/2026-05-22-hook-bank-storage-design.html`

---

## File structure

| File | Role | Change |
|---|---|---|
| `packages/orchestrator/src/verifiers/verify-content.ts` | C1 acceptance test | Count real hooks from `hooks[]` |
| `packages/orchestrator/src/verifiers/verify-content.test.ts` | its tests | New fixtures carrying `hooks[]` |
| `packages/orchestrator/src/stages/produce.ts` | produce stage | `P1-creative.build()` injects the banks |
| `packages/orchestrator/src/stages/produce.test.ts` | its tests | P1 reads the C1-write result |
| `mcp-servers/notion/src/extract-text.ts` | compliance text extraction | Remove `extractHookBank` |
| `mcp-servers/notion/src/extract-text.test.ts` | its tests | Remove the 2 Hook Bank tests |
| `packages/notion-bootstrap/src/schemas.ts` | Notion DB schema | Drop the `Hook Bank` column |
| `packages/shared/src/zod.ts` | shared Zod schemas | Remove the dead Hook cluster |
| `packages/shared/src/types.ts` | shared TS types | Remove `Hook`, `Script.hookBank` |
| `.claude/agents/content-writer.md` | content-writer prompt | Return banks, stop writing the column |
| `packages/shared/src/prompts/tactical-piliero.md` | shared prompt fragment | Fix the stale `HookBankSchema` line |
| `.claude/agents/creative-director.md` | creative-director prompt | Read banks from the spawn prompt |

**Task order:** code first (Tasks 1–5, each leaves `pnpm -r build` + `pnpm test` green), prompts last (Tasks 6–7).

---

### Task 1: verifyContent counts real hooks from `hooks[]`

The B-016 verifier reads a self-reported `registerCounts` summary. With Approach D the C1-write result carries the real `hooks[]` per Brief — count from that instead. This is a strict tightening (an honest agent that reported `18` but wrote `30` can no longer slip through, and vice versa).

**Files:**
- Modify: `packages/orchestrator/src/verifiers/verify-content.ts`
- Test: `packages/orchestrator/src/verifiers/verify-content.test.ts`

- [ ] **Step 1: Rewrite the test file to the new contract**

Replace the entire contents of `packages/orchestrator/src/verifiers/verify-content.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { verifyContent } from "./verify-content.js";

const REGISTERS = ["fear", "aspiration", "curiosity", "proof", "contrarian", "identity"] as const;

/** A hooks[] array carrying `perRegister` hooks in each of the 6 registers. */
function hooks(perRegister: number): { en: string; ms: string; register: string }[] {
  const out: { en: string; ms: string; register: string }[] = [];
  for (const register of REGISTERS) {
    for (let i = 0; i < perRegister; i++) {
      out.push({ en: `en ${register} ${i}`, ms: `ms ${register} ${i}`, register });
    }
  }
  return out;
}

/** A hook bank satisfying the §8 rule — 6 registers, 5 each, 30 total. */
function validBank(briefId = "b1") {
  return { briefId, hooks: hooks(5) };
}

function validResult() {
  return { scripts: ["s1"], hookBanks: [validBank()] };
}

describe("verifyContent", () => {
  it("passes a result with scripts and a complete ≥30 hook bank", () => {
    expect(verifyContent(validResult())).toEqual({ ok: true, problems: [] });
  });

  it("fails a null / non-object result", () => {
    expect(verifyContent(null).ok).toBe(false);
    expect(verifyContent("scripts").ok).toBe(false);
  });

  it("fails a result with no scripts", () => {
    expect(verifyContent({ hookBanks: [validBank()] }).ok).toBe(false);
    expect(verifyContent({ scripts: [], hookBanks: [validBank()] }).ok).toBe(false);
  });

  it("fails a result with scripts but no hook banks", () => {
    expect(verifyContent({ scripts: ["s1"] }).ok).toBe(false);
    expect(verifyContent({ scripts: ["s1"], hookBanks: [] }).ok).toBe(false);
  });

  it("fails a hook bank below the 30-hook minimum", () => {
    const result = verifyContent({
      scripts: ["s1"],
      hookBanks: [{ briefId: "b1", hooks: hooks(3) }],
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("30");
  });

  it("fails a hook bank missing an emotional register", () => {
    const noIdentity = hooks(6).filter((h) => h.register !== "identity");
    const result = verifyContent({
      scripts: ["s1"],
      hookBanks: [{ briefId: "b1", hooks: noIdentity }],
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("identity");
  });

  it("fails a hook bank with a register below 3 hooks", () => {
    const thin = hooks(7).filter((h) => h.register !== "fear");
    thin.push(
      { en: "en fear 0", ms: "ms fear 0", register: "fear" },
      { en: "en fear 1", ms: "ms fear 1", register: "fear" },
    );
    const result = verifyContent({
      scripts: ["s1"],
      hookBanks: [{ briefId: "b1", hooks: thin }],
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("fear");
  });

  it("counts hooks from hooks[], ignoring any self-reported summary fields", () => {
    // The bank LIES via summary fields but actually carries a full, valid 30.
    const result = verifyContent({
      scripts: ["s1"],
      hookBanks: [
        { briefId: "b1", totalHooks: 18, registerCounts: { fear: 3 }, hooks: hooks(5) },
      ],
    });
    expect(result).toEqual({ ok: true, problems: [] });
  });

  it("names the offending Brief in hook-bank problems", () => {
    const result = verifyContent({
      scripts: ["s1"],
      hookBanks: [{ briefId: "brief-xyz", hooks: hooks(3) }],
    });
    expect(result.problems.join(" ")).toContain("brief-xyz");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/orchestrator/src/verifiers/verify-content.test.ts`
Expected: FAIL — several tests red. The current verifier reads `bank.registerCounts` (absent on the new fixtures), so `validResult()` produces `"... has no registerCounts breakdown"` and `ok: false` where the test expects `ok: true`.

- [ ] **Step 3: Rewrite the verifier**

Replace the entire contents of `packages/orchestrator/src/verifiers/verify-content.ts` with:

```typescript
import type { VerifyResult } from "../types.js";

/**
 * The content-stage acceptance test. `content-writer` returns the scripts it
 * authored plus the per-Brief hook banks — IN the C1-write result, not on
 * Notion Script rows (the bank is single-run machine plumbing; see
 * docs/superpowers/specs/2026-05-22-hook-bank-storage-design.html). This
 * checks the run produced scripts AND that every hook bank satisfies the §8
 * Piliero rule — ≥30 hooks across all six emotional registers, ≥3 in each.
 *
 * The count is taken from the real `hooks[]` array, never a self-reported
 * summary — an agent that under-delivers (or mis-reports) must still fail here.
 */
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
}

/** The six emotional registers every hook bank must cover. */
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

/** Append any §8 violations of one hook bank to `problems`. */
function verifyHookBank(bank: unknown, index: number, problems: string[]): void {
  const briefId =
    bank !== null && typeof bank === "object" ? (bank as HookBankEntry).briefId : undefined;
  const label = typeof briefId === "string" ? `Brief ${briefId}` : `hook bank #${index + 1}`;

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
      if (typeof register === "string") {
        counts[register] = (counts[register] ?? 0) + 1;
      }
    }
  }
  const countOf = (register: string): number => counts[register] ?? 0;

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

export function verifyContent(result: unknown): VerifyResult {
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
    hookBanks.forEach((bank, i) => verifyHookBank(bank, i, problems));
  }

  return problems.length === 0
    ? { ok: true, problems: [] }
    : { ok: false, problems };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/orchestrator/src/verifiers/verify-content.test.ts`
Expected: PASS — 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/verifiers/verify-content.ts packages/orchestrator/src/verifiers/verify-content.test.ts
git commit -m "refactor(orchestrator): verifyContent counts real hooks from hooks[]

The content stage will carry the full hook banks in the C1-write result
(Approach D). verifyContent now tallies registers from the real hooks[]
array instead of a self-reported registerCounts summary.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: P1-creative injects the hook banks from the C1-write result

The produce stage's first step spawns `creative-director`. Today its `build()` emits a static prompt. Now it reads the C1-write result from run state and hands the hook banks to the agent in the spawn prompt.

**Files:**
- Modify: `packages/orchestrator/src/stages/produce.ts` (import + `p1Creative`)
- Test: `packages/orchestrator/src/stages/produce.test.ts`

- [ ] **Step 1: Update the P1 tests**

In `packages/orchestrator/src/stages/produce.test.ts`, replace this existing test:

```typescript
  it("P1 spawns creative-director and names the runId", () => {
    const step = produceStage.steps[0]!.build(runWith([]));
    if (step.kind !== "spawn") throw new Error("expected spawn");
    expect(step.agent).toBe("creative-director");
    expect(step.spawnPrompt).toContain("run_p");
  });
```

with:

```typescript
  it("P1 reads the C1-write hook banks and embeds them in the spawnPrompt", () => {
    const hookBanks = [
      { briefId: "brief-1", hooks: [{ en: "h", ms: "h", register: "fear" }] },
    ];
    const run = runWith([doneStep("C1-write", { scripts: ["s1"], hookBanks })]);
    const step = produceStage.steps[0]!.build(run);
    if (step.kind !== "spawn") throw new Error("expected spawn");
    expect(step.agent).toBe("creative-director");
    expect(step.spawnPrompt).toContain("run_p");
    expect(step.spawnPrompt).toContain("brief-1");
  });

  it("P1 build throws when the C1-write result carries no hook banks", () => {
    expect(() => produceStage.steps[0]!.build(runWith([]))).toThrow(/hookBanks/);
  });
```

Note: `doneStep` (defined at the top of this test file) hard-codes `stage: "produce"`, but `stepResult()` finds a step by `stepId` only, so `doneStep("C1-write", ...)` is a valid stand-in for the content-stage step.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/orchestrator/src/stages/produce.test.ts`
Expected: FAIL — "P1 reads the C1-write hook banks..." fails because the current `p1Creative` prompt never contains `brief-1`; "P1 build throws..." fails because the current build never throws.

- [ ] **Step 3: Add the import**

In `packages/orchestrator/src/stages/produce.ts`, replace:

```typescript
import type { RunState, StageDefinition, Step, StepSpec, VerifyResult } from "../types.js";
import {
  verifyProduce,
  type ProduceScript,
  type ProduceVariant,
} from "../verifiers/verify-produce.js";
```

with:

```typescript
import type { RunState, StageDefinition, Step, StepSpec, VerifyResult } from "../types.js";
import type { ContentResult } from "../verifiers/verify-content.js";
import {
  verifyProduce,
  type ProduceScript,
  type ProduceVariant,
} from "../verifiers/verify-produce.js";
```

- [ ] **Step 4: Rewrite `p1Creative`**

In `packages/orchestrator/src/stages/produce.ts`, replace the `p1Creative` definition:

```typescript
const p1Creative: StepSpec = {
  id: "P1-creative",
  kind: "spawn",
  build: (run): Step => ({
    kind: "spawn",
    stepId: "P1-creative",
    agent: "creative-director",
    spawnPrompt: [
      `Run ${run.runId}: you are the creative-director. Query this run's`,
      "human-approved Scripts and decompose each into the 4 distinct creatives",
      "(Reel, Feed, YT-Long, Carousel). Follow your agent instructions exactly —",
      "taste only, no spec derivation, no Notion writes. Return a CreativePlan",
      "{ runId, creatives } as your final JSON message.",
    ].join(" "),
  }),
};
```

with:

```typescript
const p1Creative: StepSpec = {
  id: "P1-creative",
  kind: "spawn",
  build: (run): Step => {
    const content = stepResult<ContentResult>(run, "C1-write");
    const banks = content?.hookBanks;
    if (!Array.isArray(banks) || banks.length === 0) {
      throw new Error(
        "P1-creative: the C1-write result carries no hookBanks — " +
          "cannot dispatch creative-director without the run's hook banks",
      );
    }
    return {
      kind: "spawn",
      stepId: "P1-creative",
      agent: "creative-director",
      spawnPrompt: [
        `Run ${run.runId}: you are the creative-director. Query this run's`,
        "human-approved Scripts and decompose each into the 4 distinct creatives",
        "(Reel, Feed, YT-Long, Carousel). Follow your agent instructions exactly —",
        "taste only, no spec derivation, no Notion writes. Return a CreativePlan",
        "{ runId, creatives } as your final JSON message.",
        "",
        "HOOK BANKS for this run — one entry per Brief, each carrying the full",
        "hooks list. Rotate your 4 hooks per Script from the bank whose briefId",
        "matches the Script's Brief. Do NOT query Notion for a Hook Bank column.",
        JSON.stringify(banks),
      ].join("\n"),
    };
  },
};
```

(`stepResult` is already defined at the top of `produce.ts`; no new helper is needed.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/orchestrator/src/stages/produce.test.ts`
Expected: PASS — all produce-stage tests green.

- [ ] **Step 6: Build and run the full orchestrator suite**

Run: `pnpm -r build` then `pnpm vitest run packages/orchestrator/`
Expected: build clean; all orchestrator tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator/src/stages/produce.ts packages/orchestrator/src/stages/produce.test.ts
git commit -m "feat(orchestrator): P1-creative injects hook banks from the C1-write result

P1-creative.build() reads the persisted C1-write result via stepResult()
and embeds the per-Brief hook banks in the creative-director spawn prompt;
throws loud if the result carries no banks.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Remove `extractHookBank` from the compliance text extractor

Once `content-writer` stops writing the `Hook Bank` column (Task 6), the Notion compliance scanner's special-case for it is dead code.

**Files:**
- Modify: `mcp-servers/notion/src/extract-text.ts`
- Test: `mcp-servers/notion/src/extract-text.test.ts`

This task removes dead code — no new behavior, so no red test. The safety net is the build + the surviving tests staying green.

- [ ] **Step 1: Remove the two Hook Bank tests**

Replace the entire contents of `mcp-servers/notion/src/extract-text.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { extractTextByLang } from "./extract-text.js";

const rt = (s: string) => ({
  rich_text: [{ type: "text", text: { content: s }, plain_text: s }],
});
const title = (s: string) => ({
  title: [{ type: "text", text: { content: s }, plain_text: s }],
});

describe("extractTextByLang", () => {
  it("routes EN/BM fields to their respective buckets", () => {
    const out = extractTextByLang({
      Title: title("EngineerDad"),
      "Body EN": rt("Investment involves risk."),
      "Body BM": rt("Pelaburan melibatkan risiko."),
    });
    expect(out.en).toContain("EngineerDad");
    expect(out.en).toContain("Investment involves risk");
    expect(out.ms).toContain("Pelaburan");
  });

  it("treats single-language rich_text fields (no suffix) as EN", () => {
    const out = extractTextByLang({
      Promise: rt("Engineer your child's financial future."),
      "Thumbnail Brief": rt("Open on dad + daughter at desk."),
    });
    expect(out.en).toContain("Engineer your child");
    expect(out.en).toContain("Open on dad + daughter at desk");
    expect(out.ms).toBe("");
  });

  it("ignores non-text property types", () => {
    const out = extractTextByLang({
      "Compliance Check": { checkbox: true },
      "Run ID": rt("run_123"),
    });
    expect(out.en).toBe("run_123");
  });
});
```

- [ ] **Step 2: Remove `extractHookBank` and its branch**

Replace the entire contents of `mcp-servers/notion/src/extract-text.ts` with:

```typescript
import type { Lang } from "@engineerdad/shared";

/**
 * Extract plain text from a Notion property value (rich_text or title array).
 * Returns "" for non-text property types.
 */
function plainTextFromProperty(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const v = value as Record<string, unknown>;
  const arr = (v["rich_text"] ?? v["title"]) as unknown;
  if (!Array.isArray(arr)) return "";
  return arr
    .map((seg) => {
      if (!seg || typeof seg !== "object") return "";
      const s = seg as Record<string, unknown>;
      if (typeof s["plain_text"] === "string") return s["plain_text"];
      const text = s["text"] as { content?: string } | undefined;
      return text?.content ?? "";
    })
    .join("");
}

const LANG_SUFFIX: Array<{ suffix: string; lang: Lang }> = [
  { suffix: " EN", lang: "en" },
  { suffix: " (EN)", lang: "en" },
  { suffix: " BM", lang: "ms" },
  { suffix: " (BM)", lang: "ms" },
];

function classifyField(name: string): Lang {
  for (const { suffix, lang } of LANG_SUFFIX) {
    if (name.endsWith(suffix)) return lang;
  }
  return "en";
}

/**
 * Walk a Notion `properties` payload and concatenate all rich_text/title
 * content into one bucket per language. Fields with " EN" / " BM"
 * (or parenthesized variants) suffix are routed by suffix; everything
 * else is treated as English.
 */
export function extractTextByLang(
  properties: Record<string, unknown>,
): Record<Lang, string> {
  const buckets: Record<Lang, string[]> = { en: [], ms: [] };
  for (const [name, value] of Object.entries(properties)) {
    const text = plainTextFromProperty(value);
    if (!text.trim()) continue;
    buckets[classifyField(name)].push(text);
  }
  return {
    en: buckets.en.join("\n\n"),
    ms: buckets.ms.join("\n\n"),
  };
}
```

- [ ] **Step 3: Build and test**

Run: `pnpm -r build` then `pnpm vitest run mcp-servers/notion/`
Expected: build clean; all notion-server tests pass (3 `extractTextByLang` tests remain).

- [ ] **Step 4: Commit**

```bash
git add mcp-servers/notion/src/extract-text.ts mcp-servers/notion/src/extract-text.test.ts
git commit -m "refactor(notion): drop extractHookBank — Hook Bank column retired

The hook bank no longer lives on Notion Script rows, so the compliance
scanner's Hook Bank special-case is dead code.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Drop the `Hook Bank` column from the Scripts schema

**Files:**
- Modify: `packages/notion-bootstrap/src/schemas.ts`

The live Notion workspace keeps the (now never-written) column — it becomes vestigial/empty. A `migrate:` to physically delete it is optional cleanup, out of scope for this plan.

- [ ] **Step 1: Remove the column**

In `packages/notion-bootstrap/src/schemas.ts`, in the `Scripts` DB definition, replace:

```typescript
    "Hook BM": { rich_text: {} },
    "Hook Bank": { rich_text: {} },
    "Script EN": { rich_text: {} },
```

with:

```typescript
    "Hook BM": { rich_text: {} },
    "Script EN": { rich_text: {} },
```

- [ ] **Step 2: Build**

Run: `pnpm -r build`
Expected: build clean (`packages/notion-bootstrap` has no test suite).

- [ ] **Step 3: Commit**

```bash
git add packages/notion-bootstrap/src/schemas.ts
git commit -m "refactor(schema): drop the Scripts Hook Bank column

The hook bank is carried in the C1-write result, not on Script rows.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Remove the dead `Hook` schema cluster

After Tasks 1–4 nothing reads a `hookBank` off a Script. `ScriptSchema.hookBank`, `Script.hookBank`, and the `HookSchema` / `HookBankSchema` / `Hook` cluster are orphaned (a repo grep finds no other importer). The cluster's shape (`{ text: {en,ms}, register }`) never matched the live flat `{en,ms,register}` JSON anyway.

**Files:**
- Modify: `packages/shared/src/zod.ts`
- Modify: `packages/shared/src/types.ts`

These edits must land together — removing `Hook` from `types.ts` breaks `Script.hookBank` unless that field is also removed, and removing `HookBankSchema` breaks `ScriptSchema.hookBank` likewise. `pnpm -r build` (TypeScript) is the safety net for any missed importer.

- [ ] **Step 1: Remove `HookSchema`, `REQUIRED_REGISTERS`, `HookBankSchema` from `zod.ts`**

In `packages/shared/src/zod.ts`, replace this block:

```typescript
export const HookSchema = z.object({
  text: BilingualSchema,
  register: EmotionalRegisterSchema,
});

const REQUIRED_REGISTERS: ReadonlyArray<z.infer<typeof EmotionalRegisterSchema>> = [
  "fear",
  "aspiration",
  "curiosity",
  "proof",
  "contrarian",
  "identity",
];

export const HookBankSchema = z
  .array(HookSchema)
  .min(30, "hookBank must contain at least 30 hooks (§8 Piliero rule)")
  .superRefine((hooks, ctx) => {
    const present = new Set(hooks.map((h) => h.register));
    const missing = REQUIRED_REGISTERS.filter((r) => !present.has(r));
    if (missing.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `hookBank missing emotional register(s): ${missing.join(", ")}`,
      });
    }
  });

export const ValueSegmentBankSchema = z
```

with:

```typescript
export const ValueSegmentBankSchema = z
```

- [ ] **Step 2: Remove the `hookBank` field from `ScriptSchema`**

In `packages/shared/src/zod.ts`, replace:

```typescript
  hook: BilingualSchema,
  hookBank: HookBankSchema,
  script: BilingualSchema,
```

with:

```typescript
  hook: BilingualSchema,
  script: BilingualSchema,
```

- [ ] **Step 3: Remove the `Hook` interface from `types.ts`**

In `packages/shared/src/types.ts`, replace:

```typescript
export interface Hook {
  text: Bilingual;
  register: EmotionalRegister;
}

export interface Script extends BaseRow {
```

with:

```typescript
export interface Script extends BaseRow {
```

- [ ] **Step 4: Remove the `hookBank` field from `Script`**

In `packages/shared/src/types.ts`, replace:

```typescript
  hook: Bilingual;
  hookBank: Hook[];
  script: Bilingual;
```

with:

```typescript
  hook: Bilingual;
  script: Bilingual;
```

- [ ] **Step 5: Build and run the full suite**

Run: `pnpm -r build` then `pnpm test`
Expected: build clean (TypeScript confirms nothing else imported the removed symbols); all tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/zod.ts packages/shared/src/types.ts
git commit -m "refactor(shared): remove the dead Hook schema cluster

ScriptSchema.hookBank / Script.hookBank are gone (the bank rides the
C1-write result, not a Script). HookSchema / HookBankSchema / Hook were
then orphaned — and their {text:{en,ms}} shape never matched the live
flat {en,ms,register} JSON. Removed.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: content-writer returns the banks; stop writing the column

**Files:**
- Modify: `packages/shared/src/prompts/tactical-piliero.md`
- Modify: `.claude/agents/content-writer.md`

`content-writer.md` is partly generated: the `<!-- include:tactical-piliero.md#content-gen -->` block is synced from the fragment. The three hand-edits below are all *outside* that block, so they survive `pnpm sync:agents`. Do the fragment edit + sync first, then the hand-edits.

- [ ] **Step 1: Fix the stale fragment line**

In `packages/shared/src/prompts/tactical-piliero.md`, replace:

```
Scripts are then **permutations** (hook × value segment), not N independent
scripts. The Zod schema (`HookBankSchema`, `ValueSegmentBankSchema`) enforces
both the count and the register coverage.
```

with:

```
Scripts are then **permutations** (hook × value segment), not N independent
scripts. The C1 verifier (`verifyContent`) checks the hook bank's count and
register coverage from the C1-write result.
```

- [ ] **Step 2: Sync the agent files**

Run: `pnpm sync:agents`
Expected: it re-pastes the fragment into every agent that includes it (including `content-writer.md`).

- [ ] **Step 3: Stop persisting the bank to Notion (Step 4a)**

In `.claude/agents/content-writer.md`, replace:

```
This bank persists onto every Script row from this Brief via the `Hook Bank` rich_text property (JSON array of `{en, ms, register}`). The bank is the **same** across the Brief's 3 scripts — Media Production rotates through it later when generating creative variants.
```

with:

```
This bank is **not** written to Notion. Return it in your final JSON message's `hookBanks` array (see Return shape) — one entry per Brief, carrying the full `hooks` list. The orchestrator persists the result and hands the banks to the creative-director, who rotates through them when generating creative variants.
```

- [ ] **Step 4: Remove the `Hook Bank` per-Script property bullet (Step 4c)**

In `.claude/agents/content-writer.md`, replace:

```
- `Hook EN/BM` — natural translation, not literal. The **primary** hook from the bank for this script.
- `Hook Bank` — JSON array of all ≥30 `{en, ms, register}` hooks for this Brief, written as a rich_text payload (`{rich_text:[{type:"text",text:{content:JSON.stringify(hooks)}}]}`). Same bank on every script in the Brief; Media Production rotates through it.
```

with:

```
- `Hook EN/BM` — natural translation, not literal. The **primary** hook from the bank for this script.
```

- [ ] **Step 5: Update the return shape**

In `.claude/agents/content-writer.md`, in the "Return shape (strict)" JSON block, replace:

```
  "hookBanks": [
    {
      "briefId": "...",
      "registerCounts": { "fear": 5, "aspiration": 6, "curiosity": 5, "proof": 7, "identity": 4, "contrarian": 3 },
      "totalHooks": 30
    }
  ],
```

with:

```
  "hookBanks": [
    {
      "briefId": "...",
      "hooks": [
        { "en": "...", "ms": "...", "register": "fear" }
      ]
    }
  ],
```

The `hooks` array carries the **full ≥30 hooks** for that Brief (abbreviated to one entry above). This is the only place the bank is emitted — it is no longer written to Notion.

- [ ] **Step 6: Verify the sync is clean**

Run: `pnpm sync:agents:check`
Expected: PASS — the fragment blocks match (the three hand-edits above are outside any include block).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/prompts/tactical-piliero.md .claude/agents/content-writer.md
git commit -m "docs(agent): content-writer returns hook banks, stops writing them to Notion

The 30-hook bank now travels in the C1-write result's hookBanks array
(full hooks per Brief), not a Notion Script column. Fix the stale
tactical-piliero.md line that credited HookBankSchema for enforcement.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: creative-director reads the banks from its spawn prompt

**Files:**
- Modify: `.claude/agents/creative-director.md`

`creative-director.md` has no `<!-- include -->` block — these are plain hand-edits, no sync needed.

- [ ] **Step 1: Rewrite Step 2 (Read Scripts + parent Briefs)**

In `.claude/agents/creative-director.md`, replace:

```
Query `Scripts` where `Run ID = runId` AND `Approval Status = Approved`. For each, follow the `Brief` relation and query that `Brief` for `Funnel Stage`, `Persona`, `Topic`, `Target Query`. Each Script carries a `Hook Bank` rich_text — a JSON array of `{en, ms, register}` with ≥30 bilingual hooks. Parse it once per Script. If empty or unparseable, fall back to the Script's `Hook EN/BM` and note it.
```

with:

```
Query `Scripts` where `Run ID = runId` AND `Approval Status = Approved`. Pass `filter_properties: ["Script EN", "Script BM", "CTA EN", "CTA BM", "Duration (sec)", "Funnel Stage", "Hook EN", "Hook BM", "Brief"]` so the query stays well under the tool-result token cap. For each Script, follow the `Brief` relation and query that `Brief` for `Funnel Stage`, `Persona`, `Topic`, `Target Query`.

The **hook banks are provided in your spawn prompt** — a JSON array under `HOOK BANKS`, one entry per Brief, each `{ briefId, hooks: [{en, ms, register}, …] }` with ≥30 bilingual hooks. Match each Script to its Brief's bank by `briefId`. Do **not** query Notion for a `Hook Bank` column — it no longer exists. If a Script's Brief has no bank in the prompt, fall back to the Script's `Hook EN/BM` and note it.
```

- [ ] **Step 2: Update the Step 3 hook-rotation line**

In `.claude/agents/creative-director.md`, replace:

```
- **Hook rotation.** Pick 4 distinct hooks from the Hook Bank, one per creative, each a **different emotional register** (e.g. Reel = curiosity, Feed = identity, YT-Long = proof, Carousel = contrarian). Never reuse a hook across two creatives of the same Script.
```

with:

```
- **Hook rotation.** Pick 4 distinct hooks from the Brief's hook bank (provided in your spawn prompt), one per creative, each a **different emotional register** (e.g. Reel = curiosity, Feed = identity, YT-Long = proof, Carousel = contrarian). Never reuse a hook across two creatives of the same Script.
```

- [ ] **Step 3: Verify nothing else broke**

Run: `pnpm sync:agents:check`
Expected: PASS (`creative-director.md` has no include block; this just confirms no agent file drifted).

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/creative-director.md
git commit -m "docs(agent): creative-director reads hook banks from the spawn prompt

The banks arrive in the P1-creative spawn prompt (Approach D). The
Scripts query now uses filter_properties and no longer reads a Hook
Bank column.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## After all tasks

- [ ] **Final verification:** `pnpm -r build` (sequential) then `pnpm test` — full suite green.
- [ ] **Manual smoke (optional):** on the next real `/loop` content stage, confirm the C1-write result carries `hookBanks[].hooks[]` and that `P1-creative`'s spawn prompt contains the banks.

**Notes — out of scope:**
- The in-flight `run_1779446750` predates this change; its hook banks are already on Notion Script rows and its C1-write result holds the old summary shape. If resumed at `P1-creative`, the creative-director falls back to per-Script `Hook EN/BM` — acceptable for a test-walk run; no migration is provided.
- Physically deleting the vestigial `Hook Bank` column from the live Notion workspace (a `migrate:` script) is optional cleanup, not part of this plan.
- E-028 (hook-level *learning*) is a separate effort — the candidate bank carries no learning signal.
