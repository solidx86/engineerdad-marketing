# HeyGen Reel Pipeline — Implementation Plan

> **SUPERSEDED (2026-05-29) by ADR-028 and `docs/superpowers/plans/2026-05-29-heygen-native-scene-assembly.md`. The local-stitch architecture below is historical; the reel pipeline now uses HeyGen-native multi-scene assembly.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Reel-format gap in the produce stage so every Reel CreativeUnit reaches HG3 with a playable MP4 in `assetFiles[0].url`. Replaces TASKS.md E-004's kie.ai-based plan with a HeyGen + static-renderer + ffmpeg stitcher that matches the EngineerDad brand voice ("show the math, not stock footage").

**Architecture:** A new render path parallel to the static-renderer Feed/Carousel path. The Reel worker (1) submits one HeyGen call for the full narration, (2) acquires word-level timings from HeyGen SRT or whisper fallback, (3) renders chart frames via the existing static-renderer for `chartRef` scenes, (4) stitches face + chart cuts with burned-in EN subtitles via a new `packages/media-stitch` library that shells out to ffmpeg in Docker, (5) uploads via asset-store. HeyGen jobId is persisted to the CreativeVariant row *before* polling begins so a worker crash never orphans a HeyGen invocation (the scar at `packages/orchestrator/src/exec.ts:92`).

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, Drizzle (Postgres schema), Claude Code subagents (`reel-render-worker.md`, `creative-director.md`), Docker (for ffmpeg sandbox), HeyGen v2 API, whisper (fallback only).

**Branching model:** A long-lived integration branch `feat/heygen-reel-pipeline` is branched off `main` (the prerequisite `feat/brain-experiment-params` distribute refactor + Distributions entity merged to main on 2026-05-29). All 5 implementation PRs target the integration branch; once they all merge and G2 sandbox smoke + manual HG3 approval pass, the integration branch merges to main as one squash-merge. Rebase the integration branch onto main at the start of each PR. Spec at `docs/superpowers/specs/2026-05-28-heygen-reel-pipeline-design.html`.

---

## Task 1: Schema migration — add `reelHeygenJobId` and `renderState` to CreativeVariants

**Files:**
- Modify: `packages/store/src/schema.ts`
- Generate: `packages/store/drizzle/<n>_<name>.sql` (Drizzle migration)
- Modify: `packages/shared/src/types.ts` (CreativeVariant type extension)
- Modify: `packages/shared/src/zod.ts` (CreativeVariantSchema)
- Add tests: `packages/store/src/crud.test.ts` (new render-state cases)

Add two nullable columns supporting Reel orphan recovery. Backward-compatible with existing Feed/Carousel rows (both stay `null`).

- [ ] **Step 1: Extend schema definition**

In `packages/store/src/schema.ts`, find the `creativeVariants` `pgTable` definition and append:

```ts
reelHeygenJobId: text("reel_heygen_job_id"),                                 // null for static renders
renderState: text("render_state"),                                  // enum below; null for static
renderStartedAt: timestamp("render_started_at", { withTimezone: true }),
```

Also add the enum constant near the top of the schema file:

```ts
export const RENDER_STATE = [
  "HeygenGenerating",
  "HeygenCompleted",
  "Stitching",
  "Uploaded",
  "RenderFailed",
] as const;
```

- [ ] **Step 2: Generate migration**

```bash
pnpm db:sandbox     # apply schema change to branch sandbox first
pnpm db:generate    # produce SQL migration
```

Verify the generated SQL only adds columns; no destructive changes. Commit `schema.ts` + generated `packages/store/drizzle/` files together (per the CLAUDE.md database workflow rule).

- [ ] **Step 3: Extend TypeScript types**

In `packages/shared/src/types.ts`, find the `CreativeVariant` interface and add:

```ts
reelHeygenJobId?: string | null;
renderState?: "HeygenGenerating" | "HeygenCompleted" | "Stitching" | "Uploaded" | "RenderFailed" | null;
renderStartedAt?: string | null;
```

- [ ] **Step 4: Extend Zod schema**

In `packages/shared/src/zod.ts`, find `CreativeVariantSchema` and add the three new optional fields. Export `RenderStateEnum` as `z.enum(RENDER_STATE)`.

- [ ] **Step 5: CRUD test coverage**

In `packages/store/src/crud.test.ts`, add tests:
- Insert CreativeVariant with no render fields → all three null
- Update with `renderState: "HeygenGenerating"` + `reelHeygenJobId` → reads back correctly
- Update with `renderState: "RenderFailed"` → reads back correctly

- [ ] **Step 6: Verify migration lint**

```bash
pnpm lint:migrations
```

Must pass before commit.

---

## Task 2: `ReelShotlistSchema` in `packages/shared/src/zod.ts`

**Files:**
- Modify: `packages/shared/src/zod.ts`
- Add tests: `packages/shared/src/zod.test.ts`

The shape creative-director must emit for Reels. Validated at the orchestrator boundary.

- [ ] **Step 1: Define schema**

In `packages/shared/src/zod.ts`, after the existing `CreativeUnitSchema`:

```ts
export const ReelSceneTypeEnum = z.enum(["face", "chart", "face-over-chart"]);

export const ReelShotlistSceneSchema = z.object({
  scene: z.string(),
  voiceover: z.string().refine(
    (s) => s.trim().split(/\s+/).length <= 30,
    { message: "voiceover must be ≤ 30 words" },
  ),
  onScreenText: z.string(),
  chartRef: z.string().nullable(),
  shotNotes: z.string(),
  sceneType: ReelSceneTypeEnum,
  estimatedSeconds: z.number().positive(),
}).refine(
  (s) => s.sceneType === "face" || s.chartRef !== null,
  { message: "chart and face-over-chart scenes require chartRef" },
);

export const ReelShotlistSchema = z.object({
  format: z.literal("Reel"),
  aspect: z.literal("9:16"),
  hook: z.object({ en: z.string(), ms: z.string() }),
  shotlistEn: z.array(ReelShotlistSceneSchema).min(1),
  targetSeconds: z.number().int().min(15).max(60),
  faceFirstHook: z.boolean(),
});

export type ReelShotlist = z.infer<typeof ReelShotlistSchema>;
```

- [ ] **Step 2: Test acceptance**

```ts
describe("ReelShotlistSchema", () => {
  it("accepts a valid 3-scene Reel", () => { /* face + chart + face */ });
  it("rejects targetSeconds < 15", () => { /* expect parse failure */ });
  it("rejects targetSeconds > 60", () => { /* expect parse failure */ });
  it("rejects chart scene with null chartRef", () => { /* expect failure */ });
  it("rejects voiceover > 30 words", () => { /* expect failure */ });
  it("accepts face scene with null chartRef", () => { /* expect parse OK */ });
});
```

---

## Task 3: `packages/media-stitch` — new package skeleton

**Files:**
- Add: `packages/media-stitch/package.json`
- Add: `packages/media-stitch/tsconfig.json`
- Add: `packages/media-stitch/src/index.ts` (public API)
- Add: `packages/media-stitch/src/types.ts` (StitchSpec, StitchResult)
- Modify: `pnpm-workspace.yaml` (if needed — most likely already globbed)

- [ ] **Step 1: Scaffold package**

Mirror `packages/static-renderer/package.json` structure. Dependencies: none at runtime (uses node:child_process, node:fs); dev deps: `vitest`, `@types/node`.

- [ ] **Step 2: Define public types in `src/types.ts`**

```ts
export type Cut =
  | { type: "face"; startSec: number; endSec: number; source: { url: string } }
  | { type: "chart"; startSec: number; endSec: number; framePngPath: string };

export interface StitchSpec {
  workDir: string;
  output: { width: number; height: number; durationSeconds: number };
  audioTrack: { url: string };
  cuts: Cut[];
  subtitles?: { srtPath: string };
  music?: { url: string; gainDb: number };
}

export interface StitchResult {
  mp4Path: string;
  durationSeconds: number;
  warnings: string[];
}
```

- [ ] **Step 3: Stub `stitch()` in `src/index.ts`**

Export `stitch(spec: StitchSpec): Promise<StitchResult>` that throws "not implemented" — the real implementation lands in Task 4–6. This step is just so the package compiles and can be imported by tests.

---

## Task 4: `build-filtergraph.ts` — pure ffmpeg argv constructor

**Files:**
- Add: `packages/media-stitch/src/build-filtergraph.ts`
- Add: `packages/media-stitch/src/build-filtergraph.test.ts`
- Add: `packages/media-stitch/__fixtures__/` (snapshot files)

The single highest-risk function in the package — translates `StitchSpec` to ffmpeg argv. Pure. No subprocess. Snapshot-tested.

- [ ] **Step 1: Write failing tests with golden snapshots**

```ts
describe("buildFilterGraph", () => {
  it("handles a single face cut with audio passthrough", () => {
    const argv = buildFilterGraph(singleFaceSpec);
    expect(argv).toMatchSnapshot();
  });
  it("handles 4 cuts (face, chart, face, chart) with subtitle burn-in", () => {
    /* ... */
  });
  it("handles face-over-chart PiP via overlay filter", () => {
    /* ... */
  });
  it("includes amix + volume filters when music present", () => {
    /* ... */
  });
});
```

Run once with `vitest --update-snapshots` to capture initial argv arrays as golden files. Commit them.

- [ ] **Step 2: Implement filtergraph builder**

The argv shape (rough sketch):
- `-i <audioTrack.url>` (HeyGen mp4 — provides audio)
- One `-i` per unique cut source (face URLs and chart PNG paths)
- `-filter_complex` with:
  - `[0:a]` → audio passthrough (no resynthesis)
  - One video stream per cut: face cuts are trim+setpts from HeyGen video; chart cuts are `[i:v]scale=1080:1920,setpts...`
  - `concat=n=N:v=1:a=0` joining all video segments
  - Optional `subtitles=<srtPath>:force_style=...` filter on the concatenated video
  - Optional `[0:a][music]amix=inputs=2:duration=first:weights=1 0.3[aout]` if music present
- `-map "[vout]" -map "[aout]"`
- `-c:v libx264 -preset medium -crf 23 -c:a aac -b:a 128k`
- `<workDir>/output.mp4`

- [ ] **Step 3: Verify snapshots match across re-runs**

Build twice; assert identical argv arrays. This guards against non-determinism (e.g., Map iteration order).

---

## Task 5: `scene-to-time.ts` — word-timing aligner

**Files:**
- Add: `packages/media-stitch/src/scene-to-time.ts`
- Add: `packages/media-stitch/src/scene-to-time.test.ts`

Given a transcript with word-level timings and a list of scenes, return `Array<{ sceneIndex, startSec, endSec, matched: boolean }>`.

- [ ] **Step 1: Write tests covering each branch**

```ts
describe("alignScenesToTimings", () => {
  it("exact-matches a clean transcript", () => { /* scene voiceover appears verbatim */ });
  it("punctuation-fuzzy-matches normalized text", () => { /* 'hello, world' vs 'hello world' */ });
  it("falls back to proportional when string-match fails for one scene", () => {
    /* partial: scene[1] not found → endSec[0]→duration distributed */
  });
  it("falls back fully when transcript is empty", () => {
    /* all scenes proportional */
  });
  it("reports matched=false for fallback scenes", () => { /* ... */ });
});
```

- [ ] **Step 2: Implement**

Two-pass: first pass tries exact-match (case-insensitive, whitespace-normalized). For unmatched scenes, second pass distributes their proportional share of remaining duration. Return per-scene `matched: boolean`.

---

## Task 6: `stitch()` end-to-end implementation

**Files:**
- Modify: `packages/media-stitch/src/index.ts`
- Add: `packages/media-stitch/src/docker-run.ts` (Docker invocation helper)
- Add: `packages/media-stitch/src/download.ts` (URL → workDir/<n>.mp4)
- Add: `packages/media-stitch/src/probe.ts` (ffprobe wrapper for output validation)
- Add: `packages/media-stitch/integration.test.ts` (Docker-required)

- [ ] **Step 1: Implement Docker invocation**

`docker-run.ts` exposes `runFfmpegInDocker(argv: string[], workDir: string): Promise<{ stdout, stderr, exitCode }>`. Uses `docker run --rm -v ${workDir}:/work jrottenberg/ffmpeg:6.1 <argv-relative-to-/work>`. All argv paths re-rooted to `/work`.

If `DOCKER_HOST` is unset AND `which ffmpeg` returns a path, fall back to host ffmpeg with a log line. This is the escape hatch for environments without Docker.

- [ ] **Step 2: Implement URL downloader**

Streams remote URLs (HeyGen mp4, chart PNGs if remote, music if remote) to `${workDir}/cuts/<index>.<ext>` before running ffmpeg. Returns a path-rewriting map so `buildFilterGraph` argv references local paths.

- [ ] **Step 3: Implement `stitch()`**

```ts
export async function stitch(spec: StitchSpec): Promise<StitchResult> {
  const warnings: string[] = [];
  const localized = await localizeAllSources(spec);  // download remote URLs
  const argv = buildFilterGraph(localized);
  const { exitCode, stderr } = await runFfmpegInDocker(argv, spec.workDir);
  if (exitCode !== 0) throw new MediaStitchError(stderr.slice(-4096));

  const mp4Path = path.join(spec.workDir, "output.mp4");
  const probe = await ffprobe(mp4Path);
  if (probe.duration < spec.output.durationSeconds * 0.9) {
    warnings.push(`output duration ${probe.duration}s vs expected ${spec.output.durationSeconds}s`);
  }
  return { mp4Path, durationSeconds: probe.duration, warnings };
}
```

- [ ] **Step 4: Write integration test (Docker required)**

`integration.test.ts` (marked `test.skip` if `DOCKER_HOST` unset):
- Fixtures: 3s test mp4 in `__fixtures__/face.mp4`, 1080×1920 chart PNG in `__fixtures__/chart.png`, 5-line SRT
- Call `stitch()` with a 3-cut spec
- Assert output mp4 exists, plays, ffprobe reports correct resolution + codec
- Assert subtitle stream is present (or burned-in pixel-detected if burned)

- [ ] **Step 5: Run `pnpm -r build` (sequential, NOT parallel)**

Verify `packages/media-stitch` builds cleanly alongside the rest of the workspace.

---

## Task 7: HeyGen wrapper — surface `subtitleUrl` and `durationSeconds`

**Files:**
- Modify: `mcp-servers/heygen-wrapper/src/heygen.ts`
- Modify: `mcp-servers/heygen-wrapper/src/index.ts` (tool result schema, if declared)
- Add tests: `mcp-servers/heygen-wrapper/src/__tests__/heygen.test.ts`

Additive — never breaks existing callers. Existing `videoUrl` field still returned.

- [ ] **Step 1: Probe HeyGen v1 status response shape**

Run a manual one-off against the real HeyGen API (in dev only) to determine whether the account tier returns `subtitle_url` and `duration` fields in the completed-status payload. Document findings in a comment in `heygen.ts`.

- [ ] **Step 2: Extend return type**

```ts
export async function getVideoStatus(args: { jobId: string }): Promise<{
  status: "processing" | "completed" | "failed";
  videoUrl?: string;
  subtitleUrl?: string;        // NEW
  durationSeconds?: number;    // NEW
  error?: string;
}>
```

If the upstream JSON doesn't include the new fields (older tier), leave them `undefined` — caller handles fallback.

- [ ] **Step 3: Test extension**

```ts
it("surfaces subtitleUrl when HeyGen returns it", () => {
  // mock HeyGen response with subtitle_url
  expect(result.subtitleUrl).toBe("https://...");
});
it("leaves subtitleUrl undefined when HeyGen omits it", () => {
  expect(result.subtitleUrl).toBeUndefined();
});
```

---

## Task 8: Whisper fallback — optional dependency

**Files:**
- Add: `packages/media-stitch/src/whisper.ts`
- Add: `packages/media-stitch/src/whisper.test.ts`

Only invoked if HeyGen `subtitleUrl` is missing. Defer the dependency decision (Python `openai-whisper` vs `whisper.cpp`) until Task 7 confirms whether HeyGen returns SRT.

- [ ] **Step 1: Define interface**

```ts
export interface WordTiming { word: string; startSec: number; endSec: number; }
export async function transcribeToWordTimings(audioPath: string): Promise<WordTiming[]>;
```

- [ ] **Step 2: Choose backend**

If Task 7 confirms HeyGen returns SRT: stub this with `throw new Error("whisper fallback not configured")` — never invoked. Leave the file as a future hook.

If Task 7 confirms HeyGen does NOT return SRT: implement via `whisper.cpp` Docker image (no Python dep, faster, deterministic version pinning). Same Docker pattern as ffmpeg.

- [ ] **Step 3: Test against fixture audio**

If implemented, supply a 5-second audio fixture with known content; assert word array length and approximate timings.

---

## Task 9: `reel-render-worker.md` prompt

**Files:**
- Add: `corpus/templates/worker-prompts/reel-render-worker.md`

Mirror the existing `corpus/templates/worker-prompts/render-worker.md` structure.

- [ ] **Step 1: Define input schema in prompt**

Document the `ReelWorkerInput` shape (see spec §5.2) explicitly with field-by-field meaning. Worker MUST call `mcp__orchestrator__read_step_result` first.

- [ ] **Step 2: Document the 8-step procedure**

Mirror spec §6 Phase 2 — Steps 1–8 with explicit MCP calls and the orphan-recovery write at Step 3a (`mcp__store__update` before polling).

- [ ] **Step 3: Document the output JSON shape**

Worker must return the `WorkerOutput` JSON (see spec §5.2) as its final message.

- [ ] **Step 4: Document failure conventions**

- HeyGen failed: write `renderState: "RenderFailed"`, return JSON with `error` field, exit.
- Chart render fail: write `renderState: "RenderFailed"`, return JSON with `error`, exit.
- Stitch fail: same.
- Worker should never auto-retry HeyGen `failed` or ffmpeg errors.

---

## Task 10: Orchestrator P2-render Reel branch

**Files:**
- Modify: `packages/orchestrator/src/stages/produce.ts`
- Modify: `packages/orchestrator/src/stages/produce.test.ts`
- Modify: `packages/orchestrator/src/verifiers/verify-produce.ts` (if format matrix changes)
- Add: `packages/orchestrator/src/produce/reel-worker-input.ts` (projection helper)
- Add: `packages/orchestrator/src/produce/reel-worker-input.test.ts`

- [ ] **Step 1: Extend STATIC_FORMATS handling**

In `produce.ts`, find:

```ts
const STATIC_FORMATS = new Set<CreativeUnit["format"]>(["Feed", "Carousel"]);
```

Keep this. The Reel branch is *additional*, not a STATIC_FORMATS modification.

- [ ] **Step 2: Add reel projection helper**

```ts
// reel-worker-input.ts
export function reelWorkerInput(unit: CreativeUnit, runId: string): ReelWorkerInput {
  return {
    runId,
    scriptId: unit.scriptId,
    variantId: variantId(unit.scriptId, "Reel", "9:16"),
    format: "Reel",
    aspect: "9:16",
    width: 1080,
    height: 1920,
    language: "en",
    targetSeconds: unit.targetSeconds,
    faceFirstHook: unit.faceFirstHook,
    scenes: unit.shotlistEn,
    heygen: {
      avatarId: requireEnv("HEYGEN_AVATAR_ID"),
      voiceId: requireEnv("HEYGEN_VOICE_ID"),
    },
  };
}
```

- [ ] **Step 3: Add Reel fanout branch in P2-render**

Find the existing `p2Render.build` function. After the static fanout construction, add:

```ts
const reelEnabled = process.env.EDOS_REEL_PIPELINE === "on";   // default OFF — opt-in only
const reels = reelEnabled
  ? plan.creatives.filter((c) => c.format === "Reel")
  : [];

const reelUnits = await Promise.all(reels.map(async (unit, i) => {
  const existing = await readExistingVariant(unit.scriptId);  // check resume
  const input = reelWorkerInput(unit, run.runId);
  if (existing?.renderState === "HeygenGenerating" && existing.reelHeygenJobId) {
    input.resumeFromJobId = existing.reelHeygenJobId;
  }
  const inputRef = await ctx.stageInput(`reel-${i}`, input);
  return {
    spawnPrompt: reelSpawnPrompt(inputRef),
  };
}));
```

Merge `reelUnits` with the existing static `units` array in the returned fanout.

- [ ] **Step 4: Update orchestrator tests**

In `produce.test.ts`, add a test case with a mixed plan (2 Scripts × {Reel, Feed, YT-Long, Carousel} = 8 units). Assert:
- P2-render emits exactly 6 static-render spawn prompts + 2 reel-render spawn prompts
- All spawn prompts carry only `sr_…` refs (ADR-024)
- A pre-existing CreativeVariant row with `renderState="HeygenGenerating"` + `reelHeygenJobId="job_xyz"` produces a spawn prompt whose staged input includes `resumeFromJobId: "job_xyz"`

- [ ] **Step 5: Kill-switch test**

```ts
it("skips Reel units when EDOS_REEL_PIPELINE=off", async () => {
  process.env.EDOS_REEL_PIPELINE = "off";
  // ... build plan, assert no reel-render spawns emitted
});
```

---

## Task 11: Extend creative-director prompt with Reel shotlist rules

**Files:**
- Modify: `packages/shared/src/prompts/creative-director.md` (the source-of-truth fragment per CLAUDE.md `pnpm sync:agents`)
- After edit run: `pnpm sync:agents` to re-paste into `.claude/agents/creative-director.md`
- Verify: `pnpm sync:agents:check` passes

- [ ] **Step 1: Add a new "Reel shotlist" section after the existing static-format sections**

Content (copy-paste-able into the prompt):

```markdown
## Reel shotlist (NEW format requirements)

For the Reel CreativeUnit, your shotlist MUST conform to ReelShotlistSchema. In addition to the per-scene fields you produce for static formats:

- `sceneType`: one of `face`, `chart`, `face-over-chart`. Face = HeyGen avatar fills frame. Chart = full-screen chart from `corpus/data/charts/`. Face-over-chart = avatar in lower-third over chart.
- `estimatedSeconds`: your best estimate of how long the voiceover takes when spoken. Used only as a planning hint; the worker measures actual audio length.
- `chartRef`: required for `chart` and `face-over-chart` scenes — must be a valid path under `corpus/data/charts/*.yaml`.

Reel-level fields:

- `targetSeconds`: 15–60. Choose by content type:
  - 15–25s: hook / origin / confessional / bilingual punch
  - 25–35s: data reveal / single-stat unpack
  - 40–60s: framework explainer / Bug Series / MFR
- `faceFirstHook`: true. The first 3 seconds must be a face scene to win the stop-the-scroll.

Voiceover budget: ≤ 30 words per scene. Tight = readable. The viewer hears your words; they cannot rewind in a feed scroll.

Rule: ONE idea per Reel. If you can't tell it in 60 seconds, it's a Carousel, not a Reel.
```

- [ ] **Step 2: Re-sync agents**

```bash
pnpm sync:agents
git diff .claude/agents/creative-director.md  # verify the new section landed
```

- [ ] **Step 3: Update creative-director's worker output validation**

In `packages/orchestrator/src/stages/produce.ts` (or wherever P1-fanout's verifier folds creative output), call `ReelShotlistSchema.parse` on every unit where `format === "Reel"`. Reject the run if any Reel unit fails schema.

---

## Task 12: Webapp HG3 review surface — verify MP4 playback

**Files:**
- Verify (no edit needed): `apps/webapp/src/app/components/EntityListView.tsx` or the variant review page
- Add manual checklist: this task is a verification, not new code

- [ ] **Step 1: Locate variant review page**

Find the page that renders CreativeVariant.assetFiles for HG3 review.

- [ ] **Step 2: Confirm MP4 rendering**

If the page renders `<img>` only, extend to switch on `assetFiles[0].kind === "video"` and render `<video controls src={url} />`. (This may already work — verify before editing.)

- [ ] **Step 3: Manual test**

Drop a test MP4 URL into a sandbox CreativeVariant row, load the review page, confirm playback.

---

## Task 13: Sandbox smoke test — end-to-end with one Reel

**Files:**
- Add: `scripts/smoke-reel.mts` (one-off invocation against real HeyGen API)

This is the G2 gate before flipping the production env var.

- [ ] **Step 1: Write smoke script**

```ts
// scripts/smoke-reel.mts
import { reelWorkerInput } from "@engineerdad/orchestrator/produce/reel-worker-input.js";
// Stage a minimal CreativeUnit with 3 scenes (face, chart, face)
// Invoke the worker prompt path (or call the worker function directly)
// Log: reelHeygenJobId, mp4 local path, asset-store URL
```

- [ ] **Step 2: Run smoke against sandbox DB**

```bash
pnpm db:sandbox
HEYGEN_AVATAR_ID=<real> HEYGEN_VOICE_ID=<real> \
  pnpm tsx scripts/smoke-reel.mts
```

Capture the resulting MP4. Manually inspect.

- [ ] **Step 3: Sandbox /loop run**

Run a full `/loop` against the sandbox with one Reel-only Script. Verify:
- P2-render dispatches the Reel worker
- HG3 review page plays the MP4
- Approving the variant flows to schedule + distribute (dry-run mode)

---

## Task 14: TASKS.md and ARCHITECTURE.md cleanup

**Files:**
- Modify: `TASKS.md`
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Rescope E-004**

In `TASKS.md` row E-004:
- Drop kie.ai / Veo 3 / media-stitch (with kie.ai) language
- Replace with: "Reel video pipeline implemented via HeyGen + static-renderer + ffmpeg stitcher (see `docs/superpowers/specs/2026-05-28-heygen-reel-pipeline-design.html`). Closes when 5 production Reels ship through HG3 with ≥60% approve rate."
- Add follow-up sub-rows for YT-Long (16:9) and YT-Short variants (same worker, different aspect)

- [ ] **Step 2: Update ARCHITECTURE.md § Media Production**

Add a paragraph noting the Reel branch in P2-render, the `packages/media-stitch` package, and the HeyGen + static-renderer toolchain. Reference ADR-014 worker pattern.

---

## Task 15: PR sequencing checklist

This task is procedural — track which PRs are open / merged.

- [ ] **PR 1** — Schema + zod (Tasks 1 + 2) — low-risk foundation
- [ ] **PR 2** — `packages/media-stitch` library (Tasks 3 + 4 + 5 + 6) — pure, not yet imported
- [ ] **PR 3** — HeyGen wrapper + whisper + reel-render-worker prompt (Tasks 7 + 8 + 9) — infra, dormant
- [ ] **PR 4** — Orchestrator P2-render Reel branch + creative-director update (Tasks 10 + 11) — **activation**, ships with `EDOS_REEL_PIPELINE` default-off (opt-in via `=on`)
- [ ] **PR 6** — Default-off semantic + `.env.example` cleanup (correction PR; the PR 4 default landed inverted)
- [ ] **PR 5** — Smoke + docs (Tasks 12 + 13 + 14)

After PR 4 merges and PR 5's smoke gate passes, flip `EDOS_REEL_PIPELINE=on` in production env. Monitor first 5 Reels manually through HG3.

---

## Rollout gates (from spec §9)

- [ ] **G1 — Silent** — All 5 PRs merged, env `off`. No-op for production.
- [ ] **G2 — Sandbox smoke** — `/loop` on sandbox DB with 1 Reel-only Script. Inspect quality + HG3 surface.
- [ ] **G3 — Single-Reel prod** — Flip `EDOS_REEL_PIPELINE=on`. First production run produces 1 Reel. Manual HG3.
- [ ] **G4 — Steady state** — 5 production Reels with HG3 approve rate ≥ 60%. Close E-004.
- [ ] **G5 — YT extension** — After steady state holds 2 weeks, add 16:9 (YT-Long) and 9:16-Short.

---

## Out of scope (filed forward)

- BM-language Reels
- kie.ai / Veo 3 cinematic B-roll (dropped from E-004)
- HeyGen webhooks (still polling-based)
- Instagram automated publishing (stays via `/posting-pack` until E-024)
- Cross-run RenderEvents analytics dashboard
- Background music in V1 (defer to G3 review)
