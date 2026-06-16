import { describe, it, expect, beforeEach } from "vitest";
import { reelWorkerInput, reelSkeletonProps, type ReelUnitWithId } from "./reel-worker-input.js";
import { variantId } from "@engineerdad/shared/derive";
import type { CreativeUnit, SceneCard } from "@engineerdad/shared/derive";

const baseSceneCard = (over: Partial<SceneCard> = {}): SceneCard => ({
  scene: 1,
  durationSec: 4,
  visual: "tight on face",
  onScreenText: "hook caption",
  voiceover: "Most parents already know they should invest.",
  shotNotes: "lower-third logo",
  chartRef: null,
  sceneType: "face",
  estimatedSeconds: 4,
  ...over,
});

const baseReelUnit = (over: Partial<CreativeUnit> = {}): CreativeUnit => ({
  scriptId: "script_abc",
  format: "Reel",
  hook: { en: "hook EN", ms: "hook BM", register: "curiosity" },
  shotlistEn: [
    baseSceneCard(),
    baseSceneCard({ scene: 2, sceneType: "visual", chartRef: "compounding-30y", durationSec: 6, estimatedSeconds: 6 }),
    baseSceneCard({ scene: 3, voiceover: "DM me REVIEW.", durationSec: 4 }),
  ],
  shotlistBm: [baseSceneCard()],
  thumbnailBrief: "engineer dad palette, hero stat",
  paletteEmphasis: "authoritative",
  estCostMyr: 50,
  source: {
    scriptBodyEn: "...",
    scriptBodyMs: "...",
    ctaEn: "DM me REVIEW",
    ctaMs: "DM saya REVIEW",
    funnelStage: "MOFU",
    persona: "engineer_dad_archetype",
    topic: "compounding",
    targetQuery: "child education fund malaysia",
    primaryLang: "en",
  },
  targetSeconds: 28,
  faceFirstHook: true,
  ...over,
});

describe("reelWorkerInput", () => {
  beforeEach(() => {
    process.env.HEYGEN_AVATAR_ID = "av_shoo";
    process.env.HEYGEN_VOICE_ID = "vo_en";
  });

  it("projects a valid Reel CreativeUnit + row id into the worker contract", () => {
    const withId: ReelUnitWithId = { unit: baseReelUnit(), id: "uuid-row-1" };
    const input = reelWorkerInput(withId, "run_123");
    expect(input.runId).toBe("run_123");
    expect(input.scriptId).toBe("script_abc");
    expect(input.id).toBe("uuid-row-1");
    expect(input.variantId).toBe(variantId("script_abc", "Reel", "9:16"));
    expect(input.format).toBe("Reel");
    expect(input.aspect).toBe("9:16");
    expect(input.width).toBe(1080);
    expect(input.height).toBe(1920);
    expect(input.language).toBe("en");
    expect(input.targetSeconds).toBe(28);
    expect(input.faceFirstHook).toBe(true);
    expect(input.scenes).toHaveLength(3);
    expect(input.scenes[0]?.voiceover).toBe("Most parents already know they should invest.");
    expect(input.scenes[1]?.sceneType).toBe("visual");
    expect(input.scenes[1]?.chartRef).toBe("compounding-30y");
    expect(input.heygen).toEqual({ avatarId: "av_shoo", voiceId: "vo_en" });
  });

  it("stringifies scene numbers (CreativeUnit uses int, worker input wants string)", () => {
    const input = reelWorkerInput(
      { unit: baseReelUnit(), id: "uuid-1" },
      "run_x",
    );
    expect(input.scenes[0]?.scene).toBe("1");
    expect(input.scenes[1]?.scene).toBe("2");
  });

  it("defaults targetSeconds to 30 when missing on the unit", () => {
    const u = baseReelUnit();
    delete (u as Partial<CreativeUnit>).targetSeconds;
    const input = reelWorkerInput({ unit: u, id: "u" }, "run_x");
    expect(input.targetSeconds).toBe(30);
  });

  it("defaults faceFirstHook to true when missing on the unit", () => {
    const u = baseReelUnit();
    delete (u as Partial<CreativeUnit>).faceFirstHook;
    const input = reelWorkerInput({ unit: u, id: "u" }, "run_x");
    expect(input.faceFirstHook).toBe(true);
  });

  it("falls back to scene.durationSec when estimatedSeconds is missing", () => {
    const u = baseReelUnit({
      shotlistEn: [baseSceneCard({ durationSec: 7, estimatedSeconds: undefined })],
    });
    const input = reelWorkerInput({ unit: u, id: "u" }, "run_x");
    expect(input.scenes[0]?.estimatedSeconds).toBe(7);
  });

  it("defaults sceneType to 'face' when missing (defensive — schema should set it)", () => {
    const u = baseReelUnit({
      shotlistEn: [baseSceneCard({ sceneType: undefined })],
    });
    const input = reelWorkerInput({ unit: u, id: "u" }, "run_x");
    expect(input.scenes[0]?.sceneType).toBe("face");
  });

  it("throws if asked to project a non-Reel unit", () => {
    const u = baseReelUnit({ format: "Feed" });
    expect(() =>
      reelWorkerInput({ unit: u, id: "u" }, "run_x"),
    ).toThrow(/expected Reel/);
  });

  it("throws if HEYGEN_AVATAR_ID is unset", () => {
    delete process.env.HEYGEN_AVATAR_ID;
    expect(() =>
      reelWorkerInput({ unit: baseReelUnit(), id: "u" }, "run_x"),
    ).toThrow(/HEYGEN_AVATAR_ID/);
  });

  it("throws if HEYGEN_VOICE_ID is unset", () => {
    delete process.env.HEYGEN_VOICE_ID;
    expect(() =>
      reelWorkerInput({ unit: baseReelUnit(), id: "u" }, "run_x"),
    ).toThrow(/HEYGEN_VOICE_ID/);
  });
});

describe("reelWorkerInput two-track plumbing", () => {
  beforeEach(() => {
    process.env.HEYGEN_AVATAR_ID = "av_1";
    process.env.HEYGEN_VOICE_ID = "vo_1";
  });

  it("projects paletteEmphasis from the unit", () => {
    const out = reelWorkerInput({ unit: baseReelUnit({ paletteEmphasis: "alert" }), id: "row1" }, "run_1");
    expect(out.paletteEmphasis).toBe("alert");
  });

  it("projects visualBrief/explains per scene, defaulting to null", () => {
    const unit = baseReelUnit({
      shotlistEn: [
        baseSceneCard(),
        baseSceneCard({ scene: 2, sceneType: "visual", chartRef: "compounding-30y", explains: "early start wins", estimatedSeconds: 6 }),
        baseSceneCard({ scene: 3, sceneType: "visual", chartRef: null, visualBrief: "Split screen saver vs investor.", explains: "cost of waiting", estimatedSeconds: 5 }),
      ],
    });
    const out = reelWorkerInput({ unit, id: "row1" }, "run_1");
    expect(out.scenes[0]).toMatchObject({ visualBrief: null, explains: null });
    expect(out.scenes[1]).toMatchObject({ sceneType: "visual", explains: "early start wins" });
    expect(out.scenes[2]).toMatchObject({ sceneType: "visual", visualBrief: "Split screen saver vs investor." });
  });
});

describe("reelSkeletonProps", () => {
  it("emits the minimal identity props for the P1a-reels-prepare write step", () => {
    const props = reelSkeletonProps(baseReelUnit(), "run_xyz");
    expect(props).toEqual({
      title: `Reel · 9:16 · ${variantId("script_abc", "Reel", "9:16")}`,
      runId: "run_xyz",
      createdBy: "MediaProd",
      approvalStatus: "Draft",
      script: "script_abc",
      format: "Reel",
      aspect: "9:16",
    });
  });

  it("title is unique per scriptId (so list views can disambiguate Reel rows in a multi-script run)", () => {
    const a = reelSkeletonProps(baseReelUnit({ scriptId: "script_A" }), "r");
    const b = reelSkeletonProps(baseReelUnit({ scriptId: "script_B" }), "r");
    expect(a.title).not.toBe(b.title);
  });
});
