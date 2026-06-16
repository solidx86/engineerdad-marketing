# UT Objection & Myth Corpus Implementation Plan

> **STATUS: COMPLETE (2026-06-15).** All tasks shipped — Phase 1 schema, Phase 2 (5 dataset+chart pairs + CPI/regulatory/EPF-age/SPIVA), Phase 3 (24 entries: 5 Tier-0, 11 Tier-1, 8 Tier-2), Phase 4 (`corpus-lint`, proof-index, reindex + tier-filter smoke-test). Task 14 (optional owned-data charts) deliberately deferred. Verification: `corpus-lint` 0 FAIL; reindex 226 chunks; tier filter discriminates (necessity→d0, substitution→∅ for "afford").

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a 24-entry, 3-tier objection/myth corpus family (`d-*`, `cluster: objection`) plus 5 grounded dataset+chart pairs, so future content generation has every claim pre-bound to a cited fact.

**Architecture:** New `funnel_tier` frontmatter field + `objection` cluster value wired through the corpus parser/indexer/search. Content ships as flat `d0/d1/d2-*.md` knowledge entries that lean on owned proof via `related:` and on charts via their `Used by` line. Five new datasets/charts are sourced in a grounding pass; eight existing charts are annotated for reuse. **Hard doctrine: no figure from model memory — every number resolves to a citation, or the artifact is not written.**

**Tech Stack:** TypeScript (corpus package + MCP server, vitest), Markdown knowledge entries, JSON datasets, YAML chart specs.

**Source spec:** `docs/superpowers/specs/2026-06-06-ut-objection-corpus-design.html`

---

## Conventions for every content task

- **Grounding gate:** A dataset/chart/entry that depends on an external figure may only be written *after* that figure is fetched from its authoritative source (spec §7) and the citation recorded in the artifact. If a figure cannot be sourced, leave the artifact unwritten and note the blocker in the commit message — **never substitute a remembered or estimated number.**
- **EPF/ASB/FD comparison guardrail** (FIMM/SC — `corpus/compliance/sc-malaysia.md:118-133`, `banned-phrases.yaml` H-section): any entry/chart touching EPF/ASB/FD is a **balanced category-error correction, never a returns bake-off**. Never claim/imply UT is "safer than" or "beats" EPF/ASB; **always acknowledge EPF's guaranteed minimum dividend (EPF Act 1991 §27)**. Affects `d1-cant-beat-fd-asb-epf`, `d1-epf-already-invests`, `d2-just-use-epf-iinvest`, and `risk-return-positioning.yaml`.
- **Comparison compliance — ALL product comparisons, not just EPF/ASB (SC App.1 §I1a–c, §H2):** Tasks 3, 4, 5, 6, 7 are product comparisons. Every comparison chart caption must (a) state where the compared products differ in structure/features (this is a cost-only or positioning comparison, not a suitability ranking); (b) concede the compared product's genuine advantage; (c) date every figure ("as at <date>"); (d) never pick a time window to flatter UT — performance windows use the factsheet-published standard periods (1y/3y/5y/10y), the chosen window is named, and the caption notes that other windows differ (App.1 §H2 anti-cherry-picking).
- **Volatile-figure dating:** any third-party figure that can change without notice (robo fee tiers, i-Invest caps, broker FX spreads) carries a fetched-on date in the dataset `notes` plus a `volatility` field (`"variable"`); stable statutory facts (EPF §27 floor) use `"stable"`. A `volatility: "variable"` figure older than 12 months at content-generation time should be re-verified before reuse.
- **Blocker handling (grounded-truth escalation):** if a source is unreachable or the figure is not published, do NOT write the artifact and do NOT substitute an estimate. Note the blocker in the commit message (`[BLOCKED] Task N: <fact> — <source>: <reason>`) and **escalate to the user for explicit help** — per user instruction 2026-06-11: web-source autonomously, but ask when grounded truth cannot be reliably obtained.
- **Bilingual:** Entries draft EN first, `lang_status: en_only`. Charts carry `*_en` and `*_ms` fields (BM caption required, matching existing chart files).
- **Reindex after content:** `corpus/.index/` is gitignored; run reindex (Task 16) at the end, not per-entry.
- **Commit cadence:** one commit per task unless a task says otherwise. Push after each (project rule: never leave dangling local commits).

---

## PHASE 1 — Schema wiring (code)

### Task 1: Add `objection` cluster + `funnel_tier` field to the frontmatter parser

**Files:**
- Modify: `packages/corpus/src/frontmatter.ts`
- Test: `packages/corpus/src/frontmatter.test.ts` (create if absent)

- [x] **Step 1: Write the failing test**

Add to `packages/corpus/src/frontmatter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "./frontmatter.js";

describe("objection cluster + funnel_tier", () => {
  it("parses cluster: objection and funnel_tier", () => {
    const raw = `---
cluster: objection
funnel_tier: necessity
granularity: concept
source_type: public
---
body`;
    const fm = parseFrontmatter(raw);
    expect(fm.cluster).toBe("objection");
    expect(fm.funnel_tier).toBe("necessity");
  });

  it("rejects an invalid funnel_tier", () => {
    const raw = `---
funnel_tier: bogus
---
body`;
    expect(parseFrontmatter(raw).funnel_tier).toBeUndefined();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/corpus/src/frontmatter.test.ts`
Expected: FAIL — `cluster` is `undefined` (objection not in set) and `funnel_tier` not a known property.

- [x] **Step 3: Implement the parser changes**

In `packages/corpus/src/frontmatter.ts`:

Add the type and extend `Cluster`:

```typescript
export type Cluster = "mechanics" | "tax" | "portfolio" | "primitive" | "objection";
export type FunnelTier = "necessity" | "avoidance" | "substitution";
```

Add `funnel_tier` to the interface (after `granularity`):

```typescript
export interface CorpusFrontmatter {
  cluster?: Cluster;
  funnel_tier?: FunnelTier;
  granularity?: Granularity;
  source_type?: SourceType;
  source_ref?: string;
  verified_at?: string;
  related?: string[];
  lang_status?: LangStatus;
}
```

Extend the value sets:

```typescript
const CLUSTER_VALUES = new Set<Cluster>(["mechanics", "tax", "portfolio", "primitive", "objection"]);
const FUNNEL_TIER_VALUES = new Set<FunnelTier>(["necessity", "avoidance", "substitution"]);
```

Add the parse case (after the `cluster` case):

```typescript
      case "funnel_tier":
        if (FUNNEL_TIER_VALUES.has(value as FunnelTier)) out.funnel_tier = value as FunnelTier;
        break;
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/corpus/src/frontmatter.test.ts`
Expected: PASS (both tests).

- [x] **Step 5: Commit & push**

```bash
git add packages/corpus/src/frontmatter.ts packages/corpus/src/frontmatter.test.ts
git commit -m "feat(corpus): add objection cluster + funnel_tier frontmatter field"
git push
```

---

### Task 2: Propagate `funnel_tier` through chunks, search filter, and the MCP schema

**Files:**
- Modify: `packages/corpus/src/chunk.ts`
- Modify: `packages/corpus/src/tools.ts`
- Modify: `mcp-servers/corpus/src/index.ts`
- Test: `packages/corpus/src/tools.test.ts`

- [x] **Step 1: Write the failing test**

Add to `packages/corpus/src/tools.test.ts` a case that indexes an `objection` entry with `funnel_tier: necessity` and filters search by it. Mirror the existing `tools.test.ts` setup (it writes a `knowledge/*.md` to a tmp dir, reindexes, then searches). Add:

```typescript
it("filters search by funnel_tier", async () => {
  // (reuse the suite's tmp-dir + reindex harness; write an entry with
  //  cluster: objection, funnel_tier: necessity, body mentioning "afford")
  const res = await search({ query: "afford", funnel_tier: "necessity" });
  expect(res.results.length).toBeGreaterThan(0);
  expect(res.results.every((r) => r.funnel_tier === "necessity")).toBe(true);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/corpus/src/tools.test.ts`
Expected: FAIL — `funnel_tier` is not an accepted `search` input nor a returned field.

- [x] **Step 3: Implement chunk propagation**

In `packages/corpus/src/chunk.ts`, add to the `Chunk` interface (after the `cluster` line, ~line 12):

```typescript
  funnel_tier?: CorpusFrontmatter["funnel_tier"];
```

and in the chunk object literal (after `cluster: frontmatter?.cluster,`, ~line 110):

```typescript
        funnel_tier: frontmatter?.funnel_tier,
```

- [x] **Step 4: Implement search filter**

In `packages/corpus/src/tools.ts`:

Add to both the search-input interface and the result-item interface (alongside `cluster?: Cluster;`):

```typescript
  funnel_tier?: import("./frontmatter.js").FunnelTier;
```

(Or import `FunnelTier` at the top and use it bare, matching the file's existing import style for `Cluster`.)

Add the filter predicate (next to the `cluster` filter, ~line 57):

```typescript
    if (input.funnel_tier && c.funnel_tier !== input.funnel_tier) return false;
```

Add to the result mapping (next to `cluster: c.cluster,`, ~line 75):

```typescript
        funnel_tier: c.funnel_tier,
```

- [x] **Step 5: Implement MCP schema + description**

In `mcp-servers/corpus/src/index.ts`:

Update the cluster enum (line ~48) and add funnel_tier (line ~49 area):

```typescript
    cluster: z.enum(["mechanics", "tax", "portfolio", "primitive", "objection"]).optional(),
    funnel_tier: z.enum(["necessity", "avoidance", "substitution"]).optional(),
    granularity: z.enum(["concept", "fund"]).optional(),
```

Update the tool description string (line ~42) to read: `… cluster (mechanics | tax | portfolio | primitive | objection), funnel_tier (necessity | avoidance | substitution), granularity (concept | fund), …`.

- [x] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run packages/corpus/src/tools.test.ts`
Expected: PASS.

- [x] **Step 7: Build (sequential — never parallel) & commit**

```bash
pnpm -r --filter='!@engineerdad/webapp' build
git add packages/corpus/src mcp-servers/corpus/src/index.ts
git commit -m "feat(corpus): wire funnel_tier through chunks, search filter, MCP schema"
git push
```

> **After this lands, restart Claude Code** so the corpus MCP registry reloads the new `funnel_tier` filter (in-memory MCP registry freezes at session start).

---

## PHASE 2 — Grounding pass: new datasets + charts (the 5 gated pairs)

> Each task here = **fetch the fact from its authoritative source → write the dataset JSON with the citation → write the chart YAML**. Use WebFetch against the source named in spec §7 (Playwright MCP browser when plain fetch is bot-blocked — the KWSP precedent). If a source is unreachable or the figure is not published, **stop, record the blocker, and escalate to the user** rather than inventing a value.
>
> **Execution order: Task 8 (DOSM CPI) runs FIRST** — the shipped entry `d0-saving-is-enough` depends on it (SC §5.01(b) current-and-accurate). Then Tasks 3–7, then 8c.

**Dataset JSON shape** (all new datasets follow this; mirror `corpus/data/epf-dividend-history.json`):

```json
{
  "verified_at": "YYYY-MM-DD",
  "verification_status": "verified",
  "source": "<authority name + URL + what was read>",
  "notes": "<what the numbers are, units, any assumption flagged as assumption>",
  "data": [ /* rows */ ]
}
```

**Chart YAML shape** (all new charts follow this; mirror `corpus/data/charts/inflation-vs-savings-real-value.yaml`): leading comment block with `Source:` (→ the dataset) and `Used by media-production when scene argues "<hook>"`; then `id`, `title_en/ms`, `chart_type`, axis labels, `labels`, `series` (each with `name_en/ms`, `semantic_role`, `values`), `caption_en/ms`, `source_citation`.

### Task 3: ETF true-cost stack (serves T2-1, T2-7)

**Files:**
- Create: `corpus/data/etf-cost-comparison.json`
- Create: `corpus/data/charts/true-cost-stack-ut-vs-etf.yaml`

- [x] **Step 1: Source the facts** (WebFetch): QQQ TER + SPY TER (Invesco / State Street official factsheets); US dividend withholding rate for Malaysian residents and confirmation there is **no** US–Malaysia tax treaty reducing it (IRS Pub 515 / treaty table); MYR→USD conversion cost stated as **BNM published reference rate + a named broker's retail markup above it** (cite both; never present the BNM mid-rate as the investor-facing cost). Record each URL.
- [x] **Step 1a: Source the US estate-tax exposure fact** (required by spec §7 for T2-7): the USD 60,000 US-situs estate threshold for non-resident aliens (IRC §2102(b) / IRS instructions for Form 706-NA). Record the statute/section + URL, and note there is no US–Malaysia estate-tax treaty relief.
- [x] **Step 2: Write `etf-cost-comparison.json`** with a `data` array of cost components (TER, sales charge for the UT side from owned `a-fee-schedule.md`, dividend-withholding drag, forex spread, estate-tax exposure as a non-annualised risk row) for both the DIY-ETF route and the UT route, each row carrying its own source. `verification_status: "verified"` only if every external figure was fetched this task.
- [x] **Step 3: Write `true-cost-stack-ut-vs-etf.yaml`** — `chart_type: bar`, stacked cost components; `series` hero = "UT all-in cost", comparison = "DIY ETF all-in cost"; `Used by … "fees are minimal", "ETF TER is basically free", "the real cost of going direct"`. `source_citation` lists every figure's origin. **Caption mandate (Conventions: comparison compliance):** disclose that UT and DIY ETF differ in structure (custody, advice/service, Shariah option, estate handling), that this is a cost-only comparison not a suitability ranking, concede the ETF's genuine TER advantage, and date every figure.
- [x] **Step 4: Verify no unsourced number**

Run: `grep -nE "[0-9]" corpus/data/etf-cost-comparison.json` and confirm every numeric row has a `source`/citation trail in the file.

- [x] **Step 5: Commit & push**

```bash
git add corpus/data/etf-cost-comparison.json corpus/data/charts/true-cost-stack-ut-vs-etf.yaml
git commit -m "data(corpus): ETF true-cost-stack dataset + chart (sourced)"
git push
```

### Task 4: USD return vs MYR-adjusted return (serves T2-3)

**Files:**
- Create: `corpus/data/us-vs-my-returns.json`
- Create: `corpus/data/charts/usd-return-vs-myr-adjusted.yaml`

- [x] **Step 1: Source** (WebFetch): QQQ and/or SPY trailing CAGR using **only the factsheet-published standard periods (5y AND 10y — never a custom window; SC App.1 §H2)** (official factsheet); FBM KLCI total-return over the same standard periods (Bursa / index provider); MYR/USD rate at each window's start and end (BNM published rates). Record URLs + the exact periods and as-at dates.
- [x] **Step 2: Write `us-vs-my-returns.json`** — rows for USD-denominated return, the MYR/USD change, and the MYR-adjusted return (USD return net of the currency move), plus the KLCI comparator — **for both the 5y and 10y standard periods**. Each figure cited. Note the windows and as-at dates explicitly.
- [x] **Step 3: Write `usd-return-vs-myr-adjusted.yaml`** — `chart_type: bar`; series hero = "MYR-adjusted return (what a Malaysian actually keeps)", comparison = "Headline USD return", floor = "KLCI same window"; `Used by … "QQQ/SPY crushes Malaysian funds", "US returns are better", "forex doesn't matter"`. **Caption mandate:** name the period shown, state that the alternative standard period is also in the dataset and that different windows give different results, concede the US market's genuine long-run strength, and never imply the MYR adjustment makes UT "win" — the point is the ignored forex variable, not a ranking.
- [x] **Step 4: Commit & push** (`data(corpus): US-vs-MY returns + forex dataset + chart (sourced)`).

### Task 5: Sales charge by channel (serves T2-4, T2-6)

**Files:**
- Create: `corpus/data/sales-charge-by-channel.json`
- Create: `corpus/data/charts/sales-charge-by-channel.yaml`

- [x] **Step 1: Source** (WebFetch): EPF i-Invest sales-charge cap and eligibility/withdrawal caps (KWSP i-Invest pages). Agent/OTC and online charges come from owned `a-sales-charge-math.md` — cite the owned entry, do not refetch.
- [x] **Step 2: Write `sales-charge-by-channel.json`** — rows: agent/OTC, online/PMO, EPF i-Invest, each with its charge and source.
- [x] **Step 3: Write `sales-charge-by-channel.yaml`** — `chart_type: bar`; hero = i-Invest (lowest), comparison = agent; `Used by … "5% sales charge is robbery", "just use EPF i-Invest", "the charge depends on the channel"`. **Caption mandate:** the channels differ in what they include (agent service/advice vs self-serve; i-Invest's eligibility + withdrawal caps) — disclose this so the chart reads as "the charge buys different things", not "agents overcharge"; date the figures and flag i-Invest caps `volatility: "variable"`.
- [x] **Step 4: Commit & push** (`data(corpus): sales-charge-by-channel dataset + chart (sourced)`).

### Task 6: Robo-advisor fee/feature comparison (serves T2-5)

**Files:**
- Create: `corpus/data/robo-fee-tiers.json`
- Create: `corpus/data/charts/robo-vs-ut-cost-feature.yaml`

- [x] **Step 1: Source** (WebFetch): StashAway and Versa published management-fee tiers (their pricing pages). Note the date fetched and set `volatility: "variable"` (robo fees change without notice).
- [x] **Step 2: Write `robo-fee-tiers.json`** — fee tiers per provider + a one-line note on the engine (global ETF portfolios) and that they carry no PRS tax-relief wrapper (cite owned `b-relief-stacking.md` for the relief side).
- [x] **Step 3: Write `robo-vs-ut-cost-feature.yaml`** — `chart_type: bar` on annual fee; `Used by … "robo-advisors do it cheaper", "StashAway/Versa is the same thing"`. Caption must concede the fee point and pivot to the relief/Shariah/engine difference.
- [x] **Step 4: Commit & push** (`data(corpus): robo fee tiers dataset + chart (sourced)`).

### Task 7: Risk–return positioning vs FD/ASB/EPF (serves T1-5)

**Files:**
- Create: `corpus/data/asb-asnb-returns.json`
- Create: `corpus/data/charts/risk-return-positioning.yaml`

> **Compliance (FIMM/SC — verified `corpus/compliance/sc-malaysia.md:118-133`, `banned-phrases.yaml` H-section).** This is a **positioning** chart, not a returns bake-off. ASB is principal-stable/near-guaranteed — a bar where an equity fund towers over ASB/EPF breaches SC App.1 §I1a ("sufficiently similar features") and §I1b (undue prominence). The chart must plot **risk against return** (different tiers do different jobs), and the caption must **acknowledge EPF's guaranteed minimum dividend (EPF Act 1991 §27)** and ASB's principal stability. Never imply UT is "safer than" or "beats" EPF/ASB.

- [x] **Step 1: Source** (WebFetch): ASB/ASNB historical declared returns (ASNB). EPF rates come from owned `epf-dividend-history.json`; the qualified-fund alpha from owned `fund-universe-stats-snapshot.md` — cite both, do not refetch.
- [x] **Step 2: Write `asb-asnb-returns.json`** — ASB declared returns by year, cited.
- [x] **Step 3: Write `risk-return-positioning.yaml`** — plot **risk (x) × return (y)** placing FD/ASB/EPF (lower-risk, capital-stable) and a risk-matched equity-fund band in their distinct tiers; caption stresses the **category-error correction** (match the instrument to the goal/horizon, don't compare equity to a near-guaranteed instrument) and acknowledges the EPF §27 guaranteed minimum + ASB principal stability. `Used by … "UT can't even beat FD/ASB/EPF" (as a category-error correction, never a 'UT wins' claim)`.
- [x] **Step 4: Commit & push** (`data(corpus): risk-return positioning dataset + chart (sourced, compliance-framed)`).

### Task 8: Re-ground inflation chart + capture non-chart regulatory facts — **RUNS FIRST in Phase 2**

**Files:**
- Create: `corpus/data/my-cpi-inflation.json`
- Modify: `corpus/data/charts/inflation-vs-savings-real-value.yaml`
- Modify: `corpus/knowledge/d0-saving-is-enough.md` (shipped entry — same commit)
- Create: `corpus/data/regulatory-facts.json`

- [x] **Step 1: Source** (WebFetch): Malaysian CPI / inflation series (DOSM); FIMM/SC licensing + trustee-custody structure (FIMM / SC); confirmation that **PIDM does not cover unit trusts** (PIDM). Record URLs.
- [x] **Step 2: Write `my-cpi-inflation.json`** with the DOSM series, cited. Include a long-run average over a **named window** (e.g. trailing 10y/15y) computed from the sourced series — state the window and the arithmetic in `notes`.
- [x] **Step 3: Re-ground `inflation-vs-savings-real-value.yaml`** against the sourced CPI average. If the sourced long-run CPI differs from the current 5% assumption (it will — DOSM headline CPI runs lower), **recompute the real-value series from the sourced figure** and update values + captions; name the CPI window in the caption. Keeping 5% is only allowed if the caption reframes it as an explicitly-labelled stress assumption alongside the sourced base case. The data-driven brand survives a weaker story; it does not survive an invented one.
- [x] **Step 3a: Update the shipped `d0-saving-is-enough.md` in the same commit** — `source_ref` cites `my-cpi-inflation.json`; add `my-cpi-inflation` to `related:`; update every quoted RM/percentage figure in the body to match the re-grounded chart. The corpus must never hold two conflicting versions of the same figure (SC §5.01(b)).
- [x] **Step 4: Write `regulatory-facts.json`** — structured facts: regulator (SC), self-regulatory body (FIMM), trustee custody model, PIDM-not-covered, each cited. (No chart — these back T1-2/T1-3 entries as prose.)
- [x] **Step 5: Commit & push** (`data(corpus): MY CPI + regulatory facts; re-ground inflation chart + d0-saving-is-enough`).

---

### Task 8b: Replace the EPF age-banded RIA schedule (serves T0-15, resolves a needs_review flag)

**Files:**
- Modify: `corpus/data/kwsp-ria-benchmarks.json`
- Create: `corpus/data/charts/epf-savings-by-age.yaml`

> **✅ DONE 2026-06-07.** Source: KWSP Table 1 "New Basic, Adequate and Enhanced Savings Levels" (https://www.kwsp.gov.my/en/w/epf-releases-belanjawanku-2024/2025-and-retirement-income-adequacy-framework), full age 18-60 extracted via headless browser (WebFetch/curl returned 403; Playwright loaded it). No screenshot transcription.

- [x] **Step 1:** Added `savings_schedule_by_age` (age 18-60, basic/adequate/enhanced) to `kwsp-ria-benchmarks.json`; `verified_at` → 2026-06-07; `verification_status` → `verified`; notes updated; phase-in corrected to the official 5-step (RM240k → +30k/yr → RM390k by 2030). **Legacy `tiers` array left UNCHANGED** to avoid breaking `scripts/harvest-epf-simulations.mjs` (reads `tiers[].age` + `tiers[].ria_balance_rm`).
- [x] **Step 2:** Wrote `corpus/data/charts/epf-savings-by-age.yaml` — `chart_type: line`, x=age (5-yr marks 18-60), hero=Adequate, comparison=Enhanced, floor=Basic; caption carries the today's-ringgit / inflation caveat.
- [x] **Step 3 (at entry-authoring):** Point `d0-epf-will-cover-me`'s `related:` at `epf-savings-by-age` (age-banded = stronger TOFU visual) in addition to `epf-baseline-tiers`.
- [x] **Step 4: Committed & pushed.**

### Task 8c: SPIVA + behaviour-gap evidence (serves T2-2 steelman, T2-8)

**Files:**
- Create: `corpus/data/spiva-behaviour-gap.json`

> Spec §7 requires "SPIVA active-vs-index (MY / regional)" for T2-2/T2-8 and "behaviour / return-gap evidence" (cite-with-caveat) — neither was assigned to a Phase-2 task. Without SPIVA, `d2-just-dca-the-index`'s steelman concession ("most active funds do lag the index") would be an unsourced claim.

- [x] **Step 1: Source** (WebFetch): the latest S&P SPIVA scorecard — regional (if a Malaysia/Asia ex-Japan cut is published) else global, with the regional caveat noted; plus one named behaviour-gap study (e.g. Morningstar "Mind the Gap" or DALBAR QAIB) for the investor-return-vs-fund-return gap, cited with its methodology caveat. Record URLs + report editions.
- [x] **Step 2: Write `spiva-behaviour-gap.json`** — the SPIVA underperformance percentages by horizon (named edition), and the behaviour-gap figure (named study + period). Both flagged `volatility: "stable"` but edition-dated. No chart in v1 — these back entry prose.
- [x] **Step 3: Commit & push** (`data(corpus): SPIVA + behaviour-gap evidence (sourced)`).

## PHASE 3 — Annotate reuse charts + author entries

### Task 9: Annotate the 8 existing reuse charts

**Files (modify the leading `Used by` comment only):**
- `corpus/data/charts/coffee-to-compound.yaml`, `compounding-30y.yaml`, `start-age-penalty.yaml`, `inflation-vs-savings-real-value.yaml`, `target-by-budget.yaml`, `epf-baseline-tiers.yaml`, `dca-vs-lump.yaml`, `panic-sell-vs-hold.yaml`, `single-country-vs-global.yaml`, `alpha-vs-return.yaml`

- [x] **Step 1:** For each chart, append the matching objection hook(s) to its `Used by` comment line, per spec §8 reuse table. Example for `start-age-penalty.yaml`: append `…, "I'll start later", "when I'm more settled" (objection myth d0-start-later)`.
- [x] **Step 2: Commit & push** (`docs(corpus): annotate reuse charts with objection-myth hooks`).

### Entry template (used by Tasks 10–12)

Every `d-*` entry uses this exact body structure:

```markdown
---
cluster: objection
funnel_tier: <necessity|avoidance|substitution>
granularity: concept
source_type: <public|synthesized>
source_ref: "<citation(s) for every figure used; name the dataset/chart/owned entry>"
verified_at: 2026-06-07
lang_status: en_only
related: [<owned-proof-entry>, <chart-id-or-dataset>, ...]
---

# <Myth, stated as the saver would say it>

> <one-line compliance framing: describes mechanics/trade-offs, not advice; figures dated; nothing here is personalised advice>

## English

### The myth
<the objection in the saver's own words>

### The true part
<the steelman concession — the part that is genuinely correct>

### The variable it ignores
<the turn; every figure cites its dataset/chart/owned entry>

### Who it changes the answer for
<the saver-segment for whom the answer flips>
```

### Task 10: Author Tier-0 (Necessity) entries — 5

**Files (create):** `corpus/knowledge/d0-cant-afford-to-start.md`, `d0-start-later.md`, `d0-saving-is-enough.md`, `d0-investing-is-for-the-rich.md`, `d0-epf-will-cover-me.md`

- [x] **Step 1:** Author each entry using the template. `funnel_tier: necessity`. Parameter table:

| File | Myth line | `related:` | Key cited figure source |
|---|---|---|---|
| d0-cant-afford-to-start | "I don't earn enough to invest" | `[fund-public-regularsavings, coffee-to-compound, compounding-30y]` | RM100 min (owned), compounding-table.json |
| d0-start-later | "I'll start later, when I'm settled" | `[epf-shortfall-cases, start-age-penalty]` | start-age-penalty chart |
| d0-saving-is-enough | "Saving / FD is enough — investing is optional" | `[inflation-vs-savings-real-value, my-cpi-inflation]` | my-cpi-inflation.json |
| d0-investing-is-for-the-rich | "Investing is for rich people, not someone like me" | `[epf-shortfall-cases, coffee-to-compound, target-by-budget]` | RM100 min, epf-shortfall-cases |
| d0-epf-will-cover-me | "EPF / government will take care of me" | `[epf-shortfall-cases, epf-savings-by-age, epf-baseline-tiers]` | epf-savings-by-age chart (age-banded RIA schedule, sourced) — **today's-ringgit targets; 20-yr horizon needs inflation-adjustment upward (caveat in chart caption)** |

- [x] **Step 2: Commit & push** (`content(corpus): Tier-0 necessity objection entries (5)`).

### Task 11: Author Tier-1 (Avoidance) entries — 11

**Files (create):** `d1-agents-just-churn.md`, `d1-ut-is-a-scam.md`, `d1-can-lose-everything.md`, `d1-sales-charge-instant-loss.md`, `d1-cant-beat-fd-asb-epf.md`, `d1-money-locked-in.md`, `d1-need-a-lot-to-start.md`, `d1-past-performance-meaningless.md`, `d1-epf-already-invests.md`, `d1-too-complicated.md`, `d1-shariah-just-marketing.md`

- [x] **Step 1:** Author each using the template. `funnel_tier: avoidance`. Parameter table:

| File | Myth line | `related:` | Key cited figure source |
|---|---|---|---|
| d1-agents-just-churn | "Agents just churn you for commission" | `[a-switching-matrix, a-scenario-double-charged]` | owned switching entries |
| d1-ut-is-a-scam | "UT is basically a scam like forex-MLM" | `[regulatory-facts]` (`source_type: public`) | regulatory-facts.json (FIMM/SC/trustee) |
| d1-can-lose-everything | "You can lose everything — it's gambling" | `[c-risk-metric-glossary, regulatory-facts]` | FVC tiers (owned), PIDM-not-covered (regulatory-facts) |
| d1-sales-charge-instant-loss | "Sales charge = I start down 5%, guaranteed loss" | `[a-sales-charge-math, sales-charge-by-channel, d2-sales-charge-robbery]` | sales-charge-by-channel chart — **overlap rule: this entry's turn is amortization over holding period ONLY (one-off charge spread across years held); leave the channel comparison entirely to d2-sales-charge-robbery** |
| d1-cant-beat-fd-asb-epf | "UT can't even beat FD/ASB/EPF" | `[fund-universe-stats-snapshot, epf-dividend-history, risk-return-positioning]` | risk-return-positioning chart — **frame as category-error correction; acknowledge EPF §27 guaranteed minimum; never "safer/beats"** |
| d1-money-locked-in | "My money gets locked in / hard to withdraw" | `[a-nav-cutoff-settlement]` | owned settlement entry |
| d1-need-a-lot-to-start | "You need a lot of money to start" | `[fund-public-regularsavings, coffee-to-compound, d0-cant-afford-to-start, d0-investing-is-for-the-rich]` | RM100 min (owned) — **overlap rule: the d0 siblings argue "investing is a necessity even on a small budget" (TOFU); this entry's turn is the concrete entry mechanics — RM100 e-Series minimum, lump-sum perception vs monthly commitment (MOFU). Cross-link, don't repeat their compounding math** |
| d1-past-performance-meaningless | "Past performance means nothing, it's all luck" | `[c-reading-a-factsheet, fund-universe-stats-snapshot]` | framing only (no number) |
| d1-epf-already-invests | "EPF already invests for me, why double up" | `[epf-shortfall-cases, b-relief-stacking]` | epf-shortfall-cases, PRS relief — **acknowledge EPF §27 guaranteed minimum; UT/PRS is a top-up, never "safer/beats" EPF** |
| d1-too-complicated | "It's too complicated, I won't understand it" | `[c-reading-a-factsheet]` | owned factsheet entry |
| d1-shariah-just-marketing | "Shariah funds are just marketing / underperform" | `[c-shariah-vs-conventional]` | owned Shariah entry |

- [x] **Step 2: Commit & push** (`content(corpus): Tier-1 avoidance objection entries (11)`).

### Task 12: Author Tier-2 (Substitution) entries — 8

**Files (create):** `d2-fees-vs-etf-ter.md`, `d2-just-dca-the-index.md`, `d2-qqq-spy-crush-my-funds.md`, `d2-sales-charge-robbery.md`, `d2-robo-does-it-cheaper.md`, `d2-just-use-epf-iinvest.md`, `d2-buy-us-stocks-direct.md`, `d2-active-underperforms.md`

- [x] **Step 1:** Author each using the template. `funnel_tier: substitution`. Every Tier-2 entry depends on a Phase-2 dataset — do not author before the dataset exists. Parameter table:

| File | Myth line | `related:` | Key cited figure source |
|---|---|---|---|
| d2-fees-vs-etf-ter | "UT fees are high, ETF TER is ~0%" | `[a-fee-schedule, etf-cost-comparison, true-cost-stack-ut-vs-etf]` | etf-cost-comparison.json |
| d2-just-dca-the-index | "Just DCA the index, you can't beat it" | `[dca-vs-lump, panic-sell-vs-hold, spiva-behaviour-gap]` | dca-vs-lump, panic-sell-vs-hold charts; **steelman concession sourced from spiva-behaviour-gap.json (Task 8c) — the "most active funds lag" concession must cite SPIVA, and the turn (the behaviour gap: plans don't fail, people abandon them) must cite the named behaviour study** |
| d2-qqq-spy-crush-my-funds | "QQQ/SPY crush Malaysian funds" | `[us-vs-my-returns, usd-return-vs-myr-adjusted, single-country-vs-global]` | us-vs-my-returns.json |
| d2-sales-charge-robbery | "5–5.5% sales charge is robbery" | `[a-sales-charge-math, sales-charge-by-channel, d1-sales-charge-instant-loss]` | sales-charge-by-channel.json — **overlap rule: lead with the channel comparison (agent vs online vs i-Invest — the charge is a chosen variable, not a fixed tax); the amortization math lives in d1-sales-charge-instant-loss, cross-link it** |
| d2-robo-does-it-cheaper | "Robo-advisors do it cheaper" | `[robo-fee-tiers, b-relief-stacking, robo-vs-ut-cost-feature]` | robo-fee-tiers.json |
| d2-just-use-epf-iinvest | "Just use EPF i-Invest, same funds cheaper" | `[sales-charge-by-channel, epf-dividend-history]` | sales-charge-by-channel.json (caps) — **acknowledge EPF §27 guaranteed minimum; never "safer/beats" EPF when noting opportunity cost** |
| d2-buy-us-stocks-direct | "I'll buy US stocks/ETFs direct for nearly free" | `[etf-cost-comparison, true-cost-stack-ut-vs-etf]` | etf-cost-comparison.json (withholding, estate) |
| d2-active-underperforms | "Fund managers underperform, why pay for active" | `[fund-universe-stats-snapshot, alpha-vs-return, spiva-behaviour-gap]` | fund-universe-stats-snapshot, alpha-vs-return, SPIVA (concession) — **compliance guardrail (FIMM CoE ¶4.6a, SC §8.09/§8.14): the weighted-alpha screen is a backward-looking selection signal, NEVER a forecast; include the past-performance caveat verbatim; no scheme-specific performance promise** |

- [x] **Step 2: Commit & push** (`content(corpus): Tier-2 substitution objection entries (8)`).

---

## PHASE 4 — Wiring & verification

### Task 13: Update `proof-asset-index.md`

**Files:** Modify `corpus/knowledge/proof-asset-index.md`

- [x] **Step 1:** Add a `### objection-cluster entries + datasets/charts` subsection with one row per new dataset and chart (asset, type, location, claims it backs), matching the table style already in the file. Include the 6 new datasets (incl. `spiva-behaviour-gap.json`), the 5 new charts, `regulatory-facts.json` / `my-cpi-inflation.json`, **and the 7 reuse charts the d-entries cite (coffee-to-compound, compounding-30y, start-age-penalty, inflation-vs-savings-real-value, target-by-budget, epf-savings-by-age, epf-baseline-tiers)** so proof-selection can discover them from the index, not only from `related:` lines.
- [x] **Step 2: Commit & push** (`docs(corpus): index objection datasets, charts, and entries in proof-asset-index`).

### Task 14: (Optional, deferred) owned-data charts

Skip unless explicitly requested in v1: `shariah-vs-conventional-alpha.yaml` (from `funds-apr2026.json`), `risk-tier-ladder.yaml` (FVC levels), `switching-cost.yaml` (from `a-switching-matrix.md`). If built, follow the chart YAML shape and add proof-index rows.

### Task 14b: corpus-lint script (run BEFORE Tasks 11–12 author the remaining 19 entries)

**Files:**
- Create: `scripts/corpus-lint.mjs`

> Partially delivers TASKS.md **E-026** (corpus-additions validator), scoped to what this plan needs. The grounding gate is doctrine only until a machine enforces it — 19 more entries arrive via subagents.

- [x] **Step 1: Write the linter.** For every `corpus/knowledge/d*.md` (and tolerantly for all `corpus/knowledge/*.md` where fields exist), assert:
  1. **Slug resolution** — every `related:` slug resolves to `corpus/knowledge/<slug>.md`, `corpus/proof/<slug>.md`, `corpus/data/<slug>.json`, or `corpus/data/charts/<slug>.yaml`. Fail with file + slug on a dangling ref.
  2. **source_ref paths exist** — every `corpus/...` path mentioned inside `source_ref` resolves to a real file.
  3. **Frontmatter completeness** — d-entries carry `cluster: objection`, a valid `funnel_tier`, `verified_at`, `lang_status`.
  4. **Compliance framing line** — the first non-heading line after the H1 of a d-entry is a `>` blockquote (the framing disclaimer).
  5. **Figure drift (best-effort)** — every `RM<number>` ≥ 1,000 quoted in a d-entry body appears in at least one artifact named in its `related:`/`source_ref` (compare digits-only). Report as WARN, not FAIL (derived figures like monthly gaps are legitimate), but list every unmatched figure for human eyes.
- [x] **Step 2: Run it on the shipped d0 entries** — expected: clean (hand-verified 2026-06-11); fix anything it surfaces.
- [x] **Step 3: Commit & push** (`feat(scripts): corpus-lint — related-slug, source_ref, frontmatter, figure-drift checks`).

### Task 15: Verification — lint + placeholder scan + count check

- [x] **Step 0: Run `node scripts/corpus-lint.mjs`** — expected: zero FAILs; review WARNs.
- [x] **Step 1: No-placeholder scan**

Run: `grep -rnE "TODO|TBD|FIXME|<sourced|XXX" corpus/knowledge/d*.md corpus/data/*.json corpus/data/charts/*.yaml`
Expected: no matches.

- [x] **Step 2: Entry count**

Run: `ls corpus/knowledge/d0-*.md | wc -l && ls corpus/knowledge/d1-*.md | wc -l && ls corpus/knowledge/d2-*.md | wc -l`
Expected: `5`, `11`, `8`.

- [x] **Step 3: Frontmatter sanity**

Run: `grep -L "funnel_tier:" corpus/knowledge/d*.md`
Expected: no output (every `d-` entry declares a tier).

### Task 16: Reindex + final build

- [x] **Step 1: Reindex the corpus**

Run the corpus reindex (via `/ingest-corpus` or the corpus MCP `reindex`). Expected: all `d-*.md` files indexed under scope `knowledge`, no skips. **Hard check: fail this step if the index is empty or the `d-*` chunk count is zero** — a silently-empty index would pass a naive smoke test by returning plausible-looking zero-result responses.

- [x] **Step 2: Smoke-test the tier filter end-to-end**

Use corpus search with `cluster: objection, funnel_tier: necessity` for query "afford". Expected: returns `d0-cant-afford-to-start`. Also run the same query with `funnel_tier: substitution` — expected: does NOT return d0 entries (proves the filter discriminates, not just decorates). Record both results in the commit message.

- [x] **Step 3: Final commit & push**

```bash
git add -A
git commit -m "chore(corpus): reindex objection corpus; verification pass"
git push
```

> `corpus/.index/` is gitignored — the commit carries no index; a fresh checkout regenerates via `/ingest-corpus`.

---

## Self-review notes

- **Spec coverage:** §3 tiers → Tasks 10–12; §4 myth set → per-entry param tables; §5 layout/cluster → Tasks 1, 10–12; §6 template → Tasks 10–12; §7 facts checklist → Phase 2 (each row mapped to Task 3–8); §8 propagation + EPF/ASB guardrail → Tasks 3–9, 13; §9 consumption flow (brain/brief) → informs no task but validates the field design in Tasks 1–2; §10 out-of-scope respected (no advice phrasing, no invented numbers, foils only); §11 deliverable → all phases.
- **Grounding gate** is restated in every Phase-2 task and enforced by the Task 15 placeholder scan.
- **Type consistency:** `funnel_tier` values `necessity|avoidance|substitution` and cluster `objection` are identical across frontmatter type, value set, chunk field, search filter, and MCP zod enum (Tasks 1–2).
