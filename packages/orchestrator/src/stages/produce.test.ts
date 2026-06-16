import { describe, it, expect } from "vitest";
import { produceStage } from "./produce.js";
import { type CreativePlan, type CreativeUnit } from "@engineerdad/shared/derive";
import type { BuildContext, RunState, RunStepState } from "../types.js";

/** A spy BuildContext for stage tests. Captures every stageInput call and
 *  returns a synthetic sr_ ref derived from the args (deterministic, lets
 *  tests assert which payload was staged at which unit). No DB I/O. */
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

function runWith(steps: RunStepState[]): RunState {
  return { runId: "run_p", stage: "produce", status: "active", params: {}, steps };
}

function doneStep(stepId: string, result: unknown): RunStepState {
  return { stepId, stage: "produce", status: "done", result, problems: [], attempts: 1 };
}

function doneContent(stepId: string, result: unknown): RunStepState {
  return { stepId, stage: "content", status: "done", result, problems: [], attempts: 1 };
}

const SCENE = {
  scene: 1,
  durationSec: 3,
  visual: "v",
  onScreenText: "t",
  voiceover: "vo",
  shotNotes: "s",
  chartRef: null,
};

function creativeUnit(format: CreativeUnit["format"]): CreativeUnit {
  return {
    scriptId: "s1",
    format,
    hook: { en: "hook en", ms: "hook ms", register: "curiosity" },
    shotlistEn: [SCENE],
    shotlistBm: [SCENE],
    thumbnailBrief: "tb",
    paletteEmphasis: "calm",
    estCostMyr: 100,
    source: {
      scriptBodyEn: "body en",
      scriptBodyMs: "body ms",
      ctaEn: "cta en",
      ctaMs: "cta ms",
      funnelStage: "MOFU",
      persona: "young_parents_25_35",
      topic: "Starting a unit trust",
      targetQuery: "unit trust malaysia",
      primaryLang: "en",
    },
  };
}

/** A P1-fanout result — array of per-Script worker outputs (the new shape). */
function fanoutResult(): unknown[] {
  return [
    {
      scriptId: "s1",
      creatives: [
        creativeUnit("Reel"),
        creativeUnit("Feed"),
        creativeUnit("YT-Long"),
        creativeUnit("Carousel"),
      ],
    },
  ];
}

describe("produceStage", () => {
  it("has 8 steps in P0..P6 order with the right kinds (P1a-reels-prepare inserted before P2-render)", () => {
    expect(produceStage.id).toBe("produce");
    expect(produceStage.steps.map((s) => s.id)).toEqual([
      "P0-scripts",
      "P1-fanout",
      "P1a-reels-prepare",
      "P2-render",
      "P3-persist",
      "P4-enrich",
      "P5-confirm",
      "P6-gate",
    ]);
    expect(produceStage.steps.map((s) => s.kind)).toEqual([
      "write",
      "fanout",
      "write",
      "fanout",
      "write",
      "write",
      "write",
      "gate",
    ]);
  });

  it("P0-scripts queries approved Scripts for the run", () => {
    const step = produceStage.steps[0]!.build(runWith([]));
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls[0]!.tool).toBe("mcp__store__query");
    const args = step.calls[0]!.args as { entity: string; filter: Record<string, unknown> };
    expect(args.entity).toBe("Scripts");
    expect(args.filter).toEqual({ runId: "run_p", approvalStatus: "Approved" });
  });

  it("P1-fanout dispatches one creative-director per approved Script, embedding a sr_ ref per unit (ADR-024)", async () => {
    const scriptsResult = [
      { id: "script-1", brief: "brief-1" },
      { id: "script-2", brief: "brief-1" },
    ];
    const c1Units = [
      { briefId: "brief-1", hooks: [{ en: "h", ms: "h", register: "curiosity" }], scripts: [] },
    ];
    const run = runWith([
      doneContent("C1-fanout", c1Units),
      doneStep("P0-scripts", [scriptsResult]),
    ]);
    const ctx = mockCtx();
    const step = await produceStage.steps[1]!.build(run, ctx);
    if (step.kind !== "fanout") throw new Error("expected fanout");
    expect(step.worker).toBe("creative-director");
    expect(step.units).toHaveLength(2);

    // Spawn prompts now carry only the sr_ ref and read instructions —
    // not the hook bank inline. ADR-024 §"Mechanism".
    expect(step.units[0]!.spawnPrompt).toContain("sr_MOCK_0");
    expect(step.units[1]!.spawnPrompt).toContain("sr_MOCK_1");
    expect(step.units[0]!.spawnPrompt).toContain("read_step_result");
    expect(step.units[0]!.spawnPrompt).toContain("Single-Script worker mode");
    expect(step.units[0]!.spawnPrompt).not.toContain("curiosity"); // hook bank no longer inline

    // Size budget — each spawnPrompt must be small. Pre-ADR-024 was ~7 KB
    // per unit (hook bank inlined). Now we expect well under 600 bytes.
    for (const u of step.units) {
      expect(u.spawnPrompt.length).toBeLessThan(600);
    }

    // The staged payloads carry { scriptId, briefId, hookBank }.
    expect(ctx.staged).toHaveLength(2);
    expect(ctx.staged[0]!.payload).toMatchObject({
      scriptId: "script-1",
      briefId: "brief-1",
    });
    expect(ctx.staged[1]!.payload).toMatchObject({
      scriptId: "script-2",
      briefId: "brief-1",
    });
  });

  it("P1-fanout throws if C1-fanout produced no hook banks", async () => {
    const run = runWith([
      doneStep("P0-scripts", [[{ id: "s1", brief: "brief-1" }]]),
    ]);
    await expect(produceStage.steps[1]!.build(run, mockCtx())).rejects.toThrow(
      /no hook banks|hookBanks/i,
    );
  });

  it("P1-fanout throws if P0-scripts returned no Scripts", async () => {
    const c1Units = [{ briefId: "brief-1", hooks: [], scripts: [] }];
    const run = runWith([
      doneContent("C1-fanout", c1Units),
      doneStep("P0-scripts", [[]]),
    ]);
    await expect(produceStage.steps[1]!.build(run, mockCtx())).rejects.toThrow(
      /no approved Scripts/,
    );
  });

  it("P2-render stages one render-unit spec per static creative as a sr_ ref (ADR-024)", async () => {
    const oldEnv = process.env.EDOS_REEL_PIPELINE;
    process.env.EDOS_REEL_PIPELINE = "off";  // hold Reels out so this test stays focused on the static branch
    try {
      const run = runWith([doneStep("P1-fanout", fanoutResult())]);
      const ctx = mockCtx();
      const step = await produceStage.steps[3]!.build(run, ctx);
      if (step.kind !== "fanout") throw new Error("expected fanout");
      expect(step.worker).toBe("render-worker");
      expect(step.units).toHaveLength(2); // Feed + Carousel

      for (const u of step.units) {
        expect(u.spawnPrompt).toContain("render-worker.md");
        expect(u.spawnPrompt).toContain("read_step_result");
        expect(u.spawnPrompt).toMatch(/sr_MOCK_[01]/);
        expect(u.spawnPrompt.length).toBeLessThan(600);
      }

      expect(ctx.staged).toHaveLength(2);
      for (const s of ctx.staged) {
        expect(s.payload).toMatchObject({ runId: "run_p", scriptId: "s1" });
      }
    } finally {
      if (oldEnv === undefined) delete process.env.EDOS_REEL_PIPELINE;
      else process.env.EDOS_REEL_PIPELINE = oldEnv;
    }
  });

  it("P3-persist builds one store.create per deriveSpecs variant, then an articles query", () => {
    const run = runWith([
      doneStep("P1-fanout", fanoutResult()),
      doneStep("P1a-reels-prepare", []),  // no Reel rows pre-created → fall through to create
      doneStep("P2-render", []),
    ]);
    const step = produceStage.steps[4]!.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(6);
    expect(step.calls.slice(0, 5).every((c) => c.tool === "mcp__store__create")).toBe(true);
    expect(step.calls[5]!.tool).toBe("mcp__store__query");
    const lastArgs = step.calls[5]!.args as { entity: string; filter: Record<string, unknown> };
    expect(lastArgs.entity).toBe("AuthorityArticles");
    expect(lastArgs.filter).toEqual({ runId: "run_p", approvalStatus: "Approved" });
  });

  it("P3-persist strips shotNotes from the stringified shotlist (compliance scanner doesn't see producer-only safety guidance)", () => {
    const run = runWith([
      doneStep("P1-fanout", fanoutResult()),
      doneStep("P1a-reels-prepare", []),
      doneStep("P2-render", []),
    ]);
    const step = produceStage.steps[4]!.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    const createCalls = step.calls.slice(0, 5);
    for (const c of createCalls) {
      const args = c.args as { props: Record<string, unknown> };
      const shotlistEn = args.props.shotlistEn as string;
      const shotlistBm = args.props.shotlistBm as string;
      expect(shotlistEn).not.toContain("shotNotes");
      expect(shotlistBm).not.toContain("shotNotes");
      expect(shotlistEn).toContain("voiceover");
      expect(shotlistEn).toContain("onScreenText");
    }
  });

  it("P3-persist recovers from a string-encoded P1-fanout unit (the rare CD worker that double-encodes its payload)", () => {
    const goodUnit = {
      scriptId: "s1",
      creatives: [
        creativeUnit("Reel"),
        creativeUnit("Feed"),
        creativeUnit("YT-Long"),
        creativeUnit("Carousel"),
      ],
    };
    const stringified = JSON.stringify({
      scriptId: "s2",
      creatives: [
        creativeUnit("Reel"),
        creativeUnit("Feed"),
        creativeUnit("YT-Long"),
        creativeUnit("Carousel"),
      ],
    });
    const run = runWith([
      doneStep("P1-fanout", [goodUnit, stringified]),
      doneStep("P1a-reels-prepare", []),
      doneStep("P2-render", []),
    ]);
    const step = produceStage.steps[4]!.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    // 5 variants per script × 2 scripts (1 object + 1 string-encoded) = 10 creates + 1 articles query
    expect(step.calls).toHaveLength(11);
    expect(step.calls.slice(0, 10).every((c) => c.tool === "mcp__store__create")).toBe(true);
  });

  it("P4-enrich emits a fill-only-if-empty update for an article with empty packaging", () => {
    const articles = [
      {
        id: "a1",
        titleEn: "My Title",
        topic: "T",
        targetQuery: "q",
        bodyEn: "body",
        slug: "",
        description: "",
        readingTime: "",
        keywords: [],
        topicTag: "",
        ogImageUrl: "",
      },
    ];
    const run = runWith([doneStep("P3-persist", [{}, {}, {}, {}, {}, articles])]);
    const step = produceStage.steps[5]!.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(1);
    expect(step.calls[0]!.tool).toBe("mcp__store__update");
    const args = step.calls[0]!.args as {
      entity: string;
      id: string;
      props: Record<string, unknown>;
      fillOnlyIfEmpty: boolean;
    };
    expect(args.entity).toBe("AuthorityArticles");
    expect(args.id).toBe("a1");
    expect(args.fillOnlyIfEmpty).toBe(true);
    expect(args.props).toHaveProperty("slug");
  });

  it("P4-enrich skips an article whose packaging is already filled", () => {
    const articles = [
      {
        id: "a1",
        titleEn: "T",
        topic: "T",
        targetQuery: "q",
        bodyEn: "body",
        slug: "t",
        description: "d",
        readingTime: "1 min read",
        keywords: ["k"],
        topicTag: "T",
        ogImageUrl: "u",
      },
    ];
    const run = runWith([doneStep("P3-persist", [{}, articles])]);
    const step = produceStage.steps[5]!.build(run);
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls).toHaveLength(0);
  });

  it("P5-confirm re-queries Scripts + CreativeVariants and its verify delegates to verifyProduce", () => {
    const step = produceStage.steps[6]!.build(runWith([]));
    if (step.kind !== "write") throw new Error("expected write");
    expect(step.calls.map((c) => c.tool)).toEqual([
      "mcp__store__query",
      "mcp__store__query",
    ]);
    expect(produceStage.steps[6]!.verify).toBeDefined();
  });

  it("P5.verify fails a short variant matrix from the store read", () => {
    const p5 = produceStage.steps[6]!;
    const run = runWith([
      doneStep("P1-fanout", fanoutResult()),
      doneStep("P2-render", [{ rendered: [] }, { rendered: [] }]),
    ]);
    const result = [
      [{ id: "s1" }],
      [
        {
          id: "v1",
          script: "s1",
          format: "Reel",
          aspect: "9:16",
          channels: ["Meta-paid"],
          assetFiles: [],
          metaPrimaryTextEn: "x",
          estimatedCostMyr: 100,
          complianceCheck: true,
        },
      ],
    ];
    expect(p5.verify!(run, result).ok).toBe(false);
  });

  it("P6 builds a gate Step for HG3 carrying a store check", () => {
    const step = produceStage.steps[7]!.build(runWith([]));
    if (step.kind !== "gate") throw new Error("expected gate");
    expect(step.gate).toBe("HG3");
    expect(step.check?.tool).toBe("mcp__store__query");
    const args = step.check?.args as { entity: string; filter: Record<string, unknown> };
    expect(args.entity).toBe("CreativeVariants");
    expect(args.filter).toEqual({ runId: "run_p", approvalStatus: "Approved" });
  });
});

// ── Reel pipeline (per 2026-05-28-heygen-reel-pipeline §6) ──
describe("produceStage — Reel pipeline (P1a-reels-prepare + P2-render Reel branch)", () => {
  // Setup needs the HeyGen env vars present for reelWorkerInput projection
  // AND EDOS_REEL_PIPELINE=on to activate the pipeline. Default is OFF
  // (PR 6 inverted from PR 4's accidental default-on semantic).
  //
  // Handles both sync and async callbacks — must await the result before the
  // finally restores env, otherwise async tests see post-restore state.
  async function withReelEnv<T>(run: () => T | Promise<T>): Promise<T> {
    const old = {
      avatar: process.env.HEYGEN_AVATAR_ID,
      voice: process.env.HEYGEN_VOICE_ID,
      flag: process.env.EDOS_REEL_PIPELINE,
    };
    process.env.HEYGEN_AVATAR_ID = "av_shoo_test";
    process.env.HEYGEN_VOICE_ID = "vo_en_test";
    process.env.EDOS_REEL_PIPELINE = "on";
    try {
      return await run();
    } finally {
      old.avatar === undefined ? delete process.env.HEYGEN_AVATAR_ID : (process.env.HEYGEN_AVATAR_ID = old.avatar);
      old.voice === undefined ? delete process.env.HEYGEN_VOICE_ID : (process.env.HEYGEN_VOICE_ID = old.voice);
      old.flag === undefined ? delete process.env.EDOS_REEL_PIPELINE : (process.env.EDOS_REEL_PIPELINE = old.flag);
    }
  }

  it("P1a-reels-prepare emits one mcp__store__create per Reel unit (Draft state)", async () => {
    await withReelEnv(() => {
      const run = runWith([doneStep("P1-fanout", fanoutResult())]);
      const step = produceStage.steps[2]!.build(run);
      if (step.kind !== "write") throw new Error("expected write");
      // fanoutResult has exactly 1 Reel CreativeUnit (per script)
      expect(step.calls).toHaveLength(1);
      expect(step.calls[0]!.tool).toBe("mcp__store__create");
      const args = step.calls[0]!.args as { entity: string; props: Record<string, unknown> };
      expect(args.entity).toBe("CreativeVariants");
      expect(args.props.format).toBe("Reel");
      expect(args.props.aspect).toBe("9:16");
      expect(args.props.approvalStatus).toBe("Draft");
      expect(args.props.createdBy).toBe("MediaProd");
    });
  });

  it("P1a-reels-prepare emits zero calls when EDOS_REEL_PIPELINE=off (kill switch)", () => {
    const old = process.env.EDOS_REEL_PIPELINE;
    process.env.EDOS_REEL_PIPELINE = "off";
    try {
      const run = runWith([doneStep("P1-fanout", fanoutResult())]);
      const step = produceStage.steps[2]!.build(run);
      if (step.kind !== "write") throw new Error("expected write");
      expect(step.calls).toHaveLength(0);
    } finally {
      old === undefined ? delete process.env.EDOS_REEL_PIPELINE : (process.env.EDOS_REEL_PIPELINE = old);
    }
  });

  it("P1a-reels-prepare emits zero calls when the plan has no Reels (Feed/Carousel-only Script)", async () => {
    await withReelEnv(() => {
      const noReelPlan: unknown[] = [
        { scriptId: "s1", creatives: [creativeUnit("Feed"), creativeUnit("Carousel")] },
      ];
      const run = runWith([doneStep("P1-fanout", noReelPlan)]);
      const step = produceStage.steps[2]!.build(run);
      if (step.kind !== "write") throw new Error("expected write");
      expect(step.calls).toHaveLength(0);
    });
  });

  it("P2-render mixed plan: emits static spawns + Reel spawns; sr_ refs only (ADR-024)", async () => {
    await withReelEnv(async () => {
      const run = runWith([
        doneStep("P1-fanout", fanoutResult()),
        doneStep("P1a-reels-prepare", [{ ok: true, id: "row-reel-1" }]),
      ]);
      const ctx = mockCtx();
      const step = await produceStage.steps[3]!.build(run, ctx);
      if (step.kind !== "fanout") throw new Error("expected fanout");
      // 2 static (Feed + Carousel) + 1 Reel = 3 spawns
      expect(step.units).toHaveLength(3);

      const reelPrompts = step.units.filter((u) =>
        u.spawnPrompt.includes("Reel render worker"),
      );
      expect(reelPrompts).toHaveLength(1);
      expect(reelPrompts[0]!.spawnPrompt).toContain("reel-render-worker.md");
      expect(reelPrompts[0]!.spawnPrompt).toContain("orphan-recovery");
      expect(reelPrompts[0]!.spawnPrompt).toMatch(/sr_MOCK_2/);  // reels staged after statics

      // Reel staged payload carries the row id from P1a + the heygen env IDs.
      const reelStaged = ctx.staged.find((s) => {
        const p = s.payload as { format?: string };
        return p.format === "Reel";
      });
      expect(reelStaged?.payload).toMatchObject({
        format: "Reel",
        aspect: "9:16",
        id: "row-reel-1",
        scriptId: "s1",
      });
    });
  });

  it("P2-render emits zero Reel spawns when EDOS_REEL_PIPELINE=off (explicit opt-out)", async () => {
    const old = process.env.EDOS_REEL_PIPELINE;
    process.env.EDOS_REEL_PIPELINE = "off";
    try {
      const run = runWith([
        doneStep("P1-fanout", fanoutResult()),
        doneStep("P1a-reels-prepare", []),
      ]);
      const ctx = mockCtx();
      const step = await produceStage.steps[3]!.build(run, ctx);
      if (step.kind !== "fanout") throw new Error("expected fanout");
      const reelPrompts = step.units.filter((u) =>
        u.spawnPrompt.includes("Reel render worker"),
      );
      expect(reelPrompts).toHaveLength(0);
      expect(step.units).toHaveLength(2);  // statics still spawn
    } finally {
      old === undefined ? delete process.env.EDOS_REEL_PIPELINE : (process.env.EDOS_REEL_PIPELINE = old);
    }
  });

  it("P1a + P2-render emit zero Reel work when EDOS_REEL_PIPELINE is UNSET (default off)", async () => {
    // PR 6 invariant: HeyGen costs real money; the pipeline must be opt-in.
    // Removing the env var leaves it off — neither P1a nor P2 should dispatch.
    const old = process.env.EDOS_REEL_PIPELINE;
    delete process.env.EDOS_REEL_PIPELINE;
    try {
      const run = runWith([doneStep("P1-fanout", fanoutResult())]);
      const p1a = produceStage.steps[2]!.build(run);
      if (p1a.kind !== "write") throw new Error("expected write");
      expect(p1a.calls).toHaveLength(0);

      const runWithP1a = runWith([
        doneStep("P1-fanout", fanoutResult()),
        doneStep("P1a-reels-prepare", []),
      ]);
      const p2 = await produceStage.steps[3]!.build(runWithP1a, mockCtx());
      if (p2.kind !== "fanout") throw new Error("expected fanout");
      const reelPrompts = p2.units.filter((u) =>
        u.spawnPrompt.includes("Reel render worker"),
      );
      expect(reelPrompts).toHaveLength(0);
    } finally {
      old === undefined ? delete process.env.EDOS_REEL_PIPELINE : (process.env.EDOS_REEL_PIPELINE = old);
    }
  });

  it("P1a + P2-render emit zero Reel work when EDOS_REEL_PIPELINE is set to anything other than 'on'", async () => {
    // Defensive: a typo or accidental truthy value must NOT enable Reels.
    const old = process.env.EDOS_REEL_PIPELINE;
    for (const v of ["", "true", "1", "yes", "ON", "Off"]) {
      process.env.EDOS_REEL_PIPELINE = v;
      const p1a = produceStage.steps[2]!.build(
        runWith([doneStep("P1-fanout", fanoutResult())]),
      );
      if (p1a.kind !== "write") throw new Error("expected write");
      expect(p1a.calls, `value "${v}" leaked through`).toHaveLength(0);
    }
    old === undefined ? delete process.env.EDOS_REEL_PIPELINE : (process.env.EDOS_REEL_PIPELINE = old);
  });

  it("P3-persist routes Reels with pre-existing rows through mcp__store__update (fillOnlyIfEmpty)", async () => {
    await withReelEnv(() => {
      const run = runWith([
        doneStep("P1-fanout", fanoutResult()),
        doneStep("P1a-reels-prepare", [{ ok: true, id: "row-reel-1" }]),
        doneStep("P2-render", []),
      ]);
      const step = produceStage.steps[4]!.build(run);
      if (step.kind !== "write") throw new Error("expected write");
      const reelCall = step.calls.find((c) => {
        const args = c.args as { props?: { format?: string } };
        return args.props?.format === "Reel";
      });
      expect(reelCall?.tool).toBe("mcp__store__update");
      const args = reelCall!.args as {
        entity: string;
        id: string;
        opts: { fillOnlyIfEmpty: boolean };
      };
      expect(args.entity).toBe("CreativeVariants");
      expect(args.id).toBe("row-reel-1");
      expect(args.opts.fillOnlyIfEmpty).toBe(true);

      // Static variants still go through create.
      const staticCalls = step.calls.filter((c) => {
        const args = c.args as { props?: { format?: string } };
        return args.props?.format !== "Reel" && c.tool !== "mcp__store__query";
      });
      expect(staticCalls.every((c) => c.tool === "mcp__store__create")).toBe(true);
    });
  });

  it("P1-fanout.verify rejects a Reel CreativeUnit missing sceneType (ReelShotlistSchema guard)", () => {
    // verify is gated by EDOS_REEL_PIPELINE=on (PR 6 — default off semantics).
    const old = process.env.EDOS_REEL_PIPELINE;
    process.env.EDOS_REEL_PIPELINE = "on";
    try {
      const malformedReel = {
        scriptId: "s1",
        creatives: [
          {
            ...creativeUnit("Reel"),
            // Strip the Reel-required fields. ReelShotlistSchema should fail.
            targetSeconds: 30,
            faceFirstHook: true,
            // scenes lack sceneType + estimatedSeconds
          },
        ],
      };
      const result = produceStage.steps[1]!.verify!(
        runWith([]),
        [malformedReel],
      );
      expect(result.ok).toBe(false);
      expect(result.problems[0]).toMatch(/ReelShotlistSchema/);
    } finally {
      old === undefined ? delete process.env.EDOS_REEL_PIPELINE : (process.env.EDOS_REEL_PIPELINE = old);
    }
  });

  it("P1-fanout.verify passes a well-formed Reel CreativeUnit", () => {
    // Force pipeline on to genuinely exercise the schema-pass path (otherwise
    // verify is a no-op and the test would pass vacuously under the PR 6
    // default-off semantic).
    const old = process.env.EDOS_REEL_PIPELINE;
    process.env.EDOS_REEL_PIPELINE = "on";
    try {
      const goodReel = {
        scriptId: "s1",
        creatives: [
          {
            ...creativeUnit("Reel"),
            // aspect intentionally absent — ADR-020: deterministic, derived
            // from format by the MATRIX. Schema no longer asks the agent for it.
            targetSeconds: 25,
            faceFirstHook: true,
            shotlistEn: [
              {
                scene: 1,
                durationSec: 4,
                visual: "v",
                onScreenText: "t",
                voiceover: "Most parents already know they should invest.",
                shotNotes: "s",
                chartRef: null,
                sceneType: "face",
                estimatedSeconds: 4,
              },
            ],
          },
        ],
      };
      const result = produceStage.steps[1]!.verify!(runWith([]), [goodReel]);
      expect(result.ok).toBe(true);
      expect(result.problems).toEqual([]);
    } finally {
      old === undefined ? delete process.env.EDOS_REEL_PIPELINE : (process.env.EDOS_REEL_PIPELINE = old);
    }
  });

  it("P1-fanout.verify is a no-op when kill switch is off", () => {
    const old = process.env.EDOS_REEL_PIPELINE;
    process.env.EDOS_REEL_PIPELINE = "off";
    try {
      const malformedReel = {
        scriptId: "s1",
        creatives: [creativeUnit("Reel")],  // no Reel fields at all
      };
      const result = produceStage.steps[1]!.verify!(
        runWith([]),
        [malformedReel],
      );
      // Kill switch on → verify is permissive (the worker doesn't run anyway)
      expect(result.ok).toBe(true);
    } finally {
      old === undefined ? delete process.env.EDOS_REEL_PIPELINE : (process.env.EDOS_REEL_PIPELINE = old);
    }
  });

  it("P3-persist falls back to create for Reels when P1a returned no row id (kill switch path)", async () => {
    await withReelEnv(() => {
      const run = runWith([
        doneStep("P1-fanout", fanoutResult()),
        doneStep("P1a-reels-prepare", []),  // empty result = no pre-created row
        doneStep("P2-render", []),
      ]);
      const step = produceStage.steps[4]!.build(run);
      if (step.kind !== "write") throw new Error("expected write");
      const reelCall = step.calls.find((c) => {
        const args = c.args as { props?: { format?: string } };
        return args.props?.format === "Reel";
      });
      expect(reelCall?.tool).toBe("mcp__store__create");  // backward-compatible fallback
    });
  });
});
