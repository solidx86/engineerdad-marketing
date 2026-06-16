# Meta-paid Manual Posting Pack + Webapp Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a flag-gated `manual` Meta-paid distribute mode that renders the existing distribution plan into a human-readable posting pack in the webapp (with ad-ID backfill), remove HG4, and migrate the organic IG posting pack from an R2-HTML script into a per-run webapp page.

**Architecture:** The posting pack is a **derived view** of the existing `planMetaPaid` output — no new config logic, no new persisted entity. A new `packages/distribute` lib renders the pack; a new `mcp-servers/distribute` exposes it to the agent loop; the **webapp reads it via direct package import** (MCP is stdio/agent-only). Manual mode excludes Meta-paid from the `D2a`/`D2b` agent fan-out in `stages/distribute.ts`. Backfill reuses `CreativeVariants.adId`.

**Tech Stack:** TypeScript (ESM, NodeNext), pnpm workspace, Vitest, Drizzle/Postgres store, `@modelcontextprotocol/sdk` MCP servers, Next.js 15 App Router + Tailwind webapp, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-05-30-meta-paid-posting-pack-design.html`

**Branch:** `feat/meta-paid-posting-pack` (already checked out; spec committed).

---

## Pre-flight (read once before starting)

- Build is **sequential**: `pnpm -r build` (never `--parallel`). To skip the webapp during package work: `pnpm -r --filter='!@engineerdad/webapp' build`.
- DB tests require a sandbox: run `pnpm db:sandbox` once on this branch, then **restart Claude Code** so MCP/env picks up `.env.local`. No schema change is needed in this plan (the pack is derived; `adId` already exists).
- Single test: `pnpm vitest run <path>` or `pnpm vitest <pattern> -t "<name>"`.
- After adding the new MCP server to `.mcp.json`, **restart Claude Code** to load it.
- `planMetaPaid`, `targetingForCell`, `LOCALE_ID`, `adsetStep`, types (`DistVariant`, `AllocatedCell`, `PlanPart`, `RowPlan`, `ToolStep`) are all exported from `@engineerdad/orchestrator`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/distribute/package.json`, `tsconfig.json` | New workspace lib scaffold. |
| `packages/distribute/src/types.ts` | `PostingPackSpec`, `PostingPackAd`, `BackfillInput`. |
| `packages/distribute/src/render-posting-pack.ts` | `renderPostingPack()` — pure: DistVariants + cells → `PostingPackSpec`. |
| `packages/distribute/src/index.ts` | Barrel. |
| `packages/orchestrator/src/distribute/plan-distribution.ts` | Export `dailyBudgetCentsFor` + `CAMPAIGN_OBJECTIVE` (extracted constants). |
| `packages/orchestrator/src/config.ts` | `metaPaidMode()` flag reader. |
| `packages/orchestrator/src/stages/distribute.ts` | Manual mode: exclude Meta-paid from D2a/D2b; mark skipped in D3b; remove `d4Gate`. |
| `mcp-servers/distribute/{package.json,tsconfig.json,src/index.ts}` | New MCP: `get_posting_pack`, `backfill_meta_ids`, `list_posting_packs`. |
| `apps/webapp/src/app/lib/posting-pack.ts` | Webapp data helper (direct `@engineerdad/store` + `renderPostingPack`). |
| `apps/webapp/src/app/lib/actions.ts` | Add `backfillAdId`, `backfillIgPostId` server actions. |
| `apps/webapp/src/app/posting-pack/[runId]/page.tsx` | Meta-paid pack reference table + backfill. |
| `apps/webapp/src/app/posting-pack/organic/[runId]/page.tsx` | Migrated organic pack (per-run) + igPostId backfill. |
| `apps/webapp/src/app/components/LeftNav.tsx` | Add "Posting Packs" nav. |
| `.mcp.json` | Register `distribute` server. |
| `scripts/build-posting-pack.mjs`, `.claude/commands/posting-pack.md` | Retire. |
| Docs: `ARCHITECTURE.md`, `CLAUDE.md`, `.claude/commands/{loop,distribute,experiment}.md`, `docs/decisions/015-write-api-safety.md`, `TASKS.md`, `DONE.md`, `.env.example` | Sync. |

---

## Task 1: Extract reusable constants from the planner

**Files:**
- Modify: `packages/orchestrator/src/distribute/plan-distribution.ts`
- Test: `packages/orchestrator/src/distribute/plan-distribution.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `plan-distribution.test.ts`:

```ts
import { dailyBudgetCentsFor, CAMPAIGN_OBJECTIVE } from "./plan-distribution.js";
import type { AllocatedCell } from "../experiment/allocation.js";

describe("dailyBudgetCentsFor", () => {
  const cell = { cellId: "cell-A", allocationPct: 70, variantPageIds: [] } as AllocatedCell;
  it("multiplies MYR by allocationPct and rounds", () => {
    expect(dailyBudgetCentsFor(cell, 10)).toBe(700);
  });
  it("floors at 1 cent for zero allocation", () => {
    expect(dailyBudgetCentsFor({ ...cell, allocationPct: 0 }, 10)).toBe(1);
  });
  it("exposes the campaign objective constant", () => {
    expect(CAMPAIGN_OBJECTIVE).toBe("OUTCOME_LEADS");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/orchestrator/src/distribute/plan-distribution.test.ts -t "dailyBudgetCentsFor"`
Expected: FAIL — `dailyBudgetCentsFor is not a function`.

- [ ] **Step 3: Extract the constant + helper**

In `plan-distribution.ts`, add near the top of the Meta-paid section:

```ts
export const CAMPAIGN_OBJECTIVE = "OUTCOME_LEADS" as const;

/** daily_budget_cents = MYR × allocationPct (percent units → cents), floored at 1. */
export function dailyBudgetCentsFor(cell: AllocatedCell, dailyBudgetMyr: number): number {
  return Math.max(1, Math.round(dailyBudgetMyr * cell.allocationPct));
}
```

Then refactor `campaignStep` to use `objective: CAMPAIGN_OBJECTIVE` and `adsetStep` to use `daily_budget_cents: dailyBudgetCentsFor(cell, dailyBudgetMyr)` (replacing the inline `Math.max(1, Math.round(...))`). Behaviour is unchanged.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run packages/orchestrator/src/distribute/plan-distribution.test.ts`
Expected: PASS (new + all existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/distribute/plan-distribution.ts packages/orchestrator/src/distribute/plan-distribution.test.ts
git commit -m "refactor(distribute): export dailyBudgetCentsFor + CAMPAIGN_OBJECTIVE for pack reuse"
```

---

## Task 2: Scaffold `packages/distribute` + types

**Files:**
- Create: `packages/distribute/package.json`
- Create: `packages/distribute/tsconfig.json`
- Create: `packages/distribute/src/types.ts`
- Create: `packages/distribute/src/index.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@engineerdad/distribute",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@engineerdad/orchestrator": "workspace:*"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

Copy `packages/meta-ads/tsconfig.json` verbatim (same compiler settings, `outDir: ./dist`, `rootDir: ./src`). If it `extends` `../../tsconfig.base.json`, keep that.

- [ ] **Step 3: Create `src/types.ts`**

```ts
export interface PostingPackAdset {
  cellId: string;
  name: string;
  dailyBudgetCents: number;
  dailyBudgetMyr: number;
  optimizationGoal: string;
  billingEvent: string;
  bidStrategy: string;
  targeting: { countries: string[]; ageMin: number; ageMax: number; locales: number[] };
}

export interface PostingPackAdCopy {
  primaryText: string;
  headline: string;
  description: string;
}

export interface PostingPackAd {
  variantId: string;
  rowId: string;
  title: string;
  cellId: string;
  adsetName: string;
  asset: { urls: string[]; format: string; aspect: string | null };
  en: PostingPackAdCopy;
  bm: PostingPackAdCopy;
  ctaType: string;
  backfill: { adIdEn: string | null; adIdMs: string | null; done: boolean };
}

export interface PostingPackSpec {
  runId: string;
  campaign: { name: string; objective: string; specialAdCategories: string[] };
  adsets: PostingPackAdset[];
  ads: PostingPackAd[];
}

export interface BackfillInput {
  rowId: string;
  adIdEn: string | null;
  adIdMs: string | null;
}
```

- [ ] **Step 4: Create `src/index.ts`**

```ts
export * from "./types.js";
export * from "./render-posting-pack.js";
```

- [ ] **Step 5: Add to workspace + commit**

Confirm `pnpm-workspace.yaml` globs `packages/*` (it does). Run `pnpm install` to link the new package.

```bash
git add packages/distribute pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(distribute): scaffold @engineerdad/distribute lib + PostingPack types"
```

---

## Task 3: `renderPostingPack()`

**Files:**
- Create: `packages/distribute/src/render-posting-pack.ts`
- Test: `packages/distribute/src/render-posting-pack.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { renderPostingPack } from "./render-posting-pack.js";
import type { DistVariant } from "@engineerdad/orchestrator";
import type { AllocatedCell } from "@engineerdad/orchestrator";

const cell: AllocatedCell = { cellId: "cell-A", allocationPct: 70, variantPageIds: ["v1"] } as AllocatedCell;

function variant(over: Partial<DistVariant> = {}): DistVariant {
  return {
    rowId: "row-1", variantId: "v1", format: "Feed", aspect: "4:5",
    channels: ["Meta-paid"], assetFiles: [{ url: "https://r2/a/1.png" }],
    adId: null, ytVideoId: null,
    metaSpec: {
      primaryTextEn: "PT en", primaryTextMs: "PT ms", headlineEn: "H en", headlineMs: "H ms",
      descriptionEn: "D en", descriptionMs: "D ms", ctaType: "LEARN_MORE", targetingJson: "",
    },
    ytSpec: null, cellId: "cell-A", fbPostId: null,
    organicScheduledFor: null, organicCaption: null, organicLang: null, ...over,
  } as DistVariant;
}

describe("renderPostingPack", () => {
  it("renders campaign, one adset per cell, and EN/BM ad copy", () => {
    const pack = renderPostingPack("run_1", [variant()], [cell], 10);
    expect(pack.campaign.objective).toBe("OUTCOME_LEADS");
    expect(pack.adsets).toHaveLength(1);
    expect(pack.adsets[0].dailyBudgetCents).toBe(700);
    expect(pack.adsets[0].targeting.locales).toEqual([6, 41]);
    expect(pack.ads).toHaveLength(1);
    expect(pack.ads[0].en.primaryText).toBe("PT en");
    expect(pack.ads[0].bm.headline).toBe("H ms");
    expect(pack.ads[0].asset.urls).toEqual(["https://r2/a/1.png"]);
    expect(pack.ads[0].backfill.done).toBe(false);
  });

  it("marks backfill done when adId is set", () => {
    const pack = renderPostingPack("run_1", [variant({ adId: { en: "111", ms: "222" } })], [cell], 10);
    expect(pack.ads[0].backfill).toEqual({ adIdEn: "111", adIdMs: "222", done: true });
  });

  it("skips variants without a metaSpec or cellId", () => {
    const pack = renderPostingPack("run_1", [variant({ metaSpec: null })], [cell], 10);
    expect(pack.ads).toHaveLength(0);
    expect(pack.adsets).toHaveLength(0);
  });

  it("excludes non-Meta-paid variants", () => {
    const pack = renderPostingPack("run_1", [variant({ channels: ["YouTube"] })], [cell], 10);
    expect(pack.ads).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/distribute/src/render-posting-pack.test.ts`
Expected: FAIL — cannot find `render-posting-pack.js`.

- [ ] **Step 3: Implement `renderPostingPack`**

```ts
import {
  CAMPAIGN_OBJECTIVE,
  dailyBudgetCentsFor,
  targetingForCell,
  type DistVariant,
  type AllocatedCell,
} from "@engineerdad/orchestrator";
import type { PostingPackSpec, PostingPackAdset, PostingPackAd } from "./types.js";

const META = "Meta-paid";

/** Parse the text adId column into {en, ms}. Tolerates JSON object/string/bare. */
function parseAdId(raw: unknown): { en: string | null; ms: string | null } {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return { en: typeof o.en === "string" ? o.en : null, ms: typeof o.ms === "string" ? o.ms : null };
  }
  if (typeof raw === "string" && raw.length > 0) {
    try { return parseAdId(JSON.parse(raw)); } catch { return { en: raw, ms: null }; }
  }
  return { en: null, ms: null };
}

/** Routable = Meta-paid, has metaSpec, has a cell present in the design. */
function isRoutable(v: DistVariant, cellIds: Set<string>): boolean {
  return v.channels.includes(META) && !!v.metaSpec && !!v.cellId && cellIds.has(v.cellId);
}

export function renderPostingPack(
  runId: string,
  variants: DistVariant[],
  cells: AllocatedCell[],
  dailyBudgetMyr: number,
): PostingPackSpec {
  const cellById = new Map(cells.map((c) => [c.cellId, c]));
  const cellIds = new Set(cells.map((c) => c.cellId));
  const routable = variants.filter((v) => isRoutable(v, cellIds));

  const adsetByCell = new Map<string, PostingPackAdset>();
  const ads: PostingPackAd[] = [];

  for (const v of routable) {
    const cell = cellById.get(v.cellId!)!;
    const adsetName = `${runId}__${cell.cellId}`;
    if (!adsetByCell.has(cell.cellId)) {
      const t = targetingForCell(cell);
      const cents = dailyBudgetCentsFor(cell, dailyBudgetMyr);
      adsetByCell.set(cell.cellId, {
        cellId: cell.cellId,
        name: adsetName,
        dailyBudgetCents: cents,
        dailyBudgetMyr: cents / 100,
        optimizationGoal: "LEAD_GENERATION",
        billingEvent: "IMPRESSIONS",
        bidStrategy: "LOWEST_COST_WITHOUT_CAP",
        targeting: {
          countries: t.geo_locations.countries,
          ageMin: t.age_min,
          ageMax: t.age_max,
          locales: t.locales,
        },
      });
    }
    const s = v.metaSpec!;
    const bf = parseAdId(v.adId);
    ads.push({
      variantId: v.variantId,
      rowId: v.rowId,
      title: (v as unknown as { title?: string }).title ?? v.variantId,
      cellId: cell.cellId,
      adsetName,
      asset: { urls: v.assetFiles.map((f) => f.url), format: v.format, aspect: v.aspect ?? null },
      en: { primaryText: s.primaryTextEn, headline: s.headlineEn, description: s.descriptionEn },
      bm: { primaryText: s.primaryTextMs, headline: s.headlineMs, description: s.descriptionMs },
      ctaType: s.ctaType,
      backfill: { adIdEn: bf.en, adIdMs: bf.ms, done: !!(bf.en && bf.ms) },
    });
  }

  return {
    runId,
    campaign: { name: `EDOS_${runId}`, objective: CAMPAIGN_OBJECTIVE, specialAdCategories: [] },
    adsets: [...adsetByCell.values()],
    ads,
  };
}
```

> Note: `aspect` on `DistVariant` is typed `string` but DB rows may be empty; the `?? null` keeps the display tolerant. `title` isn't on `DistVariant` — Task 6's webapp query passes it through the row, so the lib reads it defensively.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run packages/distribute/src/render-posting-pack.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Build the package + commit**

Run: `pnpm -r --filter='!@engineerdad/webapp' build` (confirms no type errors across packages).

```bash
git add packages/distribute
git commit -m "feat(distribute): renderPostingPack — derived PostingPackSpec from planner inputs"
```

---

## Task 4: `META_PAID_MODE` flag reader

**Files:**
- Create: `packages/orchestrator/src/config.ts`
- Create: `packages/orchestrator/src/config.test.ts`
- Modify: `packages/orchestrator/src/index.ts` (export config)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { metaPaidMode } from "./config.js";

afterEach(() => { delete process.env.META_PAID_MODE; });

describe("metaPaidMode", () => {
  it("defaults to manual", () => { expect(metaPaidMode()).toBe("manual"); });
  it("returns api when set", () => { process.env.META_PAID_MODE = "api"; expect(metaPaidMode()).toBe("api"); });
  it("falls back to manual for garbage", () => { process.env.META_PAID_MODE = "xyz"; expect(metaPaidMode()).toBe("manual"); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/orchestrator/src/config.test.ts`
Expected: FAIL — cannot find `config.js`.

- [ ] **Step 3: Implement**

`config.ts`:

```ts
export type MetaPaidMode = "api" | "manual";

/** Default `manual` until Meta business verification unblocks the API path. */
export function metaPaidMode(): MetaPaidMode {
  return process.env.META_PAID_MODE === "api" ? "api" : "manual";
}
```

Add to `packages/orchestrator/src/index.ts`:

```ts
export * from "./config.js";
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm vitest run packages/orchestrator/src/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/config.ts packages/orchestrator/src/config.test.ts packages/orchestrator/src/index.ts
git commit -m "feat(orchestrator): META_PAID_MODE flag (default manual)"
```

---

## Task 5: Manual mode in `stages/distribute.ts` + remove HG4

**Files:**
- Modify: `packages/orchestrator/src/stages/distribute.ts`
- Test: `packages/orchestrator/src/stages/distribute.test.ts`

Behaviour: when `metaPaidMode() === "manual"`, the Meta-paid channel is excluded from the `D2a-setup` spawn and the `D2b-route` fan-out (no Meta API workers), and `D3b-summary` records Meta-paid rows as `skipped` with reason `"manual posting pack"`. `d4Gate` (HG4) is removed from the stage in all modes.

- [ ] **Step 1: Write the failing tests**

Add to `distribute.test.ts` (reuse the file's existing run/variant fixtures; pattern shown):

```ts
import { metaPaidMode } from "../config.js";

describe("distribute manual mode", () => {
  afterEach(() => { delete process.env.META_PAID_MODE; });

  it("excludes Meta-paid units from D2b-route fan-out in manual mode", async () => {
    process.env.META_PAID_MODE = "manual";
    // build a run with one approved Meta-paid variant assigned to a cell (use the
    // existing fixture builder in this file), then:
    const step = await __d2bRouteForTests.build(run, ctx);
    const prompts = step.units.map((u) => u.spawnPrompt);
    expect(prompts.some((p) => p.includes("Meta-paid"))).toBe(false);
  });

  it("includes Meta-paid units in api mode", async () => {
    process.env.META_PAID_MODE = "api";
    const step = await __d2bRouteForTests.build(run, ctx);
    expect(step.units.length).toBeGreaterThan(0);
  });

  it("distributeStage has no HG4 gate step", () => {
    const ids = distributeStage.steps.map((s) => s.id);
    expect(ids).not.toContain("D4-gate");
  });
});
```

> Use the existing fixtures/`ctx` stub already present in `distribute.test.ts` (it exercises `__d2bRouteForTests`/`__d2aSetupForTests`). Match their construction exactly.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/orchestrator/src/stages/distribute.test.ts -t "manual mode"`
Expected: FAIL — Meta-paid still present; `D4-gate` still in steps.

- [ ] **Step 3: Implement — exclude Meta-paid when manual**

In `distribute.ts`, add an import: `import { metaPaidMode } from "../config.js";`

In `d2aSetup.build`, gate the setup planning so manual mode produces no Meta setup:

```ts
const setupPart = metaPaidMode() === "manual"
  ? { setup: [], rowPlans: [], backfills: [], skipped: [], notes: [] }
  : planMetaPaidSetup(run.runId, variants, cells, dailyBudgetMyrFor(run));
```

In `d2bRoute.build`, make the channel guard also drop Meta-paid in manual mode. Replace the `channelOk("Meta-paid")` branch:

```ts
const metaApi = metaPaidMode() === "api";
const rowUnits: RouteUnit[] = [
  ...(metaApi && channelOk("Meta-paid") ? unitsFromPart("Meta-paid", planMetaPaidRows(variants, cells)) : []),
  ...(channelOk("YouTube")      ? unitsFromPart("YouTube",      planYouTube(variants))  : []),
  ...(channelOk("Article")      ? unitsFromPart("Article",      planArticles(articles)) : []),
  ...(channelOk("Meta-organic") ? unitsFromPart("Meta-organic", planOrganic(variants))  : []),
];
```

- [ ] **Step 4: Implement — D3b skip reason for manual Meta-paid**

In `plannerSkipReason` (in `distribute.ts`), add at the top of the `Meta-paid` branch:

```ts
if (channel === "Meta-paid") {
  if (metaPaidMode() === "manual") return "manual posting pack";
  if (!exp.metaSpec) return "Meta spec missing — re-run /produce";
  if (!exp.cellId) return "not assigned to an experiment cell";
}
```

This makes `D3b-summary` record Meta-paid rows as `status: "skipped"` (not `failed`) and keeps `verifyDistribute` green (it already filters planner-skips).

- [ ] **Step 5: Implement — remove HG4**

In `distribute.ts`, change the stage definition to drop `d4Gate`:

```ts
export const distributeStage: StageDefinition = {
  id: "distribute",
  steps: [d1Query, d2aSetup, d2bRoute, d3aConfirm, d3bSummary],
};
```

Leave the `d4Gate` const + `__*ForTests` exports in place only if other tests import them; otherwise delete `d4Gate` and its helpers (`adStatus`, `adRowsOf`) and remove the now-unused `mcp__meta-ads__list_ads` gate check. Grep first: `grep -rn "d4Gate\|D4-gate" packages/orchestrator/src`. Remove dead code that no longer compiles.

- [ ] **Step 6: Run tests to verify pass**

Run: `pnpm vitest run packages/orchestrator/src/stages/distribute.test.ts`
Expected: PASS. Fix any existing test that asserted `D4-gate`/HG4 (update it to the new 5-step stage).

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator/src/stages/distribute.ts packages/orchestrator/src/stages/distribute.test.ts
git commit -m "feat(distribute): manual Meta-paid mode (no API fan-out) + remove HG4 gate"
```

---

## Task 6: `mcp-servers/distribute` MCP server

**Files:**
- Create: `mcp-servers/distribute/package.json`, `tsconfig.json`, `src/index.ts`
- Test: `mcp-servers/distribute/src/index.test.ts`
- Modify: `.mcp.json`

The MCP queries the store, calls `renderPostingPack`, and offers backfill. It is the **agent-loop** surface; the webapp uses the lib directly (Task 7).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@engineerdad/mcp-distribute",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "bin": { "mcp-distribute": "./dist/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@engineerdad/distribute": "workspace:*",
    "@engineerdad/orchestrator": "workspace:*",
    "@engineerdad/store": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.18.1",
    "zod": "^3.23.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

Copy `mcp-servers/meta-organic/tsconfig.json` verbatim.

- [ ] **Step 3: Create a testable assembly helper first (TDD)**

Create `src/build-pack.ts` — the store-reading assembly the tool wraps, so it can be unit-tested without stdio:

```ts
import { store } from "@engineerdad/store";
import { renderPostingPack } from "@engineerdad/distribute";
import type { PostingPackSpec } from "@engineerdad/distribute";
import type { DistVariant, AllocatedCell } from "@engineerdad/orchestrator";

const VARIANT_FIELDS = [
  "title", "format", "aspect", "channels", "assetFiles", "adId",
  "metaPrimaryTextEn", "metaPrimaryTextBm", "metaHeadlineEn", "metaHeadlineBm",
  "metaDescriptionEn", "metaDescriptionBm", "metaCtaType",
];

function projectVariant(row: Record<string, unknown>): DistVariant {
  const s = (k: string) => (typeof row[k] === "string" ? (row[k] as string) : "");
  return {
    rowId: s("id"), variantId: s("id"), format: s("format"), aspect: s("aspect"),
    channels: Array.isArray(row.channels) ? (row.channels as string[]) : [],
    assetFiles: Array.isArray(row.assetFiles) ? (row.assetFiles as { url: string }[]) : [],
    adId: row.adId ?? null, ytVideoId: null,
    metaSpec: (s("metaPrimaryTextEn") || s("metaHeadlineEn"))
      ? {
          primaryTextEn: s("metaPrimaryTextEn"), primaryTextMs: s("metaPrimaryTextBm"),
          headlineEn: s("metaHeadlineEn"), headlineMs: s("metaHeadlineBm"),
          descriptionEn: s("metaDescriptionEn"), descriptionMs: s("metaDescriptionBm"),
          ctaType: s("metaCtaType"), targetingJson: "",
        }
      : null,
    ytSpec: null, cellId: null, fbPostId: null,
    organicScheduledFor: null, organicCaption: null, organicLang: null,
    ...( { title: s("title") } as object ),
  } as DistVariant;
}

function cellsOf(expRow: unknown): AllocatedCell[] {
  if (!expRow || typeof expRow !== "object") return [];
  const raw = (expRow as { cells?: unknown }).cells;
  if (Array.isArray(raw)) return raw as AllocatedCell[];
  if (typeof raw === "string") { try { return JSON.parse(raw) as AllocatedCell[]; } catch { return []; } }
  return [];
}

export async function buildPostingPack(runId: string, dailyBudgetMyr: number): Promise<PostingPackSpec> {
  const variantRows = await store.query("CreativeVariants", { runId, approvalStatus: "Approved" }, { fields: VARIANT_FIELDS });
  const full = await Promise.all(variantRows.map((r) => store.get("CreativeVariants", r.id)));
  const cellId2variant = new Map<string, AllocatedCell>();
  const exps = await store.query("Experiments", { runId }, { fields: ["cells"] });
  const expFull = exps[0] ? await store.get("Experiments", exps[0].id) : null;
  const cells = cellsOf(expFull);
  // attach cellId via the experiment's variantPageIds
  const variants = full.filter(Boolean).map((row) => {
    const v = projectVariant(row as Record<string, unknown>);
    const hit = cells.find((c) => c.variantPageIds.includes(v.variantId));
    return { ...v, cellId: hit ? hit.cellId : null } as DistVariant;
  });
  return renderPostingPack(runId, variants, cells, dailyBudgetMyr);
}

export async function backfillAdId(rowId: string, adIdEn: string | null, adIdMs: string | null) {
  const r = await store.update("CreativeVariants", rowId, { adId: JSON.stringify({ en: adIdEn, ms: adIdMs }) });
  if (!r.ok) throw new Error(r.problems?.join("; ") ?? "backfill failed");
  return { ok: true, rowId };
}
```

Test `src/build-pack.test.ts` — mock `@engineerdad/store`:

```ts
import { describe, it, expect, vi } from "vitest";
vi.mock("@engineerdad/store", () => ({
  store: {
    query: vi.fn(async (entity: string) =>
      entity === "Experiments" ? [{ id: "exp1" }] : [{ id: "row-1" }]),
    get: vi.fn(async (entity: string, id: string) =>
      entity === "Experiments"
        ? { id, cells: [{ cellId: "cell-A", allocationPct: 70, variantPageIds: ["row-1"] }] }
        : {
            id, title: "T1", format: "Feed", aspect: "4:5", channels: ["Meta-paid"],
            assetFiles: [{ url: "https://r2/1.png" }], adId: null,
            metaPrimaryTextEn: "PT", metaHeadlineEn: "H", metaDescriptionEn: "D", metaCtaType: "LEARN_MORE",
            metaPrimaryTextBm: "PTm", metaHeadlineBm: "Hm", metaDescriptionBm: "Dm",
          }),
    update: vi.fn(async () => ({ ok: true })),
  },
}));
import { buildPostingPack, backfillAdId } from "./build-pack.js";

describe("buildPostingPack", () => {
  it("assembles a pack from store rows", async () => {
    const pack = await buildPostingPack("run_1", 10);
    expect(pack.ads).toHaveLength(1);
    expect(pack.ads[0].title).toBe("T1");
    expect(pack.adsets[0].dailyBudgetCents).toBe(700);
  });
  it("backfillAdId writes the adId json", async () => {
    const { store } = await import("@engineerdad/store");
    await backfillAdId("row-1", "111", "222");
    expect(store.update).toHaveBeenCalledWith("CreativeVariants", "row-1", { adId: JSON.stringify({ en: "111", ms: "222" }) });
  });
});
```

- [ ] **Step 4: Run the test (red → green)**

Run: `pnpm vitest run mcp-servers/distribute/src/build-pack.test.ts`
First expect FAIL (no file), then PASS after Step 3 files exist.

- [ ] **Step 5: Create `src/index.ts` (stdio MCP wrapper)**

```ts
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildPostingPack, backfillAdId } from "./build-pack.js";

const server = new McpServer({ name: "distribute", version: "0.1.0" });
const toolResult = (p: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(p, null, 2) }] });
const errorResult = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }] });

server.tool(
  "get_posting_pack",
  "Render the Meta-paid manual posting pack for a run (campaign/adset/ad config + budget + creative asset URLs). Read-only; the user posts these by hand in Ads Manager.",
  { runId: z.string().min(1), dailyBudgetMyr: z.number().nonnegative().default(0) },
  async ({ runId, dailyBudgetMyr }) => {
    try { return toolResult(await buildPostingPack(runId, dailyBudgetMyr)); }
    catch (e) { return errorResult(e); }
  },
);

server.tool(
  "backfill_meta_ids",
  "Record the Meta ad IDs (EN/BM) the user created by hand into CreativeVariants.adId so analytics can join on them.",
  { rowId: z.string().min(1), adIdEn: z.string().nullable(), adIdMs: z.string().nullable() },
  async ({ rowId, adIdEn, adIdMs }) => {
    try { return toolResult(await backfillAdId(rowId, adIdEn, adIdMs)); }
    catch (e) { return errorResult(e); }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 6: Register in `.mcp.json`**

Add inside `mcpServers`:

```json
    "distribute": {
      "command": "node",
      "args": ["--env-file=.env", "--env-file-if-exists=.env.local", "mcp-servers/distribute/dist/index.js"]
    }
```

- [ ] **Step 7: Build + commit**

Run: `pnpm install && pnpm -r --filter='!@engineerdad/webapp' build`

```bash
git add mcp-servers/distribute .mcp.json pnpm-lock.yaml
git commit -m "feat(mcp): distribute server — get_posting_pack + backfill_meta_ids"
```

> After this lands, **restart Claude Code** so the new MCP server loads.

---

## Task 7: Webapp — Meta-paid posting-pack page + backfill action

**Files:**
- Create: `apps/webapp/src/app/lib/posting-pack.ts`
- Modify: `apps/webapp/src/app/lib/actions.ts`
- Create: `apps/webapp/src/app/posting-pack/[runId]/page.tsx`
- Modify: `apps/webapp/src/app/components/LeftNav.tsx`
- Test: `apps/webapp/tests/e2e/posting-pack.spec.ts`

- [ ] **Step 1: Create the data helper (direct package import — NOT MCP)**

`apps/webapp/src/app/lib/posting-pack.ts`:

```ts
import "server-only";
import { store } from "@engineerdad/store";
import { renderPostingPack, type PostingPackSpec } from "@engineerdad/distribute";
import type { DistVariant, AllocatedCell } from "@engineerdad/orchestrator";

const VARIANT_FIELDS = [
  "title", "format", "aspect", "channels", "assetFiles", "adId",
  "metaPrimaryTextEn", "metaPrimaryTextBm", "metaHeadlineEn", "metaHeadlineBm",
  "metaDescriptionEn", "metaDescriptionBm", "metaCtaType",
];

function cellsOf(expRow: unknown): AllocatedCell[] {
  if (!expRow || typeof expRow !== "object") return [];
  const raw = (expRow as { cells?: unknown }).cells;
  if (Array.isArray(raw)) return raw as AllocatedCell[];
  if (typeof raw === "string") { try { return JSON.parse(raw) as AllocatedCell[]; } catch { return []; } }
  return [];
}

export async function getMetaPostingPack(runId: string, dailyBudgetMyr = 0): Promise<PostingPackSpec> {
  const ids = await store.query("CreativeVariants", { runId, approvalStatus: "Approved" }, { fields: VARIANT_FIELDS });
  const rows = (await Promise.all(ids.map((r) => store.get("CreativeVariants", r.id)))).filter(Boolean) as Record<string, unknown>[];
  const exps = await store.query("Experiments", { runId }, { fields: ["cells"] });
  const expFull = exps[0] ? await store.get("Experiments", exps[0].id) : null;
  const cells = cellsOf(expFull);
  const s = (row: Record<string, unknown>, k: string) => (typeof row[k] === "string" ? (row[k] as string) : "");
  const variants: DistVariant[] = rows.map((row) => {
    const vid = s(row, "id");
    const hit = cells.find((c) => c.variantPageIds.includes(vid));
    return {
      rowId: vid, variantId: vid, format: s(row, "format"), aspect: s(row, "aspect"),
      channels: Array.isArray(row.channels) ? (row.channels as string[]) : [],
      assetFiles: Array.isArray(row.assetFiles) ? (row.assetFiles as { url: string }[]) : [],
      adId: row.adId ?? null, ytVideoId: null, cellId: hit ? hit.cellId : null,
      metaSpec: (s(row, "metaPrimaryTextEn") || s(row, "metaHeadlineEn"))
        ? {
            primaryTextEn: s(row, "metaPrimaryTextEn"), primaryTextMs: s(row, "metaPrimaryTextBm"),
            headlineEn: s(row, "metaHeadlineEn"), headlineMs: s(row, "metaHeadlineBm"),
            descriptionEn: s(row, "metaDescriptionEn"), descriptionMs: s(row, "metaDescriptionBm"),
            ctaType: s(row, "metaCtaType"), targetingJson: "",
          }
        : null,
      ytSpec: null, fbPostId: null, organicScheduledFor: null, organicCaption: null, organicLang: null,
      ...({ title: s(row, "title") } as object),
    } as DistVariant;
  });
  return renderPostingPack(runId, variants, cells, dailyBudgetMyr);
}
```

- [ ] **Step 2: Add backfill server actions to `actions.ts`**

Append to `apps/webapp/src/app/lib/actions.ts`:

```ts
export async function backfillAdId(rowId: string, formData: FormData) {
  const adIdEn = (formData.get("adIdEn") as string | null)?.trim() || null;
  const adIdMs = (formData.get("adIdMs") as string | null)?.trim() || null;
  const r = await store.update("CreativeVariants", rowId, { adId: JSON.stringify({ en: adIdEn, ms: adIdMs }) });
  if (!r.ok) throw new Error(r.problems?.join("; ") ?? "backfill failed");
  const runId = formData.get("runId") as string;
  revalidatePath(`/posting-pack/${runId}`);
}

export async function backfillIgPostId(rowId: string, formData: FormData) {
  const igPostId = (formData.get("igPostId") as string | null)?.trim();
  if (!igPostId) throw new Error("igPostId required");
  const r = await store.update("CreativeVariants", rowId, { igPostId });
  if (!r.ok) throw new Error(r.problems?.join("; ") ?? "backfill failed");
  const runId = formData.get("runId") as string;
  revalidatePath(`/posting-pack/organic/${runId}`);
}
```

- [ ] **Step 3: Create the page**

`apps/webapp/src/app/posting-pack/[runId]/page.tsx` (server component; Tailwind; one section per adset, ads as rows, EN/BM blocks, asset link, backfill form binding `backfillAdId`):

```tsx
import { getMetaPostingPack } from "../../lib/posting-pack";
import { backfillAdId } from "../../lib/actions";

export default async function PostingPackPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const pack = await getMetaPostingPack(runId);
  return (
    <main className="p-6 max-w-5xl">
      <h1 className="text-xl font-bold mb-1">Meta-paid posting pack</h1>
      <p className="text-sm text-slate-500 mb-4">Run {runId} · create these in Ads Manager (leave PAUSED), then backfill the ad IDs.</p>

      <section className="mb-6 border rounded p-4 bg-slate-50">
        <h2 className="font-semibold">Campaign</h2>
        <p className="text-sm">Name: <code>{pack.campaign.name}</code> · Objective: <code>{pack.campaign.objective}</code> · Special ad categories: none</p>
      </section>

      {pack.adsets.map((a) => (
        <section key={a.cellId} className="mb-6 border rounded p-4">
          <h2 className="font-semibold">Ad set · {a.name}</h2>
          <p className="text-sm text-slate-600">
            Budget: RM {a.dailyBudgetMyr.toFixed(2)}/day ({a.dailyBudgetCents} cents) · Optimize: {a.optimizationGoal} · Billing: {a.billingEvent} · Bid: {a.bidStrategy}
          </p>
          <p className="text-sm text-slate-600">
            Targeting: {a.targeting.countries.join(", ")} · age {a.targeting.ageMin}–{a.targeting.ageMax} · locales {a.targeting.locales.join(", ")}
          </p>
          {pack.ads.filter((ad) => ad.cellId === a.cellId).map((ad) => (
            <div key={ad.rowId} className="mt-4 border-t pt-3">
              <h3 className="font-medium">{ad.title} <span className="text-xs text-slate-400">({ad.asset.format} {ad.asset.aspect})</span></h3>
              <div className="text-xs mb-2">
                {ad.asset.urls.map((u, i) => (
                  <a key={i} href={u} target="_blank" rel="noreferrer" className="text-blue-600 underline mr-2">asset {i + 1}</a>
                ))}
                · CTA: <code>{ad.ctaType}</code>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><strong>EN</strong><br />{ad.en.headline}<br /><span className="text-slate-600">{ad.en.primaryText}</span><br /><em>{ad.en.description}</em></div>
                <div><strong>BM</strong><br />{ad.bm.headline}<br /><span className="text-slate-600">{ad.bm.primaryText}</span><br /><em>{ad.bm.description}</em></div>
              </div>
              <form action={backfillAdId.bind(null, ad.rowId)} className="mt-2 flex gap-2 items-center text-sm">
                <input type="hidden" name="runId" value={runId} />
                <input name="adIdEn" defaultValue={ad.backfill.adIdEn ?? ""} placeholder="EN ad ID" className="border rounded px-2 py-1" />
                <input name="adIdMs" defaultValue={ad.backfill.adIdMs ?? ""} placeholder="BM ad ID" className="border rounded px-2 py-1" />
                <button className="border rounded px-3 py-1 bg-slate-800 text-white">Save</button>
                {ad.backfill.done && <span className="text-green-600">✓ backfilled</span>}
              </form>
            </div>
          ))}
        </section>
      ))}
      {pack.ads.length === 0 && <p className="text-slate-500">No approved Meta-paid variants for this run.</p>}
    </main>
  );
}
```

- [ ] **Step 4: Add LeftNav entry**

In `LeftNav.tsx`, add below the Dashboard link:

```tsx
<Link href="/runs" className="block py-1 px-2 rounded hover:bg-slate-100 mb-1">Runs</Link>
```

Actually add a dedicated link (keep existing Runs section intact). Insert after the Dashboard `<Link>`:

```tsx
<Link href="/posting-pack/organic/latest" className="block py-1 px-2 rounded hover:bg-slate-100 mb-1">Posting Packs</Link>
```

> Posting packs are run-scoped, so there's no global index; the nav link points users to the runs list. Simpler: change the label to link `/runs` with text "Posting Packs (per run)". Pick whichever reads best; the e2e test navigates by direct URL, not the nav.

- [ ] **Step 5: Write the e2e test**

`apps/webapp/tests/e2e/posting-pack.spec.ts` — seed a run with one approved Meta-paid variant + an experiment (reuse `tests/e2e/fixtures.ts` helpers), then:

```ts
import { test, expect } from "@playwright/test";
import { seedMetaPaidRun } from "./fixtures"; // add this helper mirroring existing seeders

test("renders pack and backfills ad id", async ({ page }) => {
  const runId = await seedMetaPaidRun();
  await page.goto(`/posting-pack/${runId}`);
  await expect(page.getByText("Meta-paid posting pack")).toBeVisible();
  await expect(page.getByText("Ad set ·")).toBeVisible();
  await page.getByPlaceholder("EN ad ID").first().fill("111");
  await page.getByPlaceholder("BM ad ID").first().fill("222");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("✓ backfilled")).toBeVisible();
});
```

> Add `seedMetaPaidRun` to `fixtures.ts` following the existing seed pattern (insert a CreativeVariants row with `approvalStatus:"Approved"`, `channels:["Meta-paid"]`, `metaPrimaryTextEn/Bm`, `metaHeadlineEn/Bm`, `assetFiles`, and an Experiments row whose `cells[0].variantPageIds` includes the variant id).

- [ ] **Step 6: Run e2e + commit**

Run: `pnpm --filter @engineerdad/webapp test:e2e -- posting-pack` (match the repo's e2e script name; check `apps/webapp/package.json`).
Expected: PASS.

```bash
git add apps/webapp/src/app/lib/posting-pack.ts apps/webapp/src/app/lib/actions.ts apps/webapp/src/app/posting-pack/\[runId\]/page.tsx apps/webapp/src/app/components/LeftNav.tsx apps/webapp/tests/e2e/posting-pack.spec.ts apps/webapp/tests/e2e/fixtures.ts
git commit -m "feat(webapp): Meta-paid posting-pack page + ad-id backfill"
```

---

## Task 8: Webapp — organic posting-pack migration (per-run) + retire script

**Files:**
- Create: `apps/webapp/src/app/posting-pack/organic/[runId]/page.tsx`
- Test: `apps/webapp/tests/e2e/posting-pack-organic.spec.ts`
- Delete: `scripts/build-posting-pack.mjs`
- Modify: `.claude/commands/posting-pack.md`

- [ ] **Step 1: Create the organic page**

`apps/webapp/src/app/posting-pack/organic/[runId]/page.tsx` — query the run's IG queue and render caption/hashtags/scene-ordered images + igPostId backfill:

```tsx
import "server-only";
import { store } from "@engineerdad/store";
import { backfillIgPostId } from "../../../lib/actions";

const sceneNum = (url: string) => { const m = url.match(/\/(\d+)\.\w+(?:\?|$)/); return m ? Number(m[1]) : 0; };

export default async function OrganicPackPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const ids = await store.query("CreativeVariants", { runId, organicStatus: "Approved", igPostId: { isNull: true } }, { fields: ["title", "format", "aspect", "assetFiles", "organicLanguage", "organicCaptionEn", "organicCaptionBm", "organicHashtagsIg", "organicScheduledFor"] });
  const rows = (await Promise.all(ids.map((r) => store.get("CreativeVariants", r.id)))).filter(Boolean) as Record<string, unknown>[];
  const posts = rows
    .filter((r) => !(r.format === "Carousel" && r.aspect === "1:1"))
    .map((r) => {
      const lang = String(r.organicLanguage ?? "en").toLowerCase() === "ms" ? "BM" : "EN";
      const caption = lang === "BM" ? (r.organicCaptionBm as string) : (r.organicCaptionEn as string);
      const images = (Array.isArray(r.assetFiles) ? (r.assetFiles as { url: string }[]) : []).map((f) => f.url).sort((a, b) => sceneNum(a) - sceneNum(b));
      return { id: r.id as string, title: r.title as string, lang, caption: caption ?? "", hashtags: Array.isArray(r.organicHashtagsIg) ? (r.organicHashtagsIg as string[]) : [], images, scheduledFor: r.organicScheduledFor ? new Date(r.organicScheduledFor as string).toISOString() : null };
    });
  return (
    <main className="p-6 max-w-3xl">
      <h1 className="text-xl font-bold mb-1">IG organic posting pack</h1>
      <p className="text-sm text-slate-500 mb-4">Run {runId} · post each by hand on IG, then paste the post ID to clear it from the queue.</p>
      {posts.map((p) => (
        <article key={p.id} className="mb-6 border rounded p-4">
          <h2 className="font-semibold">{p.title} <span className="text-xs text-slate-400">{p.lang}{p.scheduledFor ? ` · ${p.scheduledFor.slice(0, 10)}` : ""}</span></h2>
          <div className="flex gap-2 my-2 flex-wrap">
            {p.images.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="h-28 rounded border" /></a>)}
          </div>
          <pre className="whitespace-pre-wrap text-sm">{p.caption}</pre>
          <p className="text-xs text-blue-600">{p.hashtags.join(" ")}</p>
          <form action={backfillIgPostId.bind(null, p.id)} className="mt-2 flex gap-2 text-sm">
            <input type="hidden" name="runId" value={runId} />
            <input name="igPostId" placeholder="IG post ID / URL" className="border rounded px-2 py-1" />
            <button className="border rounded px-3 py-1 bg-slate-800 text-white">Mark posted</button>
          </form>
        </article>
      ))}
      {posts.length === 0 && <p className="text-slate-500">IG queue empty for this run.</p>}
    </main>
  );
}
```

- [ ] **Step 2: Write the e2e test**

`apps/webapp/tests/e2e/posting-pack-organic.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { seedOrganicRun } from "./fixtures"; // insert a CreativeVariants row: organicStatus "Approved", igPostId null, organicCaptionEn, assetFiles, format "Feed"

test("renders organic queue and marks posted", async ({ page }) => {
  const runId = await seedOrganicRun();
  await page.goto(`/posting-pack/organic/${runId}`);
  await expect(page.getByText("IG organic posting pack")).toBeVisible();
  await page.getByPlaceholder("IG post ID / URL").first().fill("ig_123");
  await page.getByRole("button", { name: "Mark posted" }).first().click();
  await expect(page.getByText("IG queue empty for this run.")).toBeVisible();
});
```

- [ ] **Step 3: Run e2e**

Run: `pnpm --filter @engineerdad/webapp test:e2e -- posting-pack-organic`
Expected: PASS.

- [ ] **Step 4: Retire the script + command**

```bash
git rm scripts/build-posting-pack.mjs
```

Replace `.claude/commands/posting-pack.md` body with a pointer:

```markdown
---
description: The IG organic posting pack moved into the webapp (per-run). Open http://localhost:3030/posting-pack/organic/<runId> to view the queue and mark posts done. The old R2-HTML script (scripts/build-posting-pack.mjs) is retired.
allowed-tools:
---

The posting pack is now a webapp page. Tell the user to open
`http://localhost:3030/posting-pack/organic/<runId>` for IG organic, and
`http://localhost:3030/posting-pack/<runId>` for the Meta-paid manual pack.
```

> The R2 object `posting/pack-4e8a1f6b2d9c.html` can be deleted from the bucket manually; it is now orphaned. (No code references it after this task.)

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/app/posting-pack/organic/\[runId\]/page.tsx apps/webapp/tests/e2e/posting-pack-organic.spec.ts apps/webapp/tests/e2e/fixtures.ts .claude/commands/posting-pack.md
git commit -m "feat(webapp): migrate IG organic posting pack to per-run page; retire R2-HTML script"
```

---

## Task 9: Docs, doctrine, and HG4 amendment

**Files:**
- Modify: `ARCHITECTURE.md`, `CLAUDE.md`
- Modify: `.claude/commands/loop.md`, `distribute.md`, `experiment.md`
- Modify: `docs/decisions/015-write-api-safety.md`
- Modify: `TASKS.md`, `DONE.md`, `.env.example`

- [ ] **Step 1: ARCHITECTURE.md**

- Update the loop diagram: change `distribute →[HG4]` to `distribute` (no HG4); update the human-gate count from four to three (HG1–HG3).
- In the stage table, change the distribute row's gate cell from `HG4` to `—` and add a note: "Meta-paid: manual posting pack (webapp) when `META_PAID_MODE=manual`."
- Add `distribute` to the MCP server list (now N servers).

- [ ] **Step 2: CLAUDE.md**

Update the loop line to drop `[HG4]`:

```
... produce → [HG3] → schedule → experiment → distribute. /reflect closes the loop afterward.
```

- [ ] **Step 3: Command docs**

In `loop.md`, `distribute.md`, `experiment.md`: remove "Stops at HUMAN GATE 4" wording; state that distribute completes without a gate and that Meta-paid produces a manual posting pack at `/posting-pack/<runId>`.

- [ ] **Step 4: ADR-015 amendment**

Append an "Amendment (2026-05-30)" section to `docs/decisions/015-write-api-safety.md`:

```markdown
## Amendment — 2026-05-30: spend gate under manual mode (META_PAID_MODE)

Meta business-entity verification blocks API ad creation. Until it clears, the
default `META_PAID_MODE=manual` makes distribute render a **manual posting pack**
(webapp `/posting-pack/<runId>`) instead of creating ads via API. In manual mode
there is no API spend to gate, so HG4 is removed from the distribute stage. The
spend gate's intent is preserved: ads are created — and later activated — by the
human in Ads Manager. The no-auto-activate invariant is unchanged (the OS never
sets ACTIVE). When verification clears, set `META_PAID_MODE=api`; the create path
still hard-wires PAUSED. Note: removing HG4 also un-gates YouTube (unlisted) and
Meta-organic (scheduled publish) dispatch — both remain safe, non-public states.
```

- [ ] **Step 5: TASKS/DONE + env**

- `DONE.md`: record this feature; close B-005 (organic pack migrated to webapp).
- `TASKS.md`: remove/refresh any B-005 open entry; refresh the Status header.
- `.env.example`: add `META_PAID_MODE=manual   # api|manual — manual renders the webapp posting pack instead of creating Meta ads via API`.

- [ ] **Step 6: Commit**

```bash
git add ARCHITECTURE.md CLAUDE.md .claude/commands/loop.md .claude/commands/distribute.md .claude/commands/experiment.md docs/decisions/015-write-api-safety.md TASKS.md DONE.md .env.example
git commit -m "docs: HG4 removal + manual Meta-paid mode (ADR-015 amendment, loop/architecture sync)"
```

---

## Final verification

- [ ] `pnpm -r build` (sequential) succeeds with no type errors.
- [ ] `pnpm vitest run` — all package unit tests green.
- [ ] `pnpm --filter @engineerdad/webapp test:e2e` — posting-pack + organic specs green.
- [ ] `pnpm sync:agents:check` passes (no agent-prompt drift).
- [ ] Manual smoke: with `META_PAID_MODE=manual`, drive a run to distribute; confirm it completes with no HG4, Meta-paid Distributions rows are `skipped` ("manual posting pack"), and `/posting-pack/<runId>` renders the table; backfill an ad ID and confirm ✓.
- [ ] **Restart Claude Code** (new `distribute` MCP) before any agent-driven walk.
