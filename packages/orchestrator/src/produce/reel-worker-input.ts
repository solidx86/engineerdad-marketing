// Projection from a creative-director CreativeUnit + the skeleton-row id
// produced by P1a-reels-prepare → the ReelWorkerInput contract documented
// in corpus/templates/worker-prompts/reel-render-worker.md.
//
// The worker uses the staged input as the source of truth on entry (per
// ADR-024 — the spawn prompt carries only an sr_ ref). The `id` field
// is the database UUID of the pre-created CreativeVariant row; the worker
// updates that specific row during Step 3a (orphan recovery) and Step 8
// (final upload), and reads it at Step 0 to detect a resume scenario.

import { variantId } from "@engineerdad/shared/derive";
import type { CreativeUnit } from "@engineerdad/shared/derive";

export interface ReelWorkerInput {
  runId: string;
  scriptId: string;
  /** Database UUID of the CreativeVariants row (from P1a-reels-prepare). */
  id: string;
  /** Deterministic 12-hex-char identity hash from shared::variantId(). */
  variantId: string;
  format: "Reel";
  aspect: "9:16";
  width: 1080;
  height: 1920;
  language: "en";
  targetSeconds: number;
  faceFirstHook: boolean;
  paletteEmphasis: string;
  scenes: Array<{
    scene: string;
    voiceover: string;
    onScreenText: string;
    chartRef: string | null;
    sceneType: "face" | "visual";
    estimatedSeconds: number;
    visualBrief: string | null;
    explains: string | null;
  }>;
  heygen: { avatarId: string; voiceId: string };
}

export interface ReelUnitWithId {
  unit: CreativeUnit;
  id: string;
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Required env var not set: ${name}`);
  }
  return v;
}

export function reelWorkerInput(
  withId: ReelUnitWithId,
  runId: string,
): ReelWorkerInput {
  const { unit, id } = withId;
  if (unit.format !== "Reel") {
    throw new Error(`reelWorkerInput: expected Reel, got ${unit.format}`);
  }
  return {
    runId,
    scriptId: unit.scriptId,
    id,
    variantId: variantId(unit.scriptId, "Reel", "9:16"),
    format: "Reel",
    aspect: "9:16",
    width: 1080,
    height: 1920,
    language: "en",
    targetSeconds: unit.targetSeconds ?? 30,
    faceFirstHook: unit.faceFirstHook ?? true,
    paletteEmphasis: unit.paletteEmphasis,
    scenes: unit.shotlistEn.map((s) => ({
      scene: String(s.scene),
      voiceover: s.voiceover,
      onScreenText: s.onScreenText,
      chartRef: s.chartRef,
      sceneType: s.sceneType ?? "face",
      estimatedSeconds: s.estimatedSeconds ?? s.durationSec ?? 5,
      visualBrief: s.visualBrief ?? null,
      explains: s.explains ?? null,
    })),
    heygen: {
      avatarId: requireEnv("HEYGEN_AVATAR_ID"),
      voiceId: requireEnv("HEYGEN_VOICE_ID"),
    },
  };
}

/** Skeleton-row props for P1a-reels-prepare. Identity only — packaging
 *  (channels, estimatedCostMyr, organic, etc.) is filled by P3-persist after
 *  the worker completes and the assetFiles land. */
export function reelSkeletonProps(unit: CreativeUnit, runId: string): {
  title: string;
  runId: string;
  createdBy: string;
  approvalStatus: string;
  script: string;
  format: "Reel";
  aspect: "9:16";
} {
  return {
    title: `Reel · 9:16 · ${variantId(unit.scriptId, "Reel", "9:16")}`,
    runId,
    createdBy: "MediaProd",
    approvalStatus: "Draft",
    script: unit.scriptId,
    format: "Reel",
    aspect: "9:16",
  };
}
