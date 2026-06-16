# Meta-paid distribute fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four defects the B-025/26/27 E2E walk surfaced so the Meta-paid distribute path produces valid adsets + ad creatives and the organic caption carries its compliance footer.

**Architecture:** Planner (`plan-distribution.ts`) gains deterministic paid-campaign policy (bid strategy, Advantage-Audience flag). Meta deploy-config (`page_id`/`link_url`) is defaulted from env at the `@engineerdad/meta-ads` execution layer (where `AD_ACCOUNT_ID`/`META_TOKEN` already live), not in the planner — keeping it off the conductor and out of `step_results` (ADR-022/023/024). The D2a/D2b worker prompts adopt the ADR-022 claim-check contract. The organic caption gets a prompt HARD RULE plus a deterministic produce-stage compliance backstop reusing `checkCompliance` (already an orchestrator dependency).

**Tech Stack:** TypeScript, Vitest, Zod (MCP schemas), Drizzle, the orchestrator stage/verifier engine.

**Spec:** `docs/superpowers/specs/2026-05-29-meta-paid-distribute-fixes-design.html`

---

## File map

| File | Responsibility | Tasks |
|------|----------------|-------|
| `packages/orchestrator/src/distribute/plan-distribution.ts` | adset `bid_strategy`; targeting `advantage_audience`; (creativeStep unchanged — locked by test) | 1, 3 |
| `packages/orchestrator/src/distribute/plan-distribution.test.ts` | tests for the above | 1, 3 |
| `packages/meta-ads/src/writes.ts` | `createAdCreative` env defaults + CTA coercion | 2 |
| `packages/meta-ads/src/writes.test.ts` | tests for the above | 2 |
| `mcp-servers/meta-ads/src/index.ts` | `create_ad_creative` schema: optional `page_id`/`link_url`, CTA string-or-object | 3 |
| `.env` | add `LANDING_URL` | 3 |
| `packages/orchestrator/src/stages/distribute.ts` | `setupPromptFor` + `routePromptFor` ADR-022 contract | 4 |
| `packages/orchestrator/src/stages/distribute.test.ts` | prompt-contract tests | 4 |
| `packages/orchestrator/src/stages/produce.ts` | `projectVariant` carries raw captions; P5 query adds `organicCaptionBm` | 5 |
| `packages/orchestrator/src/verifiers/verify-produce.ts` | compliance backstop on organic captions | 5 |
| `packages/orchestrator/src/verifiers/verify-produce.test.ts` | tests for the backstop | 5 |
| `.claude/agents/creative-director.md` (+ `packages/shared/src/prompts/*` if sourced) | organic-caption compliance-footer HARD RULE | 6 |

---

## Task 1: Fix B — adset `bid_strategy` + targeting `advantage_audience`

**Files:**
- Modify: `packages/orchestrator/src/distribute/plan-distribution.ts` (interface `MetaTargeting` ~148-153; `targetingForCell` ~163-170; `adsetStep` ~182-203)
- Test: `packages/orchestrator/src/distribute/plan-distribution.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `plan-distribution.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { adsetStep, targetingForCell } from "./plan-distribution.js";

describe("Fix B — adset bid strategy + advantage audience", () => {
  const cell = { cellId: "cell_01", allocationPct: 70, variantPageIds: ["v1"] } as never;

  it("adsetStep sets bid_strategy LOWEST_COST_WITHOUT_CAP", () => {
    const step = adsetStep("run_x", cell, 100);
    expect((step.args as Record<string, unknown>).bid_strategy).toBe("LOWEST_COST_WITHOUT_CAP");
  });

  it("adsetStep keeps a positive daily_budget_cents (budget unchanged by Fix B)", () => {
    const step = adsetStep("run_x", cell, 100);
    expect((step.args as Record<string, unknown>).daily_budget_cents).toBe(7000);
  });

  it("targetingForCell adds targeting_automation.advantage_audience = 0 alongside geo/age/locales", () => {
    const t = targetingForCell(cell) as Record<string, unknown>;
    expect(t.targeting_automation).toEqual({ advantage_audience: 0 });
    expect(t.geo_locations).toEqual({ countries: ["MY"] });
    expect(t.age_min).toBe(25);
    expect(t.age_max).toBe(55);
    expect(Array.isArray(t.locales)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm vitest run packages/orchestrator/src/distribute/plan-distribution.test.ts -t "Fix B"`
Expected: FAIL (`bid_strategy` undefined; `targeting_automation` undefined).

- [ ] **Step 3: Implement**

In `plan-distribution.ts`, extend the `MetaTargeting` interface:

```ts
export interface MetaTargeting {
  geo_locations: { countries: string[] };
  age_min: number;
  age_max: number;
  locales: number[];
  targeting_automation: { advantage_audience: number };
}
```

Update `targetingForCell` to include the flag (preserving explicit targeting — no Meta auto-expansion):

```ts
export function targetingForCell(_cell: AllocatedCell): MetaTargeting {
  return {
    geo_locations: { countries: ["MY"] },
    age_min: 25,
    age_max: 55,
    locales: [LOCALE_ID.en, LOCALE_ID.ms],
    targeting_automation: { advantage_audience: 0 },
  };
}
```

Add `bid_strategy` to `adsetStep`'s args (leave the existing `daily_budget_cents` line untouched):

```ts
    args: {
      name: `${runId}__${cell.cellId}`,
      daily_budget_cents: Math.max(1, Math.round(dailyBudgetMyr * cell.allocationPct)),
      optimization_goal: "LEAD_GENERATION",
      billing_event: "IMPRESSIONS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      targeting: targetingForCell(cell),
      client_request_id: `${runId}::${cell.cellId}`,
    },
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm vitest run packages/orchestrator/src/distribute/plan-distribution.test.ts -t "Fix B"`
Expected: PASS. Also run the whole file to catch existing-snapshot regressions: `pnpm vitest run packages/orchestrator/src/distribute/plan-distribution.test.ts` — if a prior test asserts the exact `targeting` object shape, update it to include `targeting_automation`.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/distribute/plan-distribution.ts packages/orchestrator/src/distribute/plan-distribution.test.ts
git commit -m "fix(distribute): adset bid_strategy + advantage_audience flag (Fix B)"
```

---

## Task 2: Fix A (writes) — `createAdCreative` env defaults + CTA coercion

**Files:**
- Modify: `packages/meta-ads/src/writes.ts` (`CreateAdCreativeInput` ~552-566; `createAdCreative` ~574-629)
- Test: `packages/meta-ads/src/writes.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `writes.test.ts` (mirror the existing env+fetchSpy pattern at the top of that file):

```ts
import { createAdCreative } from "./writes.js";

describe("createAdCreative — env defaults + CTA coercion", () => {
  const originalEnv = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env["META_TOKEN"] = "tok_x";
    process.env["AD_ACCOUNT_ID"] = "act_123";
    process.env["META_ORGANIC_PAGE_ID"] = "page_777";
    process.env["LANDING_URL"] = "https://engineerdad.my";
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "cre_1" }), { status: 200 }),
    );
  });
  afterEach(() => {
    process.env = originalEnv;
    fetchSpy.mockRestore();
  });

  const base = {
    name: "c1",
    primary_text: "Past performance is not indicative of future results.",
    image_hash: "h1",
    lang: "en" as const,
  };

  it("defaults page_id from META_ORGANIC_PAGE_ID when absent", async () => {
    await createAdCreative({ ...base, call_to_action: "LEARN_MORE" });
    const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body
      ? null : null)); // placeholder removed below
  });
});
```

NOTE: `metaPost` sends `application/x-www-form-urlencoded` (see `writes.ts` `metaPost` — it builds a `URLSearchParams`), and `object_story_spec` is a JSON-stringified field inside that form. So assert against the form body string, not `JSON.parse`. Replace the test body above with:

```ts
  function formBody(): string {
    return String((fetchSpy.mock.calls[0]![1] as RequestInit).body);
  }

  it("defaults page_id from META_ORGANIC_PAGE_ID when absent", async () => {
    await createAdCreative({ ...base, call_to_action: "LEARN_MORE" });
    expect(formBody()).toContain("page_777");
  });

  it("defaults link_url from LANDING_URL when absent", async () => {
    await createAdCreative({ ...base, call_to_action: "LEARN_MORE" });
    expect(decodeURIComponent(formBody())).toContain("https://engineerdad.my");
  });

  it("coerces a bare-string call_to_action into {type, value:{link}}", async () => {
    await createAdCreative({ ...base, call_to_action: "LEARN_MORE" });
    const decoded = decodeURIComponent(formBody());
    expect(decoded).toContain('"type":"LEARN_MORE"');
    expect(decoded).toContain('"link":"https://engineerdad.my"');
  });

  it("passes an object-shape call_to_action through, filling value.link when missing", async () => {
    await createAdCreative({ ...base, call_to_action: { type: "SIGN_UP" } });
    const decoded = decodeURIComponent(formBody());
    expect(decoded).toContain('"type":"SIGN_UP"');
    expect(decoded).toContain('"link":"https://engineerdad.my"');
  });

  it("honors explicit page_id/link_url over env", async () => {
    await createAdCreative({ ...base, page_id: "page_explicit", link_url: "https://lp.example", call_to_action: "LEARN_MORE" });
    const decoded = decodeURIComponent(formBody());
    expect(decoded).toContain("page_explicit");
    expect(decoded).toContain("https://lp.example");
  });
```

(Delete the placeholder first `it(...)` block — keep only the corrected tests.)

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm vitest run packages/meta-ads/src/writes.test.ts -t "env defaults"`
Expected: FAIL — today `createAdCreative` requires `page_id`/`link_url` (TS) and treats `call_to_action` only as the object shape.

- [ ] **Step 3: Implement**

In `writes.ts`, widen the input type:

```ts
export interface CreateAdCreativeInput {
  name: string;
  /** Optional — defaults to env META_ORGANIC_PAGE_ID. */
  page_id?: string;
  primary_text: string;
  headline?: string;
  description?: string;
  video_id?: string;
  image_hash?: string;
  /** Optional — defaults to env LANDING_URL. */
  link_url?: string;
  /** Bare string (CTA type) or the full Meta object shape. */
  call_to_action?: string | { type: string; value?: { link?: string } };
  lang: ComplianceLang;
}
```

At the top of `createAdCreative` (after the existing compliance check + video/image guard, before building `link_data`), resolve the deploy-config and normalize the CTA:

```ts
  const page_id = input.page_id ?? requireEnv("META_ORGANIC_PAGE_ID");
  const link_url = input.link_url ?? requireEnv("LANDING_URL");
  const call_to_action =
    typeof input.call_to_action === "string"
      ? { type: input.call_to_action, value: { link: link_url } }
      : input.call_to_action
        ? { type: input.call_to_action.type, value: { link: input.call_to_action.value?.link ?? link_url } }
        : undefined;
```

Then replace every `input.page_id` / `input.link_url` / `input.call_to_action` reference in the rest of the function with the resolved locals `page_id` / `link_url` / `call_to_action` (in `link_data.link`, `link_data.call_to_action`, `video_data.call_to_action`, and `object_story_spec.page_id`).

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm vitest run packages/meta-ads/src/writes.test.ts`
Expected: PASS (new + existing `createCampaign` tests).

- [ ] **Step 5: Commit**

```bash
git add packages/meta-ads/src/writes.ts packages/meta-ads/src/writes.test.ts
git commit -m "fix(meta-ads): createAdCreative defaults page_id/link_url from env + coerces CTA (Fix A)"
```

---

## Task 3: Fix A (MCP schema) + creativeStep contract lock + `.env`

**Files:**
- Modify: `mcp-servers/meta-ads/src/index.ts` (`create_ad_creative` schema ~314-328)
- Modify: `.env` (add `LANDING_URL`)
- Test: `packages/orchestrator/src/distribute/plan-distribution.test.ts` (lock `creativeStep`'s contract — it stays unchanged)

- [ ] **Step 1: Write failing test (creativeStep contract lock)**

`creativeStep` is private. Add a test via the public `planMetaPaidRows` path if it exposes creative steps, OR export `creativeStep` for testing. Simplest: add a `/** test-only */ export` for `creativeStep` next to the existing test-only exports in `plan-distribution.ts`, then:

```ts
import { creativeStep } from "./plan-distribution.js"; // test-only export

describe("Fix A — creativeStep contract", () => {
  const v = { variantId: "var1", rowId: "row1" } as never;
  const spec = { ctaType: "LEARN_MORE", primaryTextEn: "x", headlineEn: "h", descriptionEn: "d",
                 primaryTextMs: "x", headlineMs: "h", descriptionMs: "d" } as never;

  it("does NOT emit page_id/link_url (MCP fills them from env)", () => {
    const step = creativeStep(v, "en", spec);
    const args = step.args as Record<string, unknown>;
    expect(args.page_id).toBeUndefined();
    expect(args.link_url).toBeUndefined();
  });

  it("emits call_to_action as the bare ctaType string", () => {
    const step = creativeStep(v, "en", spec);
    expect((step.args as Record<string, unknown>).call_to_action).toBe("LEARN_MORE");
  });
});
```

- [ ] **Step 2: Run test — expect PASS-or-FAIL-on-import**

Run: `pnpm vitest run packages/orchestrator/src/distribute/plan-distribution.test.ts -t "Fix A — creativeStep"`
Expected: FAIL only on the missing test-only export. Add it:

```ts
/** Test-only export so plan-distribution.test.ts can lock the creative contract. */
export const __creativeStepForTests = creativeStep;
```

and import `__creativeStepForTests as creativeStep`. Re-run → PASS (creativeStep already emits the bare string and omits page_id/link_url; this test locks that contract against regressions).

- [ ] **Step 3: Loosen the MCP schema**

In `mcp-servers/meta-ads/src/index.ts`, the `create_ad_creative` tool schema — make `page_id`/`link_url` optional and accept CTA as string or object:

```ts
    name: z.string().min(1),
    page_id: z.string().min(1).optional(),
    primary_text: z.string().min(1),
    headline: z.string().optional(),
    description: z.string().optional(),
    video_id: z.string().optional(),
    image_hash: z.string().optional(),
    link_url: z.string().url().optional(),
    call_to_action: z
      .union([
        z.string(),
        z.object({
          type: z.string(),
          value: z.object({ link: z.string().url().optional() }).optional(),
        }),
      ])
      .optional(),
    lang: z.enum(["en", "ms"]),
```

- [ ] **Step 4: Add the env var**

Append to `.env`:

```
LANDING_URL=https://engineerdad.my
```

- [ ] **Step 5: Build the MCP + run tests**

Run: `pnpm -r --filter='!@engineerdad/webapp' build` then `pnpm vitest run packages/orchestrator/src/distribute/plan-distribution.test.ts`
Expected: build clean, tests PASS.

- [ ] **Step 6: Commit**

```bash
git add mcp-servers/meta-ads/src/index.ts .env packages/orchestrator/src/distribute/plan-distribution.ts packages/orchestrator/src/distribute/plan-distribution.test.ts
git commit -m "fix(meta-ads): create_ad_creative schema page_id/link_url optional + CTA union; add LANDING_URL (Fix A)"
```

---

## Task 4: Fix C — D2a/D2b worker ADR-022 claim-check contract

**Files:**
- Modify: `packages/orchestrator/src/stages/distribute.ts` (`setupPromptFor` ~423-444; `routePromptFor` ~529-564)
- Test: `packages/orchestrator/src/stages/distribute.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `distribute.test.ts` (import the prompt builders — add test-only exports if not already exported):

```ts
import { __setupPromptForTests as setupPromptFor, __routePromptForTests as routePromptFor } from "./distribute.js";

describe("Fix C — worker claim-check contract (ADR-022)", () => {
  it("setupPromptFor instructs write_step_result + {stepResultId} return", () => {
    const p = setupPromptFor("sr_abc");
    expect(p).toContain("mcp__orchestrator__write_step_result");
    expect(p).toContain("{ stepResultId }");
    expect(p).not.toContain("Return a JSON object: { campaignId");
  });

  it("routePromptFor instructs write_step_result + {stepResultId} return", () => {
    const p = routePromptFor("sr_def", "Meta-paid");
    expect(p).toContain("mcp__orchestrator__write_step_result");
    expect(p).toContain("{ stepResultId }");
  });
});
```

- [ ] **Step 2: Add test-only exports + run — expect FAIL**

The prompt builders must now embed `runId` (and the fanout `unitIndex`) so the worker can call `write_step_result`. Update the signatures first:

- `setupPromptFor(ref: string)` → `setupPromptFor(runId: string, ref: string)`; its caller in `d2aSetup.build` becomes `setupPromptFor(run.runId, ref)`.
- `routePromptFor(ref: string, channel: Channel)` → `routePromptFor(runId: string, ref: string, channel: Channel, unitIndex: number)`; its caller in `d2bRoute.build` passes `run.runId`, the staged `ref`, `u.channel`, and the unit's map index.

Then add, near the other `__*ForTests` exports in `distribute.ts`:

```ts
/** Test-only exports for prompt-contract assertions. */
export const __setupPromptForTests = setupPromptFor;
export const __routePromptForTests = routePromptFor;
```

Adjust the test imports/calls to the new signatures:

```ts
setupPromptFor("run_x", "sr_abc");
routePromptFor("run_x", "sr_def", "Meta-paid", 0);
```

Run: `pnpm vitest run packages/orchestrator/src/stages/distribute.test.ts -t "Fix C"`
Expected: FAIL (prompts still say "Return a JSON object" / "Return JSON").

- [ ] **Step 3: Implement — `setupPromptFor`**

Add a `runId` line near the top of the prompt (mirroring the render-worker prompt's `"Run <runId>: ..."` convention) and replace the final return line (`"Return a JSON object: { campaignId, adsetByCellId: { cellId: adsetId, ... } }."`) with the claim-check contract. The function becomes:

```ts
function setupPromptFor(runId: string, ref: string): string {
  return [
    `Run ${runId}: you are the Meta paid setup worker. Your job: create the`,
    "campaign and per-cell adsets so the row-level worker can attach ads to them.",
    "",
    "Your FIRST action: call",
    `  mcp__orchestrator__read_step_result({ stepResultId: "${ref}" })`,
    "to fetch your staged input { setupSteps, dryRun }.",
    "",
    "Procedure:",
    "1. If `setupSteps` is empty, your result is { campaignId: null, adsetByCellId: {} }.",
    "2. Otherwise execute each step in `setupSteps` IN ORDER. Each step has",
    "   `captures` — remember its result keyed by that label (e.g. \"campaign\",",
    "   \"adset:cell-A\"). Honor `needs` — substitute the captured label for",
    "   placeholders in the call's args before invoking the tool.",
    "3. If `dryRun` is true, do NOT execute any call — walk the steps and",
    "   report what you would have called.",
    "",
    "Build your result object: { campaignId, adsetByCellId: { cellId: adsetId, ... } }.",
    "Then, before your final message, call",
    `  mcp__orchestrator__write_step_result({ runId: "${runId}", stepId: "D2a-setup", payload: <your result object> })`,
    "and return ONLY { stepResultId } as your final message (ADR-022 claim-check).",
  ].join("\n");
}
```

- [ ] **Step 4: Implement — `routePromptFor`**

Thread `runId` + `unitIndex` into the signature, add a `Run <runId>:` opener, and replace the final two return lines (`"Return JSON: { rowId, channel, status: ... }"` + `"outputJson?, errorMessage? }."`) with:

```ts
    "Build your result object: { rowId, channel, status: \"routed\" | \"skipped\" | \"failed\", outputJson?, errorMessage? }.",
    "Then, before your final message, call",
    `  mcp__orchestrator__write_step_result({ runId: "${runId}", stepId: "D2b-route", unitIndex: ${unitIndex}, payload: <your result object> })`,
    "and return ONLY { stepResultId } as your final message (ADR-022 claim-check).",
```

(Keep the existing channel-specific opening line; just ensure the `runId` is present in the prompt text and the `unitIndex` is interpolated from the build's map index.)

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm vitest run packages/orchestrator/src/stages/distribute.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/stages/distribute.ts packages/orchestrator/src/stages/distribute.test.ts
git commit -m "fix(distribute): D2a/D2b workers persist + return claim-check ref (Fix C, ADR-022)"
```

---

## Task 5: Fix D (part 1) — produce-stage organic-caption compliance backstop

**Files:**
- Modify: `packages/orchestrator/src/stages/produce.ts` (`projectVariant` ~521-537; P5-confirm query fields ~558-568)
- Modify: `packages/orchestrator/src/verifiers/verify-produce.ts` (`verifyProduce` ~31)
- Test: `packages/orchestrator/src/verifiers/verify-produce.test.ts`

- [ ] **Step 1: Write failing test**

Add to `verify-produce.test.ts` (match the existing `verifyProduce` call shape — `verifyProduce(scripts, variants, reportedTotal, renderWorkersRan)`; build minimal valid `scripts`/`variants` so only the caption rule decides pass/fail):

```ts
it("fails an organic-channel variant whose caption lacks the compliance footer", () => {
  const variants = [{
    id: "v1", scriptId: "s1", format: "Carousel", aspect: "4:5",
    channels: ["Meta-organic"], assetFiles: [{ url: "u", sha256: "h" }],
    metaSpecComplete: false, organicSpecComplete: true, complianceCheck: true, estCostMyr: 0,
    organicCaptionEn: "Slide 1... this content is for educational purposes and does not constitute personal financial",
    organicCaptionBm: "Penafian penuh...",
  }] as never;
  const res = verifyProduce([{ id: "s1" }] as never, variants, 0, 1);
  expect(res.ok).toBe(false);
  expect(res.problems.join(" ")).toMatch(/compliance|footer|caption/i);
});

it("passes an organic-channel variant whose caption carries the footer", () => {
  const footer = "Past performance is not indicative of future results. FIMM. Public Mutual. Master Prospectus available.";
  const variants = [{
    id: "v1", scriptId: "s1", format: "Carousel", aspect: "4:5",
    channels: ["Meta-organic"], assetFiles: [{ url: "u", sha256: "h" }],
    metaSpecComplete: false, organicSpecComplete: true, complianceCheck: true, estCostMyr: 0,
    organicCaptionEn: "Slide 1 content. " + footer,
    organicCaptionBm: "Kandungan. prestasi lampau tidak dijamin. FIMM. Public Mutual.",
  }] as never;
  const res = verifyProduce([{ id: "s1" }] as never, variants, 0, 1);
  expect(res.ok).toBe(true);
});

it("ignores captions on non-organic variants", () => {
  const variants = [{
    id: "v1", scriptId: "s1", format: "Feed", aspect: "4:5",
    channels: ["Meta-paid"], assetFiles: [{ url: "u", sha256: "h" }],
    metaSpecComplete: true, organicSpecComplete: false, complianceCheck: true, estCostMyr: 0,
    organicCaptionEn: "", organicCaptionBm: "",
  }] as never;
  const res = verifyProduce([{ id: "s1" }] as never, variants, 0, 1);
  expect(res.ok).toBe(true);
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run packages/orchestrator/src/verifiers/verify-produce.test.ts -t "compliance footer"`
Expected: FAIL — `ProduceVariant` has no caption fields and `verifyProduce` has no caption rule.

- [ ] **Step 3: Carry the caption through the projection**

In `produce.ts`, extend the `ProduceVariant` type (wherever it is declared — search `interface ProduceVariant`) with:

```ts
  organicCaptionEn: string;
  organicCaptionBm: string;
```

Update `projectVariant` to populate them (keep `organicSpecComplete` as-is):

```ts
    organicCaptionEn: str("organicCaptionEn"),
    organicCaptionBm: str("organicCaptionBm"),
```

Add `"organicCaptionBm"` to the P5-confirm `CreativeVariants` query `fields` array (it already requests `"organicCaptionEn"`):

```ts
            "organicCaptionEn",
            "organicCaptionBm",
```

- [ ] **Step 4: Add the compliance rule to `verifyProduce`**

In `verify-produce.ts`, import the checker (the package is already an orchestrator dependency):

```ts
import { checkCompliance } from "@engineerdad/meta-ads";
```

Inside `verifyProduce`, after the existing checks build their `problems`, add — for every variant whose `channels` include `"Meta-organic"` and whose `organicCaptionEn` is non-empty:

```ts
  for (const v of variants) {
    if (!v.channels.includes("Meta-organic")) continue;
    if (v.organicCaptionEn.length === 0) continue;
    const en = checkCompliance({ primary_text: v.organicCaptionEn, lang: "en" });
    if (!en.ok) {
      problems.push(`Variant ${v.id}: organic EN caption fails compliance — ${en.refusal_reason ?? "missing required disclaimer"}`);
    }
    if (v.organicCaptionBm.length > 0) {
      const ms = checkCompliance({ primary_text: v.organicCaptionBm, lang: "ms" });
      if (!ms.ok) {
        problems.push(`Variant ${v.id}: organic BM caption fails compliance — ${ms.refusal_reason ?? "missing required disclaimer"}`);
      }
    }
  }
```

(Adapt the variable name `problems` to whatever the function already accumulates into; if it returns early, fold these into the same accumulation/return path. Verify `checkCompliance` is re-exported from the package index — `packages/meta-ads/src/index.ts`; if not, add `export { checkCompliance } from "./compliance.js";` there.)

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm vitest run packages/orchestrator/src/verifiers/verify-produce.test.ts && pnpm vitest run packages/orchestrator/src/stages/produce.test.ts`
Expected: PASS. If `produce.test.ts` fixtures construct `ProduceVariant` without the new fields, add `organicCaptionEn: "", organicCaptionBm: ""` to them.

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/stages/produce.ts packages/orchestrator/src/verifiers/verify-produce.ts packages/orchestrator/src/verifiers/verify-produce.test.ts packages/meta-ads/src/index.ts
git commit -m "fix(produce): verify organic caption carries compliance footer at HG3 (Fix D backstop)"
```

---

## Task 6: Fix D (part 2) — creative-director organic-caption HARD RULE

**Files:**
- Modify: `.claude/agents/creative-director.md` (and its source fragment under `packages/shared/src/prompts/` if one exists — check with `grep -rl "creative-director" packages/shared/src/prompts/`)
- Test: a string-contains assertion (follow how brief-writer's canonical-angle rule is tested, if such a test exists; otherwise this is a prompt-doc change verified by `pnpm sync:agents:check`)

- [ ] **Step 1: Locate the prompt source of truth**

Run: `grep -rl "creative-director\|captionEn\|organic" packages/shared/src/prompts/ .claude/agents/creative-director.md`
If a fragment exists in `packages/shared/src/prompts/`, edit THAT (then sync); otherwise edit `.claude/agents/creative-director.md` directly.

- [ ] **Step 2: Add the HARD RULE**

Insert a clearly-marked section where the agent's organic-caption output is described:

```markdown
## Organic caption compliance (HARD RULE)

Every organic caption you emit — `captionEn` AND `captionMs` — MUST end with the
full compliance footer and MUST NOT be truncated:

1. Consultant credential: "Shoo Kyuk Wei, Public Mutual (FIMM-registered UTC/PRS consultant)".
2. Risk warning: the past-performance disclaimer (EN: "Past performance is not
   indicative of future results; investments carry risk." / BM: "Prestasi lampau
   bukan petunjuk prestasi masa depan; pelaburan melibatkan risiko.").
3. Prospectus pointer: "Master Prospectus / PHS available on request." (BM:
   "Prospektus Induk / PHS boleh didapati atas permintaan.").

A caption that runs long is still required to include all three — shorten the
body, never drop the footer. The produce verifier runs a compliance check on
your captions and will FAIL the variant at HG3 if any block is missing.
```

- [ ] **Step 3: Sync + verify**

Run: `pnpm sync:agents && pnpm sync:agents:check`
Expected: clean (the `.claude/agents/creative-director.md` matches its source fragment).

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/creative-director.md packages/shared/src/prompts/ 2>/dev/null
git commit -m "fix(creative-director): organic captions must carry compliance footer (Fix D prompt rule)"
```

---

## Task 7: Full build + suite + TASKS.md

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Full sequential build (webapp excluded — it may be running)**

Run: `pnpm -r --filter='!@engineerdad/webapp' build`
Expected: all packages `Done`, no TS errors.

- [ ] **Step 2: Full test suite**

Run: `pnpm -r test` (or `pnpm vitest run` at root)
Expected: all green. Fix any fixture fallout from the `ProduceVariant`/`MetaTargeting` shape changes.

- [ ] **Step 3: Update TASKS.md**

Close the four walk findings (A/B/C/D) with one line each pointing at this plan, and record the external Meta-app `ads_management` capability gap as a non-code prerequisite (link `project-meta-app-capability-blocker`).

- [ ] **Step 4: Commit**

```bash
git add TASKS.md
git commit -m "docs(tasks): close meta-paid distribute fixes A–D; note external app-capability blocker"
```

---

## Acceptance (out-of-band)

The Meta app `ads_management` capability gap is external and blocks a live green. Once you've granted standard access for `act_943950444894075`, the deterministic acceptance is re-running the failed D2b rows on `run_1780029260` (idempotent — all rows `adId`/`fbPostId` null): rebuild, **restart Claude Code** (MCP dist reload), then `/distribute run_1780029260`. Expect: 8 paid ads attach to the 4 adsets (PAUSED), and the organic row publishes (caption now footer-complete). HG4 acceptance queries per the original spec §7.
