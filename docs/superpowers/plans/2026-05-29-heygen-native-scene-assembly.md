# HeyGen-Native Scene Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the local ffmpeg stitch pipeline with HeyGen-native multi-scene assembly — one `video_inputs` POST returns the finished, captioned, correctly-framed reel — and delete `@engineerdad/media-stitch`.

**Architecture:** Per ADR-028. The reel-render worker renders chart PNGs (static-renderer, unchanged), uploads them to HeyGen (`upload_asset`), builds a multi-scene `video_inputs` payload (face = avatar `fit:"cover"` over a colour bg; chart = no character + the chart as `background:image`), sets `caption:true`, submits one render, polls, downloads the MP4, and re-uploads it to the asset store. No timing alignment, no whisper, no stitch.

**Tech Stack:** TypeScript, Zod, MCP (`@modelcontextprotocol/sdk`), Vitest, pnpm workspaces. HeyGen v2 `/video/generate` + `upload.heygen.com/v1/asset`.

---

## File Structure

- `mcp-servers/heygen-wrapper/src/heygen.ts` — add `uploadAsset()` + `generateReel()`; keep `generateVideo()`/`getVideoStatus()` unchanged.
- `mcp-servers/heygen-wrapper/src/index.ts` — register `upload_asset` + `generate_reel` MCP tools.
- `mcp-servers/heygen-wrapper/src/__tests__/heygen.test.ts` — tests for the two new functions.
- `packages/store/src/schema.ts`, `packages/shared/src/types.ts`, `packages/shared/src/zod.ts` — drop the `Stitching` render state.
- `corpus/templates/worker-prompts/reel-render-worker.md` — rewrite to the ~5-step native procedure.
- `packages/media-stitch/**` — **deleted**.
- `docs/decisions/028-heygen-native-scene-assembly.md` — already written (the doctrine).
- `TASKS.md`, plan/spec headers, memory — sync.

---

### Task 1: heygen-wrapper — `uploadAsset()`

**Files:**
- Modify: `mcp-servers/heygen-wrapper/src/heygen.ts`
- Test: `mcp-servers/heygen-wrapper/src/__tests__/heygen.test.ts`

- [ ] **Step 1: Write the failing test** — append a new `describe` block:

```ts
import { readFileSync } from "node:fs";

describe("uploadAsset", () => {
  beforeEach(() => { vi.restoreAllMocks(); process.env.HEYGEN_API_KEY = "KEY"; });

  it("POSTs raw bytes to upload.heygen.com/v1/asset and returns {assetId,url}", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "asset_1", url: "https://resource2.heygen.ai/image/asset_1/original.png" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic
    const res = await uploadAsset({ bytes: buf, mimeType: "image/png" });
    expect(res).toEqual({ assetId: "asset_1", url: "https://resource2.heygen.ai/image/asset_1/original.png" });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://upload.heygen.com/v1/asset");
    expect(opts.method).toBe("POST");
    expect((opts.headers as any)["Content-Type"]).toBe("image/png");
    expect((opts.headers as any)["X-Api-Key"]).toBe("KEY");
    expect(opts.body).toBe(buf);
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 413, json: async () => ({ message: "too big" }) }));
    await expect(uploadAsset({ bytes: Buffer.from([0]), mimeType: "image/png" }))
      .rejects.toThrow(/too big|413/);
  });
});
```

Add `uploadAsset` to the import on line 2: `import { generateVideo, getVideoStatus, uploadAsset } from "../heygen.js";`

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run mcp-servers/heygen-wrapper/src/__tests__/heygen.test.ts -t "uploadAsset"`
Expected: FAIL — `uploadAsset is not a function`.

- [ ] **Step 3: Implement `uploadAsset`** — add to `heygen.ts` after `generateVideo`:

```ts
/**
 * Upload a media file to the HeyGen account. Returns the asset id + a
 * resource URL usable directly as a per-scene background.url. Raw binary
 * body, mime in the Content-Type header (HeyGen's documented contract).
 */
export async function uploadAsset(args: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<{ assetId: string; url: string }> {
  const key = requireKey();
  const res = await fetch("https://upload.heygen.com/v1/asset", {
    method: "POST",
    headers: { "X-Api-Key": key, "Content-Type": args.mimeType },
    body: args.bytes,
  });
  const json = (await res.json()) as any;
  if (!res.ok || json.error) {
    throw new Error(`HeyGen upload error (${res.status}): ${json.message ?? json.error?.message ?? "unknown"}`);
  }
  return { assetId: json.data.id, url: json.data.url };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run mcp-servers/heygen-wrapper/src/__tests__/heygen.test.ts -t "uploadAsset"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp-servers/heygen-wrapper/src/heygen.ts mcp-servers/heygen-wrapper/src/__tests__/heygen.test.ts
git commit -m "feat(heygen): add uploadAsset for chart backgrounds (ADR-028)"
```

---

### Task 2: heygen-wrapper — `generateReel()` (multi-scene + caption)

**Files:**
- Modify: `mcp-servers/heygen-wrapper/src/heygen.ts`
- Test: `mcp-servers/heygen-wrapper/src/__tests__/heygen.test.ts`

- [ ] **Step 1: Write the failing test** — append:

```ts
describe("generateReel", () => {
  beforeEach(() => { vi.restoreAllMocks(); process.env.HEYGEN_API_KEY = "KEY"; });

  it("builds a multi-scene video_inputs payload with caption + per-scene shapes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { video_id: "job_r" } }) });
    vi.stubGlobal("fetch", fetchMock);
    const res = await generateReel({
      avatar_id: "av1", voice_id: "vo1", aspect_ratio: "9:16",
      scenes: [
        { kind: "face",  voiceover: "Hook line." },
        { kind: "chart", voiceover: "Chart line.", chart_url: "https://x/chart.png" },
      ],
    });
    expect(res).toEqual({ jobId: "job_r" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.caption).toBe(true);
    expect(body.dimension).toEqual({ width: 720, height: 1280 });
    expect(body.video_inputs).toHaveLength(2);
    // face: avatar fit:cover over colour bg
    const face = body.video_inputs[0];
    expect(face.character).toMatchObject({ type: "avatar", avatar_id: "av1", fit: "cover" });
    expect(face.voice).toMatchObject({ type: "text", voice_id: "vo1", input_text: "Hook line." });
    expect(face.background).toEqual({ type: "color", value: "#0a1628" });
    // chart: NO character, image background
    const chart = body.video_inputs[1];
    expect(chart.character).toBeUndefined();
    expect(chart.voice.input_text).toBe("Chart line.");
    expect(chart.background).toEqual({ type: "image", url: "https://x/chart.png", fit: "cover" });
  });

  it("treats face-over-chart as a chart scene (no character)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { video_id: "j" } }) });
    vi.stubGlobal("fetch", fetchMock);
    await generateReel({
      avatar_id: "a", voice_id: "v", aspect_ratio: "9:16",
      scenes: [{ kind: "face-over-chart", voiceover: "x", chart_url: "https://x/c.png" }],
    });
    const s = JSON.parse(fetchMock.mock.calls[0][1].body).video_inputs[0];
    expect(s.character).toBeUndefined();
    expect(s.background.type).toBe("image");
  });

  it("throws if a chart scene is missing chart_url", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(generateReel({
      avatar_id: "a", voice_id: "v", aspect_ratio: "9:16",
      scenes: [{ kind: "chart", voiceover: "x" }],
    })).rejects.toThrow(/chart_url/);
  });
});
```

Update the import: `import { generateVideo, getVideoStatus, uploadAsset, generateReel } from "../heygen.js";`

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run mcp-servers/heygen-wrapper/src/__tests__/heygen.test.ts -t "generateReel"`
Expected: FAIL — `generateReel is not a function`.

- [ ] **Step 3: Implement `generateReel`** — add to `heygen.ts` (reuses the existing `DIMENSIONS` + `FIT` maps):

```ts
export interface ReelSceneInput {
  kind: "face" | "chart" | "face-over-chart";
  voiceover: string;
  /** Required for chart / face-over-chart scenes: the uploaded chart background URL. */
  chart_url?: string;
}

export async function generateReel(args: {
  avatar_id: string;
  voice_id: string;
  aspect_ratio: "9:16" | "16:9" | "1:1";
  scenes: ReelSceneInput[];
  /** Default true — HeyGen produces a caption_url SRT sidecar (IG/FB auto-caption on playback). */
  caption?: boolean;
  background_color?: string;
}): Promise<{ jobId: string }> {
  const key = requireKey();
  const dim = DIMENSIONS[args.aspect_ratio];
  if (!dim) throw new Error(`unsupported aspect_ratio: ${args.aspect_ratio}`);
  const bg = args.background_color ?? "#0a1628";

  const video_inputs = args.scenes.map((s) => {
    const voice = { type: "text", input_text: s.voiceover, voice_id: args.voice_id };
    if (s.kind === "face") {
      return {
        character: { type: "avatar", avatar_id: args.avatar_id, avatar_style: "normal", fit: FIT[args.aspect_ratio]! },
        voice,
        background: { type: "color", value: bg },
      };
    }
    // chart + face-over-chart: full-frame chart, no character (VO over image)
    if (!s.chart_url) throw new Error(`scene kind '${s.kind}' requires chart_url`);
    return { voice, background: { type: "image", url: s.chart_url, fit: "cover" } };
  });

  const res = await fetch(`${API}/v2/video/generate`, {
    method: "POST",
    headers: { "X-Api-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ caption: args.caption ?? true, dimension: dim, video_inputs }),
  });
  const json = (await res.json()) as any;
  if (!res.ok || json.error) {
    throw new Error(`HeyGen error (${res.status}): ${json.error?.message ?? "unknown"}`);
  }
  return { jobId: json.data.video_id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run mcp-servers/heygen-wrapper/src/__tests__/heygen.test.ts`
Expected: PASS (all heygen-wrapper tests — existing + new).

- [ ] **Step 5: Commit**

```bash
git add mcp-servers/heygen-wrapper/src/heygen.ts mcp-servers/heygen-wrapper/src/__tests__/heygen.test.ts
git commit -m "feat(heygen): generateReel multi-scene assembly + caption (ADR-028)"
```

---

### Task 3: Register the two new MCP tools

**Files:**
- Modify: `mcp-servers/heygen-wrapper/src/index.ts`

- [ ] **Step 1: Add the tool registrations** — after the existing `generate_video` `server.tool(...)` block, and update the import on line 4:

```ts
import { generateVideo, getVideoStatus, uploadAsset, generateReel } from "./heygen.js";
import { readFile } from "node:fs/promises";
```

```ts
server.tool(
  "upload_asset",
  "Upload a local media file to HeyGen. Returns { assetId, url }. The url is usable directly as a per-scene background.url in generate_reel (used for chart frames).",
  { file_path: z.string(), mime_type: z.string() },
  async (args) => {
    try {
      const bytes = await readFile(args.file_path);
      return toResult(await uploadAsset({ bytes, mimeType: args.mime_type }));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "generate_reel",
  "Submit a multi-scene HeyGen reel render in one call. video_inputs is built per scene: kind:'face' = avatar fit:'cover' over a colour bg; kind:'chart'/'face-over-chart' = full-frame chart image background (chart_url required), no avatar. caption defaults true (SRT sidecar). Returns { jobId } for polling via get_video_status.",
  {
    avatar_id: z.string(),
    voice_id: z.string(),
    aspect_ratio: z.enum(["9:16", "16:9", "1:1"]),
    scenes: z.array(z.object({
      kind: z.enum(["face", "chart", "face-over-chart"]),
      voiceover: z.string(),
      chart_url: z.string().optional(),
    })).min(1),
    caption: z.boolean().optional(),
    background_color: z.string().optional(),
  },
  async (args) => {
    try {
      return toResult(await generateReel(args));
    } catch (err) {
      return errorResult(err);
    }
  },
);
```

> Note: the existing helper is named `toResult` in some files and `toolResult` in index.ts. Use whichever the file already defines (index.ts defines `toolResult`) — match it; do not introduce a second helper.

- [ ] **Step 2: Build the wrapper**

Run: `pnpm -r --filter='@engineerdad/heygen' build` (or the wrapper's package name from its package.json)
Expected: clean tsc build, no type errors.

- [ ] **Step 3: Commit**

```bash
git add mcp-servers/heygen-wrapper/src/index.ts
git commit -m "feat(heygen): expose upload_asset + generate_reel MCP tools (ADR-028)"
```

> **RESTART REQUIRED:** after this builds, Claude Code must be restarted so the MCP registry picks up the new tools ([[feedback_mcp_restart_after_rebuild]]). The worker rewrite (Task 5) cannot be exercised until then.

---

### Task 4: Drop the `Stitching` render state

**Files:**
- Modify: `packages/store/src/schema.ts:67-72`
- Modify: `packages/shared/src/types.ts:130-134`
- Modify: `packages/shared/src/zod.ts:134-138`
- Test: `packages/store/src/crud.test.ts` (only if it references `"Stitching"`)

- [ ] **Step 1: Remove `"Stitching"` from `RENDER_STATE`** in `packages/store/src/schema.ts`:

```ts
export const RENDER_STATE = [
  "HeygenGenerating",
  "HeygenCompleted",
  "Uploaded",
  "RenderFailed",
] as const;
```

- [ ] **Step 2: Remove it from the shared type** in `packages/shared/src/types.ts`:

```ts
export type RenderState =
  | "HeygenGenerating"
  | "HeygenCompleted"
  | "Uploaded"
  | "RenderFailed";
```

- [ ] **Step 3: Remove it from the Zod enum** in `packages/shared/src/zod.ts`:

```ts
export const RenderStateSchema = z.enum([
  "HeygenGenerating",
  "HeygenCompleted",
  "Uploaded",
  "RenderFailed",
]);
```

- [ ] **Step 4: Find any remaining references**

Run: `grep -rn '"Stitching"\|Stitching' packages --include=*.ts | grep -vE "node_modules|/dist/"`
Expected: no results. If `crud.test.ts` references it, update that test to use `"HeygenCompleted"` instead.

- [ ] **Step 5: Build + test the two packages**

Run: `pnpm -r --filter='@engineerdad/shared' --filter='@engineerdad/store' build && pnpm vitest run packages/store packages/shared`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/store/src/schema.ts packages/shared/src/types.ts packages/shared/src/zod.ts packages/store/src/crud.test.ts
git commit -m "refactor(store): drop obsolete Stitching render state (ADR-028)"
```

---

### Task 5: Rewrite the reel-render-worker prompt

**Files:**
- Modify (full rewrite of the procedure): `corpus/templates/worker-prompts/reel-render-worker.md`

- [ ] **Step 1: Replace "Your role" + "The 8-step procedure" through "Step 8"** with the native procedure below. Keep the header note, the ADR-024 input-hydration section, the `resumeFromJobId` paragraph, the "Return JSON" / "Failure protocol" / "Hard rules" / "What you're NOT responsible for" sections — but edit them per the deltas in Step 2.

New "Your role":

```markdown
## Your role

You produce **one** finished MP4 for a **single** Reel CreativeVariant by issuing ONE
multi-scene HeyGen render — HeyGen concatenates the scenes server-side. You:

1. Render chart frames (static-renderer) for any scene with a `chartRef`.
2. Upload each chart frame to HeyGen (`upload_asset`) to get a background URL.
3. Build a multi-scene reel (`generate_reel`) — face scenes = avatar; chart scenes =
   full-frame chart image, voiceover only. `caption:true` produces a caption sidecar.
4. Persist the jobId, poll, download the finished MP4, and upload it to the asset store.

There is NO local stitching, NO whisper, NO scene-to-time alignment. HeyGen owns the
assembled timeline and the captions.
```

New procedure:

```markdown
### Step 2. Render chart frames

For each scene where `chartRef !== null` (sceneType `chart` or `face-over-chart`):

  mcp__static-renderer__render_html_to_png({
    chartRef: scene.chartRef, language: input.language,
    width: input.width, height: input.height
  })

Collect `framePngPath` keyed by scene index.

### Step 3. Upload chart frames to HeyGen

For each rendered chart frame:

  mcp__heygen__upload_asset({ file_path: framePngPath, mime_type: "image/png" })

Capture `{ url }` per chart scene as `chartUrl`.

### Step 4. Submit the multi-scene reel (skip if resumeFromJobId is set)

Map every scene to a generate_reel scene. `face` → kind:"face". `chart` and
`face-over-chart` → kind:"chart" with `chart_url: chartUrl` (we render full-frame charts;
we do NOT dock a talking head — see ADR-028).

  mcp__heygen__generate_reel({
    avatar_id: input.heygen.avatarId,
    voice_id: input.heygen.voiceId,
    aspect_ratio: input.aspect,        // "9:16"
    caption: true,
    scenes: input.scenes.map(s => s.sceneType === "face"
      ? { kind: "face", voiceover: s.voiceover }
      : { kind: "chart", voiceover: s.voiceover, chart_url: chartUrlByIndex[i] })
  })

Capture `{ jobId }`.

### Step 4a. Persist jobId BEFORE polling — non-negotiable

  mcp__store__update({ entity: "CreativeVariants", id: input.variantId, props: {
    reelHeygenJobId: jobId, renderState: "HeygenGenerating",
    renderStartedAt: new Date().toISOString() } })

Only after this write succeeds do you poll. This is the orphan-recovery invariant.

### Step 4b. Poll for completion

  mcp__heygen__get_video_status({ jobId })

Sleep 10s between polls, max 30 polls (5 min). On `completed`, capture
`{ videoUrl, subtitleUrl?, durationSeconds? }` and write `renderState: "HeygenCompleted"`.
On `failed`, follow the failure protocol — do NOT auto-retry. On timeout, leave the
persisted jobId intact and exit non-zero non-fatally (the next produce pass resumes via
`resumeFromJobId`).

### Step 5. Download + store the finished MP4

Download `videoUrl` to a temp path, then:

  mcp__asset-store__upload({ local_path: <tmp.mp4>, mime_type: "video/mp4",
    run_id: input.runId, variant_id: input.variantId, scene_id: 0, ext: "mp4" })

Capture `{ url, sha256 }` and write the terminal row state:

  mcp__store__update({ entity: "CreativeVariants", id: input.variantId, props: {
    renderState: "Uploaded", assetFiles: [{ url, sha256 }],
    durationSeconds: durationSeconds ?? null,
    subtitleUrl: subtitleUrl ?? null } })
```

- [ ] **Step 2: Edit the surrounding sections** for the deltas:
  - `resumeFromJobId` paragraph: "Skip Step 3 (submit)" → "Skip Step 4 (submit) and jump to Step 4b (poll)".
  - "Return JSON" block: keep `sceneCuts` but document it as **best-effort** (scene order with approximate `atSeconds` from cumulative `estimatedSeconds`; HeyGen owns exact cuts). Remove `media-stitch`-specific language.
  - "Failure protocol" table: delete the `media-stitch ffmpeg failure` row; keep HeyGen submit/poll/timeout + static-renderer + asset-store rows.
  - "Hard rules": delete "Never re-synthesize audio" (no longer relevant — single render owns audio); keep the orphan-recovery and chartRef rules.
  - Top note line 5: "HeyGen + media-stitch instead of HTML" → "HeyGen multi-scene assembly instead of HTML + static-renderer".
  - Delete Step 4 "Acquire word-level timings" and Step 5 "Map scenes to time ranges" and Step 7 "Build StitchSpec and stitch" entirely (replaced above).

- [ ] **Step 3: Verify no stale references remain**

Run: `grep -n 'media-stitch\|whisper\|alignScenesToTimings\|StitchSpec\|WHISPER' corpus/templates/worker-prompts/reel-render-worker.md`
Expected: no results.

- [ ] **Step 4: Commit**

```bash
git add corpus/templates/worker-prompts/reel-render-worker.md
git commit -m "refactor(reel-worker): native multi-scene procedure, drop stitch (ADR-028)"
```

---

### Task 6: Delete `@engineerdad/media-stitch`

**Files:**
- Delete: `packages/media-stitch/` (whole directory)

- [ ] **Step 1: Confirm zero remaining importers**

Run: `grep -rn '@engineerdad/media-stitch\|media-stitch' packages mcp-servers apps --include=*.ts --include=package.json | grep -vE "node_modules|/dist/|packages/media-stitch/"`
Expected: no results. (If any appear, stop and resolve before deleting.)

- [ ] **Step 2: Delete the package and reinstall**

```bash
git rm -r packages/media-stitch
pnpm install
```

Expected: lockfile updates, workspace resolves (the `packages/*` glob drops it automatically).

- [ ] **Step 3: Sequential build to confirm nothing broke**

Run: `pnpm -r build`
Expected: clean (no module-not-found for media-stitch).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete media-stitch package, superseded by HeyGen-native assembly (ADR-028)"
```

---

### Task 7: Sync docs, TASKS, memory

**Files:**
- Modify: `TASKS.md`
- Modify: `docs/superpowers/plans/2026-05-28-heygen-reel-pipeline.md` + `.html` (stale-banner only)
- Modify: `docs/superpowers/specs/2026-05-28-heygen-reel-pipeline-design.html` (stale-banner only)
- Modify: memory `project_heygen_vertical_framing.md` + `MEMORY.md`
- Modify: `ARCHITECTURE.md` (MCP server list + reel pipeline blurb)

- [ ] **Step 1: TASKS.md** — mark **B-032** (filtergraph SAR fix) as *Won't fix / moot — media-stitch deleted (ADR-028)*; keep **B-033** (fit:cover) as fixed (still applies to face scenes); add **B-034: HeyGen-native multi-scene reel assembly (ADR-028)** with the shipped status; refresh the Status header.

- [ ] **Step 2: Stale banners** — at the top of each `2026-05-28-heygen-reel-pipeline*` plan/spec, add:
  `> **SUPERSEDED (2026-05-29) by ADR-028 + docs/superpowers/plans/2026-05-29-heygen-native-scene-assembly.md.** The stitch architecture below is historical; the reel pipeline now uses HeyGen-native multi-scene assembly.`

- [ ] **Step 3: ARCHITECTURE.md** — in the MCP/pipeline sections, replace any "media-stitch" mention with the HeyGen-native assembly note; reflect that the reel path no longer stitches locally.

- [ ] **Step 4: Memory** — extend `project_heygen_vertical_framing.md` with: multi-scene `video_inputs` concatenates server-side; `caption:true` = SRT sidecar (not burned in; rely on IG/FB auto-caption); a character-less scene = full-frame `background:image` + VO (verified job `a9e8bce6…`); offset/scale docking pushed the avatar off-canvas (don't rely on it). Add a `MEMORY.md` pointer if the hook changes.

- [ ] **Step 5: Commit**

```bash
git add TASKS.md ARCHITECTURE.md docs/superpowers/ "$HOME/.claude/projects/-Users-solid-Code-engineerdad-marketing/memory/"
git commit -m "docs: sync TASKS/ARCHITECTURE/plan banners + memory for ADR-028"
```

---

## End-to-end verification (after the RESTART in Task 3)

- [ ] Re-run the reel for `run_1779895374` through the rewritten worker (resume or fresh) and confirm: one HeyGen render, `caption:true`, face scenes fill 9:16, chart scenes are full-frame, the MP4 lands in the asset store, and the CreativeVariants row reaches `renderState: "Uploaded"` with no `Stitching` transition.
- [ ] Open the resulting MP4 for the user to eyeball.

---

## Self-Review

- **Spec coverage:** wrapper multi-scene + caption + upload (Tasks 1–3); render-state cleanup (Task 4); worker rewrite (Task 5); media-stitch deletion (Task 6); doctrine/docs/memory (ADR-028 + Task 7). All gaps from the gap analysis are covered.
- **Type consistency:** `generateReel`/`uploadAsset` names + `ReelSceneInput.kind` ("face"|"chart"|"face-over-chart") + `chart_url` are used identically across heygen.ts, index.ts, and the worker prompt. `renderState` values match the trimmed enum.
- **Open risk:** the wrapper package name for the `--filter` build (Task 3 Step 2) must be read from `mcp-servers/heygen-wrapper/package.json` at execution time.
