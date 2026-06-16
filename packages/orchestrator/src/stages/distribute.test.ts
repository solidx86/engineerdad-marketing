import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  distributeStage,
  dailyBudgetMyrFor,
  __d2aSetupForTests as d2aSetup,
  __d2bRouteForTests as d2bRoute,
  __d3bSummaryForTests as d3bSummary,
  __setupPromptForTests as setupPromptFor,
  __routePromptForTests as routePromptFor,
} from "./distribute.js";
import type { BuildContext, RunState, RunStepState } from "../types.js";

function runWith(steps: RunStepState[], params: Record<string, unknown> = {}): RunState {
  return { runId: "run_d", stage: "distribute", status: "active", params, steps };
}

/** Spy BuildContext mirroring produce.test.ts pattern. */
function mockCtx(): BuildContext & { staged: { unitIndex: number | null; payload: unknown }[] } {
  const staged: { unitIndex: number | null; payload: unknown }[] = [];
  return {
    staged,
    async stageInput(unitIndex, payload) {
      staged.push({ unitIndex, payload });
      return `sr_MOCK_${unitIndex ?? "spawn"}`;
    },
  };
}

function doneStep(stepId: string, result: unknown): RunStepState {
  return { stepId, stage: "distribute", status: "done", result, problems: [], attempts: 1 };
}

const metaVariant = {
  rowId: "r1",
  variantId: "v1",
  format: "Reel",
  aspect: "9:16",
  channels: ["Meta-paid"],
  assetFiles: [],
  adId: null,
  ytVideoId: null,
  // Fully populated so plannerSkipReason returns null — the variant is
  // routable in principle, so failure to land must be classified as "failed"
  // (not the gentler "skipped" reserved for plan-time-not-routable rows).
  metaSpec: {
    primaryTextEn: "p", primaryTextMs: "p",
    headlineEn: "h", headlineMs: "h",
    descriptionEn: "d", descriptionMs: "d",
    ctaType: "LEARN_MORE", targetingJson: "",
  },
  ytSpec: null,
  cellId: "c1",
};

describe("distributeStage", () => {
  // These tests exercise the Meta API routing path; pin api mode so the
  // default (manual) doesn't short-circuit the setup/fan-out under test.
  beforeEach(() => { process.env.META_PAID_MODE = "api"; });
  afterEach(() => { delete process.env.META_PAID_MODE; });

  it("has 5 steps in D1..D3b order with the right kinds (no HG4 gate)", () => {
    expect(distributeStage.id).toBe("distribute");
    expect(distributeStage.steps.map((s) => s.id)).toEqual([
      "D1-query",
      "D2a-setup",
      "D2b-route",
      "D3a-confirm",
      "D3b-summary",
    ]);
    expect(distributeStage.steps.map((s) => s.kind)).toEqual([
      "write",
      "spawn",
      "fanout",
      "write",
      "write",
    ]);
    expect(distributeStage.steps.map((s) => s.id)).not.toContain("D4-gate");
  });

  it("D1 builds store queries", () => {
    const step = distributeStage.steps[0]!.build(runWith([]));
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls.length).toBeGreaterThanOrEqual(2);
    expect(step.calls.every((c) => c.tool === "mcp__store__query")).toBe(true);
    const a0 = step.calls[0]!.args as { entity: string; filter: Record<string, unknown> };
    expect(a0.entity).toBe("CreativeVariants");
    expect(a0.filter).toEqual({ runId: "run_d", approvalStatus: "Approved" });
    const a1 = step.calls[1]!.args as { entity: string; filter: Record<string, unknown> };
    expect(a1.entity).toBe("AuthorityArticles");
    expect(a1.filter).toMatchObject({ runId: "run_d", approvalStatus: "Approved" });
    expect(a1.filter.deliveredAt).toEqual({ isNull: true });
  });

  it("D3a has no verify — the audit log + halt decision both moved to D3b", () => {
    const d3a = distributeStage.steps.find((s) => s.id === "D3a-confirm")!;
    expect(d3a.verify).toBeUndefined();
  });

  it("D3b.verify delegates to verifyDistribute — fails an unrouted Meta variant", () => {
    const d3b = distributeStage.steps.find((s) => s.id === "D3b-summary")!;
    const run = runWith([
      doneStep("D1-query", [[metaVariant], [], []]),
      doneStep("D3a-confirm", [[metaVariant], []]),
    ]);
    const v = d3b.verify!(run, []);
    expect(v.ok).toBe(false);
  });

  it("D3b.verify passes when actual rows are satisfied", () => {
    const d3b = distributeStage.steps.find((s) => s.id === "D3b-summary")!;
    const actVariant = { ...metaVariant, adId: { en: "ad", ms: "ad" } };
    const run = runWith([
      doneStep("D1-query", [[metaVariant], [], []]),
      doneStep("D3a-confirm", [[actVariant], []]),
    ]);
    expect(d3b.verify!(run, []).ok).toBe(true);
  });

  it("D3b.verify ignores variants the planner couldn't route (status 'skipped')", () => {
    const d3b = distributeStage.steps.find((s) => s.id === "D3b-summary")!;
    // Strip cellId — plannerSkipReason will now flag this as not-routable.
    const unroutable = { ...metaVariant, cellId: null };
    const run = runWith([
      doneStep("D1-query", [[unroutable], [], []]),
      doneStep("D3a-confirm", [[unroutable], []]),
    ]);
    // Even though the variant didn't land, verify must pass — a known
    // plan-time skip shouldn't halt the loop.
    expect(d3b.verify!(run, []).ok).toBe(true);
  });

  it("D1 declares a fields projection so the rows back DistVariant/DistArticle", () => {
    const step = distributeStage.steps[0]!.build(runWith([]));
    if (step.kind !== "write") throw new Error("expected write");
    const v = step.calls[0]!.args as { fields?: string[] };
    const a = step.calls[1]!.args as { fields?: string[] };
    // channels is the field whose absence triggered the original bug —
    // planMetaPaid filters on v.channels.includes(META).
    expect(v.fields).toContain("channels");
    expect(v.fields).toContain("metaPrimaryTextEn");
    expect(v.fields).toContain("assetFiles");
    expect(a.fields).toContain("slug");
    expect(a.fields).toContain("deliveredAt");
  });

  it("D2a builds a plan from RAW store rows (not pre-projected) without crashing", async () => {
    // The pre-fix bug: store.query returned {id, title} only (no channels),
    // and the legacy d2Route cast rows as DistVariant[] then called
    // v.channels.includes(META) → TypeError on undefined.
    // After the fix, projectVariants must build channels[] from the row —
    // this regression guard now lives on d2aSetup, where the projection feeds.
    const rawVariant = {
      id: "618762e5-03cb-4d37-ab09-64b0d859105d",
      title: "Feed · 4:5",
      format: "Feed",
      aspect: "4:5",
      channels: ["Meta-paid"],
      assetFiles: [{ url: "https://example.com/a.png" }],
      metaPrimaryTextEn: "buy this",
      metaHeadlineEn: "headline",
    };
    const d1 = doneStep("D1-query", [[rawVariant], [], []]);
    await expect(d2aSetup.build(runWith([d1]), mockCtx())).resolves.toBeDefined();
  });

  it("D2a derives v.cellId by reverse-lookup against the experiment's allocated cells", async () => {
    const rawVariant = {
      id: "var-1",
      title: "Feed · 4:5",
      format: "Feed",
      channels: ["Meta-paid"],
      assetFiles: [{ url: "https://example.com/a.png" }],
      metaPrimaryTextEn: "buy this",
      metaHeadlineEn: "headline",
      metaCtaType: "LEARN_MORE",
    };
    const experimentRow = {
      id: "exp-1",
      cells: [
        { cellId: "cell-A", factorLevels: {}, variantPageIds: ["var-1"], bucket: "70", allocationPct: 70 },
      ],
    };
    const d1 = doneStep("D1-query", [[rawVariant], [], [experimentRow]]);
    const ctx = mockCtx();
    await d2aSetup.build(runWith([d1], { dailyBudgetMyr: 1000 }), ctx);
    // Cell ownership lifts the variant out of the "no experiment cell" skip
    // branch, so the staged setupSteps should contain an adset step captured
    // under "adset:cell-A".
    const payload = ctx.staged[0]!.payload as { setupSteps: { captures?: string }[] };
    const captures = payload.setupSteps.map((s) => s.captures);
    expect(captures).toContain("adset:cell-A");
  });

  it("D2a skips raw Meta-paid variants when no experiment cells exist", async () => {
    const rawVariant = {
      id: "var-1",
      title: "Reel · 9:16",
      format: "Reel",
      channels: ["Meta-paid"],
      metaPrimaryTextEn: "buy this",
      metaHeadlineEn: "headline",
    };
    const d1 = doneStep("D1-query", [[rawVariant], [], []]);
    const ctx = mockCtx();
    await d2aSetup.build(runWith([d1]), ctx);
    // No cells → no setup steps emitted; staged setupSteps is empty.
    const payload = ctx.staged[0]!.payload as { setupSteps: unknown[] };
    expect(payload.setupSteps).toEqual([]);
  });
});

describe("d2aSetup", () => {
  beforeEach(() => { process.env.META_PAID_MODE = "api"; });
  afterEach(() => { delete process.env.META_PAID_MODE; });

  it("stages an empty setupSteps payload when there are 0 routable Meta variants", async () => {
    const d1 = doneStep("D1-query", [[], [], []]);
    const ctx = mockCtx();
    const step = await d2aSetup.build(runWith([d1]), ctx);
    expect(ctx.staged.length).toBe(1);
    expect(ctx.staged[0]!.unitIndex).toBe(null);
    expect(ctx.staged[0]!.payload).toEqual({ setupSteps: [], dryRun: false });
    expect(step.kind).toBe("spawn");
    if (step.kind !== "spawn") throw new Error("expected spawn");
    expect(step.agent).toBe("general-purpose");
    expect(step.spawnPrompt).toContain("sr_MOCK_spawn");
  });

  it("stages a campaign + 1 adset for a single routable variant in cell-A", async () => {
    const rawVariant = {
      id: "var-1",
      title: "Feed · 4:5",
      format: "Feed",
      channels: ["Meta-paid"],
      assetFiles: [{ url: "https://example.com/a.png" }],
      metaPrimaryTextEn: "buy this",
      metaHeadlineEn: "headline",
      metaCtaType: "LEARN_MORE",
    };
    const experimentRow = {
      id: "exp-1",
      cells: [
        { cellId: "cell-A", factorLevels: {}, variantPageIds: ["var-1"], bucket: "70", allocationPct: 70 },
      ],
    };
    const d1 = doneStep("D1-query", [[rawVariant], [], [experimentRow]]);
    const ctx = mockCtx();
    await d2aSetup.build(runWith([d1], { dailyBudgetMyr: 1000 }), ctx);
    const payload = ctx.staged[0]!.payload as { setupSteps: { tool: string; captures?: string }[] };
    expect(payload.setupSteps.length).toBe(2);
    expect(payload.setupSteps[0]!.tool).toBe("mcp__meta-ads__create_campaign");
    expect(payload.setupSteps[0]!.captures).toBe("campaign");
    expect(payload.setupSteps[1]!.tool).toBe("mcp__meta-ads__create_adset");
    expect(payload.setupSteps[1]!.captures).toBe("adset:cell-A");
  });

  it("dedups adset emission when 2 variants share cell-A", async () => {
    const variantRows = [
      {
        id: "var-1",
        format: "Feed",
        channels: ["Meta-paid"],
        assetFiles: [{ url: "https://example.com/a.png" }],
        metaPrimaryTextEn: "t1",
        metaHeadlineEn: "h1",
      },
      {
        id: "var-2",
        format: "Feed",
        channels: ["Meta-paid"],
        assetFiles: [{ url: "https://example.com/b.png" }],
        metaPrimaryTextEn: "t2",
        metaHeadlineEn: "h2",
      },
    ];
    const experimentRow = {
      id: "exp-1",
      cells: [
        {
          cellId: "cell-A",
          factorLevels: {},
          variantPageIds: ["var-1", "var-2"],
          bucket: "70",
          allocationPct: 70,
        },
      ],
    };
    const d1 = doneStep("D1-query", [variantRows, [], [experimentRow]]);
    const ctx = mockCtx();
    await d2aSetup.build(runWith([d1], { dailyBudgetMyr: 1000 }), ctx);
    const payload = ctx.staged[0]!.payload as { setupSteps: { tool: string; captures?: string }[] };
    // campaign + exactly one adset (cell-A), not two
    expect(payload.setupSteps.length).toBe(2);
    const adsetSteps = payload.setupSteps.filter((s) => s.tool === "mcp__meta-ads__create_adset");
    expect(adsetSteps.length).toBe(1);
    expect(adsetSteps[0]!.captures).toBe("adset:cell-A");
  });

  it("honors run.params.dryRun", async () => {
    const d1 = doneStep("D1-query", [[], [], []]);
    const ctx = mockCtx();
    await d2aSetup.build(runWith([d1], { dryRun: true, dailyBudgetMyr: 1000 }), ctx);
    const payload = ctx.staged[0]!.payload as { dryRun: boolean };
    expect(payload.dryRun).toBe(true);
  });

  it("verify accepts an object result and rejects non-objects", () => {
    const run = runWith([]);
    expect(d2aSetup.verify!(run, { campaignId: "cmp-1", adsetByCellId: { "cell-A": "adset-1" } })).toEqual({
      ok: true,
      problems: [],
    });
    const vNull = d2aSetup.verify!(run, null);
    expect(vNull.ok).toBe(false);
    expect(vNull.problems.join(" ")).toContain("non-object");
    const vStr = d2aSetup.verify!(run, "string");
    expect(vStr.ok).toBe(false);
  });
});

describe("d2bRoute", () => {
  beforeEach(() => { process.env.META_PAID_MODE = "api"; });
  afterEach(() => { delete process.env.META_PAID_MODE; });

  /** A raw store row for a Meta-paid Feed variant assigned to cell-A. */
  function rawMetaVariant(id: string, cellVariantIds: string[]): {
    row: Record<string, unknown>;
    cell: Record<string, unknown>;
  } {
    const row = {
      id,
      title: "Feed · 4:5",
      format: "Feed",
      aspect: "4:5",
      channels: ["Meta-paid"],
      assetFiles: [{ url: `https://example.com/${id}.png` }],
      metaPrimaryTextEn: "buy this",
      metaHeadlineEn: "headline",
      metaCtaType: "LEARN_MORE",
    };
    const cell = {
      cellId: "cell-A",
      factorLevels: {},
      variantPageIds: cellVariantIds,
      bucket: "70",
      allocationPct: 70,
    };
    return { row, cell };
  }

  /** A raw store row for a Meta-organic Carousel 1:1 (eligible for FB). */
  function rawOrganicVariant(id: string): Record<string, unknown> {
    return {
      id,
      title: "Carousel · 1:1",
      format: "Carousel",
      aspect: "1:1",
      channels: ["Meta-organic"],
      assetFiles: [{ url: `https://example.com/${id}-1.png` }, { url: `https://example.com/${id}-2.png` }],
      organicCaptionEn: "look here",
      organicLanguage: "en",
      organicScheduledFor: "2026-06-01T00:00:00.000Z",
    };
  }

  it("stages no units when there are 0 routable rows", async () => {
    const d1 = doneStep("D1-query", [[], [], []]);
    const ctx = mockCtx();
    const step = await d2bRoute.build(runWith([d1]), ctx);
    expect(step.kind).toBe("fanout");
    if (step.kind !== "fanout") throw new Error("expected fanout");
    expect(step.units).toEqual([]);
    expect(ctx.staged).toEqual([]);
  });

  it("stages 3 Meta-paid + 1 Meta-organic units when both channels have routable rows", async () => {
    const m1 = rawMetaVariant("m1", ["m1", "m2", "m3"]);
    const m2 = rawMetaVariant("m2", ["m1", "m2", "m3"]);
    const m3 = rawMetaVariant("m3", ["m1", "m2", "m3"]);
    const org = rawOrganicVariant("o1");
    const experimentRow = { id: "exp-1", cells: [m1.cell] };
    const d1 = doneStep("D1-query", [
      [m1.row, m2.row, m3.row, org],
      [],
      [experimentRow],
    ]);
    const ctx = mockCtx();
    const step = await d2bRoute.build(runWith([d1], { dailyBudgetMyr: 1000 }), ctx);
    if (step.kind !== "fanout") throw new Error("expected fanout");
    expect(step.units).toHaveLength(4);
    expect(ctx.staged).toHaveLength(4);
    // unitIndex 0..3, in order
    expect(ctx.staged.map((s) => s.unitIndex)).toEqual([0, 1, 2, 3]);
    const channels = ctx.staged.map(
      (s) => (s.payload as { channel: string }).channel,
    );
    // 3 Meta-paid + 1 Meta-organic (order: Meta-paid first, then Meta-organic)
    expect(channels.filter((c) => c === "Meta-paid")).toHaveLength(3);
    expect(channels.filter((c) => c === "Meta-organic")).toHaveLength(1);
    // Every staged payload carries the full per-unit shape.
    for (const s of ctx.staged) {
      const p = s.payload as Record<string, unknown>;
      expect(p).toHaveProperty("channel");
      expect(p).toHaveProperty("rowPlan");
      expect(p).toHaveProperty("backfill");
      expect(p).toHaveProperty("setupContext");
      expect(p).toHaveProperty("dryRun");
      expect(p).toHaveProperty("runId");
    }
  });

  it("includes setupContext from D2a-setup in every unit's payload", async () => {
    const m1 = rawMetaVariant("m1", ["m1"]);
    const experimentRow = { id: "exp-1", cells: [m1.cell] };
    const setupResult = { campaignId: "cmp-1", adsetByCellId: { "cell-A": "adset-1" } };
    const d1 = doneStep("D1-query", [[m1.row], [], [experimentRow]]);
    const d2a = doneStep("D2a-setup", setupResult);
    const ctx = mockCtx();
    await d2bRoute.build(runWith([d1, d2a], { dailyBudgetMyr: 1000 }), ctx);
    expect(ctx.staged.length).toBeGreaterThan(0);
    for (const s of ctx.staged) {
      const p = s.payload as { setupContext: unknown };
      expect(p.setupContext).toEqual(setupResult);
    }
  });

  it("emits 2 units for a dual-channel Meta-paid + Meta-organic variant", async () => {
    // One variant on both channels — must produce 2 distinct routing units.
    const dual = {
      ...rawOrganicVariant("d1"),
      channels: ["Meta-paid", "Meta-organic"],
      // Meta-paid spec fields:
      metaPrimaryTextEn: "buy this",
      metaHeadlineEn: "headline",
      metaCtaType: "LEARN_MORE",
    };
    const cell = {
      cellId: "cell-A",
      factorLevels: {},
      variantPageIds: ["d1"],
      bucket: "70",
      allocationPct: 70,
    };
    const experimentRow = { id: "exp-1", cells: [cell] };
    const d1 = doneStep("D1-query", [[dual], [], [experimentRow]]);
    const ctx = mockCtx();
    const step = await d2bRoute.build(runWith([d1], { dailyBudgetMyr: 1000 }), ctx);
    if (step.kind !== "fanout") throw new Error("expected fanout");
    expect(step.units).toHaveLength(2);
    const channels = ctx.staged.map((s) => (s.payload as { channel: string }).channel);
    expect(channels).toContain("Meta-paid");
    expect(channels).toContain("Meta-organic");
  });

  it("respects channelFilter — emits only Meta-organic units when filter excludes Meta-paid", async () => {
    const m1 = rawMetaVariant("m1", ["m1", "m2", "m3"]);
    const m2 = rawMetaVariant("m2", ["m1", "m2", "m3"]);
    const m3 = rawMetaVariant("m3", ["m1", "m2", "m3"]);
    const org = rawOrganicVariant("o1");
    const experimentRow = { id: "exp-1", cells: [m1.cell] };
    const d1 = doneStep("D1-query", [
      [m1.row, m2.row, m3.row, org],
      [],
      [experimentRow],
    ]);
    const ctx = mockCtx();
    const step = await d2bRoute.build(
      runWith([d1], { dailyBudgetMyr: 1000, channelFilter: ["Meta-organic"] }),
      ctx,
    );
    if (step.kind !== "fanout") throw new Error("expected fanout");
    expect(step.units).toHaveLength(1);
    const channels = ctx.staged.map((s) => (s.payload as { channel: string }).channel);
    expect(channels).toEqual(["Meta-organic"]);
  });

  it("propagates run.params.dryRun into every unit's payload", async () => {
    const m1 = rawMetaVariant("m1", ["m1"]);
    const experimentRow = { id: "exp-1", cells: [m1.cell] };
    const d1 = doneStep("D1-query", [[m1.row], [], [experimentRow]]);
    const ctx = mockCtx();
    await d2bRoute.build(runWith([d1], { dryRun: true, dailyBudgetMyr: 1000 }), ctx);
    expect(ctx.staged.length).toBeGreaterThan(0);
    for (const s of ctx.staged) {
      expect((s.payload as { dryRun: boolean }).dryRun).toBe(true);
    }
  });

  it("verify accepts an array result and rejects non-arrays", () => {
    const run = runWith([]);
    expect(d2bRoute.verify!(run, [{ rowId: "r1" }])).toEqual({ ok: true, problems: [] });
    expect(d2bRoute.verify!(run, []).ok).toBe(true);
    expect(d2bRoute.verify!(run, null).ok).toBe(false);
    expect(d2bRoute.verify!(run, { not: "an array" }).ok).toBe(false);
  });
});

describe("d3bSummary", () => {
  // These tests assert the Meta API routing semantics, so pin api mode — the
  // default (manual) classifies every Meta-paid variant as a "skipped" pack
  // item rather than "failed".
  beforeEach(() => { process.env.META_PAID_MODE = "api"; });
  afterEach(() => { delete process.env.META_PAID_MODE; });

  // These fixtures represent variants that WERE routable at plan-time — the
  // metaSpec/ytSpec/organicScheduledFor fields are populated so
  // plannerSkipReason returns null. When the actual ground-truth row lacks
  // the channel's identifier, the status is correctly "failed" (we tried and
  // didn't land), not the gentler "skipped" reserved for plan-time skips.
  function metaPaidRow(id: string, opts: { routed?: boolean } = {}): Record<string, unknown> {
    return {
      id,
      title: "Feed · 4:5",
      format: "Feed",
      channels: ["Meta-paid"],
      assetFiles: [{ url: `https://example.com/${id}.png` }],
      cellId: "cell-1",
      metaSpec: {
        primaryTextEn: "p", primaryTextMs: "p",
        headlineEn: "h", headlineMs: "h",
        descriptionEn: "d", descriptionMs: "d",
        ctaType: "LEARN_MORE", targetingJson: "",
      },
      ...(opts.routed ? { adId: JSON.stringify({ en: `ad-${id}`, ms: null }) } : {}),
    };
  }
  function organicRow(id: string, opts: { routed?: boolean } = {}): Record<string, unknown> {
    return {
      id,
      title: "Carousel · 1:1",
      format: "Carousel",
      aspect: "1:1",
      channels: ["Meta-organic"],
      assetFiles: [],
      organicScheduledFor: "2026-05-28T00:00:00.000Z",
      ...(opts.routed ? { fbPostId: `fb-${id}` } : {}),
    };
  }
  function ytRow(id: string, opts: { routed?: boolean } = {}): Record<string, unknown> {
    return {
      id,
      title: "Reel · 9:16",
      format: "Reel",
      channels: ["YouTube"],
      assetFiles: [],
      ytSpec: { title: "t", description: "d", tags: ["a"], category: "Education" },
      ...(opts.routed ? { ytVideoId: `yt-${id}` } : {}),
    };
  }
  function articleRow(id: string, opts: { routed?: boolean } = {}): Record<string, unknown> {
    return {
      id,
      title: "Why X matters",
      slug: `why-${id}`,
      ...(opts.routed ? { deliveredAt: "2026-05-27T00:00:00.000Z" } : {}),
    };
  }

  it("emits N store.create calls — one per (variant × channel) pair plus one per article", () => {
    const mPaid = metaPaidRow("m1");
    const mOrg = organicRow("o1");
    const art = articleRow("a1");
    const d1 = doneStep("D1-query", [[mPaid, mOrg], [art], []]);
    // D3a "actual" — everything landed.
    const d3a = doneStep("D3a-confirm", [
      [metaPaidRow("m1", { routed: true }), organicRow("o1", { routed: true })],
      [articleRow("a1", { routed: true })],
    ]);
    const step = d3bSummary.build(runWith([d1, d3a]));
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(3);
    expect(step.calls.every((c) => c.tool === "mcp__store__create")).toBe(true);
    expect(
      step.calls.every(
        (c) => (c.args as { entity: string }).entity === "Distributions",
      ),
    ).toBe(true);
    const channels = step.calls.map(
      (c) => (c.args as { props: { channel: string } }).props.channel,
    );
    expect(channels.sort()).toEqual(["Article", "Meta-organic", "Meta-paid"]);
  });

  it("status is 'routed' when the channel's ground-truth field is present, 'failed' when missing", () => {
    // Variant on both Meta-paid + Meta-organic. Actual: adId set, fbPostId null.
    // Fully populated so both channels are plan-time routable.
    const dualRow = {
      id: "d1",
      title: "Feed · 4:5",
      format: "Feed",
      aspect: "1:1",
      channels: ["Meta-paid", "Meta-organic"],
      assetFiles: [{ url: "https://example.com/d1.png" }],
      cellId: "cell-1",
      organicScheduledFor: "2026-05-28T00:00:00.000Z",
      metaSpec: {
        primaryTextEn: "p", primaryTextMs: "p",
        headlineEn: "h", headlineMs: "h",
        descriptionEn: "d", descriptionMs: "d",
        ctaType: "LEARN_MORE", targetingJson: "",
      },
    };
    const actualDual = {
      ...dualRow,
      adId: JSON.stringify({ en: "ad-d1", ms: null }),
      // fbPostId omitted → null
    };
    const d1 = doneStep("D1-query", [[dualRow], [], []]);
    const d3a = doneStep("D3a-confirm", [[actualDual], []]);
    const step = d3bSummary.build(runWith([d1, d3a]));
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(2);
    const byChannel = new Map(
      step.calls.map((c) => {
        const p = (c.args as { props: { channel: string; status: string } }).props;
        return [p.channel, p.status];
      }),
    );
    expect(byChannel.get("Meta-paid")).toBe("routed");
    expect(byChannel.get("Meta-organic")).toBe("failed");
  });

  it("all summary calls carry authorStep 'D3-confirm'", () => {
    const d1 = doneStep("D1-query", [[metaPaidRow("m1"), organicRow("o1")], [articleRow("a1")], []]);
    const d3a = doneStep("D3a-confirm", [
      [metaPaidRow("m1", { routed: true }), organicRow("o1")],
      [articleRow("a1", { routed: true })],
    ]);
    const step = d3bSummary.build(runWith([d1, d3a]));
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls.length).toBeGreaterThan(0);
    for (const c of step.calls) {
      const p = (c.args as { props: { authorStep: string } }).props;
      expect(p.authorStep).toBe("D3-confirm");
    }
  });

  it("variant in D1 but missing from D3a actual → status 'failed'", () => {
    const d1 = doneStep("D1-query", [[metaPaidRow("m1")], [], []]);
    // D3a returns 0 variants.
    const d3a = doneStep("D3a-confirm", [[], []]);
    const step = d3bSummary.build(runWith([d1, d3a]));
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(1);
    const p = (step.calls[0]!.args as { props: { status: string; channel: string } }).props;
    expect(p.status).toBe("failed");
    expect(p.channel).toBe("Meta-paid");
  });

  it("article without deliveredAt is 'failed'; with deliveredAt is 'routed'", () => {
    const d1 = doneStep("D1-query", [[], [articleRow("a1"), articleRow("a2")], []]);
    const d3a = doneStep("D3a-confirm", [
      [],
      [articleRow("a1", { routed: true }), articleRow("a2")],
    ]);
    const step = d3bSummary.build(runWith([d1, d3a]));
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(2);
    const byTarget = new Map(
      step.calls.map((c) => {
        const p = (c.args as { props: { targetId: string; status: string } }).props;
        return [p.targetId, p.status];
      }),
    );
    expect(byTarget.get("a1")).toBe("routed");
    expect(byTarget.get("a2")).toBe("failed");
  });

  it("YouTube channel checks ytVideoId, not adId", () => {
    const ytExp = ytRow("y1");
    const d1 = doneStep("D1-query", [[ytExp], [], []]);
    // adId set but ytVideoId NOT set → still 'failed' because the channel is YouTube.
    const actual = {
      ...ytExp,
      adId: JSON.stringify({ en: "ad-y1", ms: null }),
    };
    const d3a = doneStep("D3a-confirm", [[actual], []]);
    const step = d3bSummary.build(runWith([d1, d3a]));
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(1);
    const p = (step.calls[0]!.args as { props: { channel: string; status: string } }).props;
    expect(p.channel).toBe("YouTube");
    expect(p.status).toBe("failed");

    // Now confirm the inverse — ytVideoId set → 'routed'.
    const d3aOk = doneStep("D3a-confirm", [[ytRow("y1", { routed: true })], []]);
    const stepOk = d3bSummary.build(runWith([d1, d3aOk]));
    if (stepOk.kind !== "write") throw new Error("expected write");
    const pOk = (stepOk.calls[0]!.args as { props: { status: string } }).props;
    expect(pOk.status).toBe("routed");
  });

  it("synthesizes a non-empty title containing the channel name", () => {
    const d1 = doneStep("D1-query", [
      [metaPaidRow("618762e5-03cb-4d37-ab09-64b0d859105d")],
      [articleRow("a1")],
      [],
    ]);
    const d3a = doneStep("D3a-confirm", [
      [metaPaidRow("618762e5-03cb-4d37-ab09-64b0d859105d", { routed: true })],
      [articleRow("a1", { routed: true })],
    ]);
    const step = d3bSummary.build(runWith([d1, d3a]));
    if (step.kind !== "write") throw new Error("expected write");
    for (const c of step.calls) {
      const p = (c.args as { props: { title: string; channel: string } }).props;
      expect(typeof p.title).toBe("string");
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.title).toContain(p.channel);
    }
  });
});

describe("Fix C — worker claim-check contract (ADR-022)", () => {
  it("setupPromptFor instructs write_step_result + {stepResultId} return", () => {
    const p = setupPromptFor("run_x", "sr_abc");
    expect(p).toContain("mcp__orchestrator__write_step_result");
    expect(p).toContain("{ stepResultId }");
    expect(p).toContain("run_x");
    expect(p).not.toContain("Return a JSON object: { campaignId");
    // runId must appear inside the write_step_result call specifically, not just
    // in the opener — confirms the claim-check call is bound to the correct run.
    expect(p).toContain('runId: "run_x"');
  });

  it("routePromptFor instructs write_step_result + {stepResultId} return", () => {
    const p = routePromptFor("run_x", "sr_def", "Meta-paid", 3);
    expect(p).toContain("mcp__orchestrator__write_step_result");
    expect(p).toContain("{ stepResultId }");
    expect(p).toContain("run_x");
    // unitIndex must be interpolated into the write_step_result call so the
    // orchestrator can fan in the result to the correct slot.
    expect(p).toContain("unitIndex: 3");
    // Negative guard — old inline-return wording must be gone.
    expect(p).not.toContain("Return JSON:");
  });
});

describe("dailyBudgetMyrFor", () => {
  it("prefers Brain experimentParams over run.params", () => {
    const run = runWith(
      [doneStep("S1-reason", { experimentParams: { dailyBudgetMyr: 25 } })],
      { dailyBudgetMyr: 10 },
    );
    expect(dailyBudgetMyrFor(run)).toBe(25);
  });

  it("falls back to run.params when memo absent", () => {
    const run = runWith([], { dailyBudgetMyr: 15 });
    expect(dailyBudgetMyrFor(run)).toBe(15);
  });

  it("returns 0 when neither source provides", () => {
    const run = runWith([], {});
    expect(dailyBudgetMyrFor(run)).toBe(0);
  });

  it("falls back when memo has experimentParams but no dailyBudgetMyr", () => {
    const run = runWith(
      [doneStep("S1-reason", { experimentParams: { factors: [] } })],
      { dailyBudgetMyr: 12 },
    );
    expect(dailyBudgetMyrFor(run)).toBe(12);
  });

  it("respects memo dailyBudgetMyr=0 (does not fall through)", () => {
    const run = runWith(
      [doneStep("S1-reason", { experimentParams: { dailyBudgetMyr: 0 } })],
      { dailyBudgetMyr: 99 },
    );
    expect(dailyBudgetMyrFor(run)).toBe(0);
  });
});

describe("distribute manual mode", () => {
  afterEach(() => { delete process.env.META_PAID_MODE; });

  /** One approved Meta-paid Feed variant assigned to cell-A + its experiment row. */
  function metaRun(): RunState {
    const row = {
      id: "m1",
      title: "Feed · 4:5",
      format: "Feed",
      aspect: "4:5",
      channels: ["Meta-paid"],
      assetFiles: [{ url: "https://example.com/m1.png" }],
      metaPrimaryTextEn: "buy this",
      metaHeadlineEn: "headline",
      metaCtaType: "LEARN_MORE",
    };
    const experimentRow = {
      id: "exp-1",
      cells: [{ cellId: "cell-A", factorLevels: {}, variantPageIds: ["m1"], bucket: "70", allocationPct: 70 }],
    };
    return runWith([doneStep("D1-query", [[row], [], [experimentRow]])], { dailyBudgetMyr: 1000 });
  }

  it("excludes Meta-paid units from D2b-route fan-out in manual mode", async () => {
    process.env.META_PAID_MODE = "manual";
    const step = await d2bRoute.build(metaRun(), mockCtx());
    if (step.kind !== "fanout") throw new Error("expected fanout");
    const prompts = step.units.map((u) => u.spawnPrompt);
    expect(prompts.some((p) => p.includes("Meta-paid"))).toBe(false);
  });

  it("includes Meta-paid units in api mode", async () => {
    process.env.META_PAID_MODE = "api";
    const step = await d2bRoute.build(metaRun(), mockCtx());
    if (step.kind !== "fanout") throw new Error("expected fanout");
    expect(step.units.length).toBeGreaterThan(0);
    expect(step.units.some((u) => u.spawnPrompt.includes("Meta-paid"))).toBe(true);
  });

  it("D2a stages an empty setup in manual mode (no API campaign/adsets)", async () => {
    process.env.META_PAID_MODE = "manual";
    const ctx = mockCtx();
    await d2aSetup.build(metaRun(), ctx);
    const payload = ctx.staged[0]!.payload as { setupSteps: unknown[] };
    expect(payload.setupSteps).toEqual([]);
  });

  it("D3b records a manual Meta-paid variant as skipped (not failed)", () => {
    process.env.META_PAID_MODE = "manual";
    const d3b = distributeStage.steps.find((s) => s.id === "D3b-summary")!;
    // Unrouted Meta-paid variant; in manual mode this is a known skip, so
    // verifyDistribute must still pass (the loop doesn't halt).
    const run = runWith([
      doneStep("D1-query", [[metaVariant], [], []]),
      doneStep("D3a-confirm", [[metaVariant], []]),
    ]);
    expect(d3b.verify!(run, []).ok).toBe(true);
  });

  it("distributeStage has no HG4 gate step", () => {
    const ids = distributeStage.steps.map((s) => s.id);
    expect(ids).not.toContain("D4-gate");
  });
});
