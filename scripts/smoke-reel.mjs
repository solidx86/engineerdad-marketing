#!/usr/bin/env node
// NOTE (2026-05-31): stale — references the deleted @engineerdad/media-stitch (ADR-028/B-034). Kept for reference; the live frames-only harness is scripts/test-reel-frames.mjs.
// G2 sandbox smoke test (per 2026-05-28-heygen-reel-pipeline §9).
//
// Drives the Reel pipeline end-to-end against a sandbox DB to verify the
// integration before flipping EDOS_REEL_PIPELINE=on in production:
//   1. Submits a HeyGen avatar render of a hard-coded test script.
//   2. Polls until completion.
//   3. Acquires word timings (HeyGen SRT if present, else whisper if
//      WHISPER_MODEL_PATH is set, else proportional fallback).
//   4. Renders any chart frames via static-renderer.
//   5. Stitches via @engineerdad/media-stitch.
//   6. Logs the local mp4 path + duration + warnings.
//
// Runs OUTSIDE the orchestrator — no run row, no CreativeVariant row, no
// asset-store upload. The goal is to prove the worker mechanics work
// before letting /produce dispatch a real worker. After this passes,
// run `/produce --run=<sandbox-runId>` against a sandbox DB with one
// Reel-only Script to exercise the full HG3 review path.
//
// Required env:
//   HEYGEN_API_KEY               (real API key — this script costs money)
//   HEYGEN_AVATAR_ID        Shoo's Instant Avatar id
//   HEYGEN_VOICE_ID           HeyGen voice id for the EN narration
//
// Optional env:
//   WHISPER_MODEL_PATH           ggml model path; enables whisper fallback
//   DOCKER_HOST                  forces Docker for ffmpeg (else host bin)
//
// Usage:
//   pnpm tsx scripts/smoke-reel.mjs

import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`error: required env var not set: ${name}`);
    process.exit(2);
  }
  return v;
}

function log(...args) {
  console.log("[smoke-reel]", ...args);
}

// ── Test script — a 3-scene Reel that exercises face + visual cuts ──
const SCENES = [
  {
    sceneType: "face",
    voiceover:
      "Most parents I speak with already know they should invest for their child.",
    estimatedSeconds: 5,
    chartRef: null,
  },
  {
    sceneType: "visual",
    voiceover:
      "Here is what one hundred ringgit a month becomes over thirty years.",
    estimatedSeconds: 6,
    chartRef: "compounding-30y",
  },
  {
    sceneType: "face",
    voiceover: "Start early. Stay consistent. Let time work for you.",
    estimatedSeconds: 4,
    chartRef: null,
  },
];

async function main() {
  const apiKey = requireEnv("HEYGEN_API_KEY");
  const avatarId = requireEnv("HEYGEN_AVATAR_ID");
  const voiceId = requireEnv("HEYGEN_VOICE_ID");

  // Dynamic imports so the script can fail-fast on env BEFORE requiring deps.
  const { generateVideo, getVideoStatus } = await import(
    pathToFileUrl(join(repoRoot, "mcp-servers/heygen-wrapper/dist/heygen.js"))
  );
  const mediaStitch = await import(
    pathToFileUrl(join(repoRoot, "packages/media-stitch/dist/index.js"))
  );
  const {
    stitch,
    alignScenesToTimings,
    parseSrtToWordTimings,
    transcribeToWordTimings,
  } = mediaStitch;

  const workDir = await mkdtemp(join(tmpdir(), "smoke-reel-"));
  log(`workDir: ${workDir}`);

  // 1. Submit HeyGen render of the full narration
  const scriptText = SCENES.map((s) => s.voiceover).join("  ");
  log("submitting HeyGen render …");
  const { jobId } = await generateVideo({
    avatar_id: avatarId,
    voice_id: voiceId,
    input_text: scriptText,
    language: "en",
    aspect_ratio: "9:16",
  });
  log(`heygenJobId: ${jobId}`);

  // 2. Poll until completion
  let status;
  for (let i = 0; i < 30; i++) {
    await sleep(10_000);
    status = await getVideoStatus({ jobId });
    log(`poll ${i + 1}: ${status.status}`);
    if (status.status === "completed") break;
    if (status.status === "failed") {
      throw new Error(`HeyGen render failed: ${status.error}`);
    }
  }
  if (status?.status !== "completed") {
    throw new Error("HeyGen poll timeout after 5 minutes");
  }
  log(`videoUrl: ${status.videoUrl}`);
  log(`subtitleUrl: ${status.subtitleUrl ?? "<none — whisper fallback>"}`);
  log(`durationSeconds: ${status.durationSeconds ?? "<not reported>"}`);

  // 3. Acquire word timings
  let timings = [];
  if (status.subtitleUrl) {
    const srt = await (await fetch(status.subtitleUrl)).text();
    timings = parseSrtToWordTimings(srt);
    log(`word timings (from HeyGen SRT): ${timings.length} words`);
  } else if (process.env.WHISPER_MODEL_PATH) {
    timings = await transcribeToWordTimings(status.videoUrl, workDir);
    log(`word timings (from whisper): ${timings.length} words`);
  } else {
    log(
      "no SRT and no WHISPER_MODEL_PATH — proceeding with proportional fallback",
    );
  }

  // 4. Map scenes to time ranges
  const totalDur =
    status.durationSeconds ??
    SCENES.reduce((a, s) => a + s.estimatedSeconds, 0);
  const timeline = alignScenesToTimings(
    timings,
    SCENES.map((s) => ({
      voiceover: s.voiceover,
      estimatedSeconds: s.estimatedSeconds,
    })),
    totalDur,
  );
  log("scene timeline:");
  for (const t of timeline) {
    log(
      `  scene ${t.sceneIndex}: ${t.startSec.toFixed(2)}s → ${t.endSec.toFixed(
        2,
      )}s (matched=${t.matched})`,
    );
  }

  // 5. Render visual frames via static-renderer MCP (here: just use a stub PNG
  //    if the static-renderer dist isn't available; the real /produce flow
  //    goes through mcp__static-renderer__render_html_to_png).
  const chartFrames = {};
  for (let i = 0; i < SCENES.length; i++) {
    const sc = SCENES[i];
    if (sc.chartRef) {
      log(`would render chart "${sc.chartRef}" for scene ${i} (skipped in smoke; supply via mcp__static-renderer in /produce)`);
      // For the smoke, you can pre-render a chart PNG yourself and drop it
      // at workDir/chart-${i}.png — the smoke proceeds either way (the
      // stitcher will emit a warning if the file is missing).
      const candidate = join(workDir, `chart-${i}.png`);
      if (existsSync(candidate)) chartFrames[i] = candidate;
    }
  }

  // 6. Build StitchSpec and stitch
  const cuts = timeline.map((t, i) => {
    const scene = SCENES[t.sceneIndex];
    if (scene.sceneType === "face") {
      return {
        type: "face",
        startSec: t.startSec,
        endSec: t.endSec,
        source: { url: status.videoUrl },
      };
    }
    const framePngPath = chartFrames[i];
    if (!framePngPath) {
      log(`scene ${i} is visual but no PNG was prerendered — falling back to face cut`);
      return {
        type: "face",
        startSec: t.startSec,
        endSec: t.endSec,
        source: { url: status.videoUrl },
      };
    }
    return {
      type: "visual",
      startSec: t.startSec,
      endSec: t.endSec,
      framePngPath,
    };
  });

  log("stitching …");
  const result = await stitch({
    workDir,
    output: { width: 1080, height: 1920, durationSeconds: totalDur },
    audioTrack: { url: status.videoUrl },
    cuts,
  });

  log("============================================");
  log(`OK  mp4Path:         ${result.mp4Path}`);
  log(`    durationSeconds: ${result.durationSeconds}`);
  log(`    warnings:        ${JSON.stringify(result.warnings)}`);
  log("============================================");
  log("Next: `/produce --run=<sandbox-runId>` against a sandbox DB with one");
  log("      Reel-only Script to exercise the full HG3 review path.");

  // Intentionally NOT cleaning up workDir — leave the mp4 for inspection.
  log(`(workDir preserved for inspection — clean up later: rm -rf ${workDir})`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pathToFileUrl(p) {
  return new URL(`file://${p}`).href;
}

main().catch((err) => {
  console.error("[smoke-reel] FAILED:", err);
  process.exit(1);
});
