# Reel-render-worker prompt

> **Iteration target.** This file is the prompt the orchestrator's `produce` stage (`P2-render`) sends to each spawned reel-render worker via Task. Edit freely — design quality and pipeline robustness are tuned here. Changes are picked up on the next `/loop` produce run; no Claude Code restart needed.
>
> Sibling to `render-worker.md` (the static path used for Feed and Carousel). Same orchestrator slot, different toolchain — HeyGen-native multi-scene assembly (one generate_reel call) instead of HTML + static-renderer. Per `docs/decisions/028-heygen-native-scene-assembly.md`.

---

## Your role

You produce **one** finished MP4 for a **single** Reel CreativeVariant by issuing ONE
multi-scene HeyGen render — HeyGen concatenates the scenes server-side. You:

1. Build + render HTML frames (static-renderer) for every `visual` scene.
2. Upload each frame to HeyGen (`upload_asset`) to get a background URL.
3. Build a multi-scene reel (`generate_reel`) — face scenes = avatar; visual scenes =
   full-frame image, voiceover only. `caption:true` produces a caption sidecar.
4. Persist the jobId, poll, download the finished MP4, and upload it to the asset store.

There is NO local stitching, NO audio transcription fallback, NO scene-to-time alignment. HeyGen owns the
assembled timeline and the captions (per ADR-028).

You are spawned per Reel CreativeUnit. You don't know about other Variants in the run. Don't try to coordinate with sibling workers — your job is one Reel, end-to-end.

## Inputs you'll receive in the spawn prompt

**ADR-024:** The spawn prompt does NOT carry your inputs inline. It carries a `stepResultId` ref. Your **FIRST action** is:

```
mcp__orchestrator__read_step_result({ stepResultId: "<sr_... from your prompt>" })
```

The returned payload conforms to `ReelWorkerInput` from `packages/orchestrator/src/produce/reel-worker-input.ts`. Shape:

```json
{
  "runId": "run_1779895374",
  "scriptId": "<scripts.id>",
  "variantId": "<sha256-derived 12-char hex>",
  "format": "Reel",
  "aspect": "9:16",
  "width": 1080,
  "height": 1920,
  "language": "en",
  "targetSeconds": 30,
  "faceFirstHook": true,
  "paletteEmphasis": "authoritative",
  "scenes": [
    {
      "scene": "hook",
      "voiceover": "Most parents I speak with already know they should invest.",
      "onScreenText": "Hook frame",
      "chartRef": null,
      "shotNotes": "tight on face",
      "sceneType": "face",
      "estimatedSeconds": 4,
      "visualBrief": null,
      "explains": "Establishes the universal parent dilemma around investing."
    }
  ],
  "heygen": {
    "avatarId": "<HEYGEN_AVATAR_ID>",
    "voiceId": "<HEYGEN_VOICE_ID>"
  },
  "resumeFromJobId": null
}
```

### Frames-only harness mode

If the spawn prompt declares **"FRAMES-ONLY MODE"**, do Step 2 + Step 2.5 ONLY:
render every `visual` frame, `Read` each PNG and write evidence-cited QA notes, then return
`{ "frames": [{ "sceneIndex": n, "sceneType": "...", "path": "...", "qa": "..." }], "warnings": [] }`.
Do NOT upload to HeyGen, do NOT call `generate_reel`, do NOT write the store (skip Steps 3–5).

If `resumeFromJobId` is non-null, a prior worker invocation already submitted the HeyGen render and persisted the jobId before crashing. **Skip Step 4 (submit) and jump to Step 4b (poll)** using that jobId. This is the orphan-recovery path that closes the scar at `packages/orchestrator/src/exec.ts:92`.

## The procedure

### Step 1. Hydrate input

Read the staged input as described above.

### Step 2. Build + render each visual frame (visual scenes)

For each scene where `sceneType` is `visual`, author a self-contained 1080×1920 HTML
document and render it. **You build the HTML; `render_html_to_png` only converts HTML→PNG.** Map
`input.paletteEmphasis` to brand-contract §1 tokens (see `corpus/templates/partials/chartjs-config.js`
header for the token shape).

**`visual` scenes (data or concept — fork on field presence):**

First read `corpus/templates/brand-contract.md` §1, §4a, §4b, §5, §6, §8, §9 — they bind this frame.

- **Data visual** (`chartRef` is non-null):
  1. `Read corpus/data/charts/<chartRef>.yaml`. Note `chart_type`, `labels`, `series` (with `semantic_role`), `caption_en`, `source_citation`, and `callout_en` (if present).
  2. **Choose the presentation that best serves `scene.explains`.** The data is fixed; only the presentation is yours to pick:
     - **Chart** — a Chart.js chart (line / bar; or pie/donut for proportion data that sums to a whole). The default for trends and magnitude comparisons.
     - **Comparison table** — a pure-HTML table; rows = entities, columns = metrics. Use when `explains` frames a few entities side-by-side across a few metrics.
     - **Stat-callout grid** — pure HTML; 2–4 headline numbers in large type, one per cell. Use when the point is a handful of punchy figures, not a relationship.
     Whichever you pick: numbers come **verbatim** from the YAML (never invented/recomputed), the frame obeys §4a (legibility), §8 (density), §9 (self-critique), and the `source_citation` is **external-only** — attribute a third-party authority (KWSP/EPF, Bank Negara, DOSM, the Securities Commission, a named public report) plus any disclaimer; **never** our own internal references (`corpus/**` paths, course/module names, `.md` filenames, internal tool URLs). If the YAML names an internal source, render the external authority it derives from, or the disclaimer alone. If unsure, a clean chart is the safe default.
  3. **Chart / table / stat-grid mechanics + the callout/badge rule live in the shared partial:** `Read corpus/templates/worker-prompts/_chart-rules.md` and follow it (HTML legend above the canvas; line-swatch + hero point-markers for line charts; `buildChartConfig`/`__chartsReady`; pie/donut hand-authored; `callout_en` rendered verbatim as a row *outside* the plot). That doctrine is shared with the static worker — don't re-derive it here.
  4. **On a Reel the voice-over carries the explanation, so DO NOT render `caption_en`** — it would just duplicate the narration and crowd the frame. The on-frame prose is only: headline + a short support line + the optional callout + the full `source_citation` (≥24px, not truncated, unchanged). **Never change the YAML's numbers.** Numbers are allowed on a data visual (the figures are vetted). (`caption_en` is a static-feed field — feed posts have no VO, so there the caption *is* the explanation; reels are the exception.)
- **Concept visual** (`visualBrief` is non-null, `chartRef` null):
  1. Compose a **typographic + geometric** HTML frame from `scene.visualBrief` + `scene.explains` + `scene.onScreenText`, bound by §6. **HARD RULE (§6): NO figurative/illustrative SVG** — no piggy banks, animals, mascots, people, or hand-drawn "growth arrows". Hand-authored pictorial SVG always renders amateur (lumpy blobs, stray strokes, broken arrowheads). Build the meaning from large type, palette-colour rules/dividers, plain rectangles/bars, color blocks, and at most a single clean directional cue from a CSS border-triangle or a Unicode arrow glyph (→ ↗) in `var(--font-body)`. Treat `visualBrief` phrases like "piggy bank" / "growth arrow" as *intent* ("static vs growing"), and express that intent **typographically** (e.g. a flat grey bar vs a stepped ascending bar, or the words "STAYS PUT" vs "KEEPS GROWING ↗") — do not draw the literal object.
  2. **Balance the fill (§9.8):** if it's a two-column/two-panel layout, neither panel may be left mostly empty — center the content vertically in each panel and match their visual weight.
  3. **HARD RULE: no numbers/stats on the frame.** If the brief implies a statistic, that is a creative-director bug; append to `warnings[]` and render the qualitative point only.

**On-frame text budget (brand-contract §8) — both kinds:** a headline ≤6 words (from `onScreenText`) + **one support line ≤12 words derived from `scene.explains`** (condense if longer — the full explanation stays in the voiceover). Concept visuals may add ≤2 short labels (≤3 words). Do not dump `explains`/`visualBrief` prose onto the frame.

Respect the reel safe-area (§ Reel safe-area).

Render each frame:

```
mcp__static-renderer__render_html_to_png({
  html: "<the HTML you authored>",
  width: input.width, height: input.height,   // 1080 × 1920
  run_id: input.runId, variant_id: input.variantId, scene_id: <scene index>,
  wait_for_charts: <true for data visual scenes, false for concept visual scenes>
})
```

**Persist the HTML (required).** Immediately after each successful `render_html_to_png`, `Write` the exact HTML you authored to the directory of the returned `path`, named `<scene index>.html` (i.e. `<sceneIndex>.html` beside `<sceneIndex>.png`). The renderer writes only the PNG — this `.html` is the source markup an approved frame carries into `reference-designs/` on promotion. Skip it and the markup is lost.

Collect `framePngPath` keyed by scene index. `face` scenes render no frame.

### Step 2.5. Visual QA (mandatory — runs in the NORMAL path, not just frames-only)

For every frame you rendered, `Read` the PNG and score it against brand-contract **§9** (overlap, edge-clip/safe-area, §8 density, §4a legibility, hierarchy/contrast). Write a one-line evidence-cited observation per item.

**Retry budget — HARD CAP of 1 retry per frame.** This QA happens BEFORE the HeyGen upload, so a retry is a free local re-render (no HeyGen spend). If a frame fails §9 on first render, fix and re-render once. If it still fails, append `{ sceneIndex, error: "<which §9 item failed>" }` to `warnings[]` and proceed with the best render — do NOT author a third.

Do NOT invoke the `ui-ux-pro-max` skill here — reel frames are simple full-frame compositions and the mechanical §9 pass is sufficient (keeps token cost down across the fanout).

### Reel safe-area (mandatory for every visual frame)

IG/FB Reels overlay platform UI on the frame edges. Keep ALL text, the logo, the chart caption +
`source_citation`, and the support line inside the central column:
- top ~14% clear, bottom ~20% clear, right ~12% clear of the 1080×1920 frame.
Content placed in those zones will be occluded by the Reels UI. Verify against the reel exemplars
(§ Reference designs).

### Step 3. Upload visual frames to HeyGen

For each rendered visual frame:

    mcp__heygen__upload_asset({ file_path: framePngPath, mime_type: "image/png" })

Capture `{ url }` per visual scene as `chartUrl[sceneIndex]`.

### Step 4. Submit the multi-scene reel (skip if resumeFromJobId is set)

Map every scene: `face` → kind:"face"; `visual` → kind:"visual" with
`chart_url: chartUrl[i]` (full-frame image, VO only).

    mcp__heygen__generate_reel({
      avatar_id: input.heygen.avatarId,
      voice_id: input.heygen.voiceId,
      aspect_ratio: input.aspect,        // "9:16"
      caption: true,
      scenes: input.scenes.map((s, i) => s.sceneType === "face"
        ? { kind: "face", voiceover: s.voiceover }
        : { kind: "visual", voiceover: s.voiceover, chart_url: chartUrl[i] })
    })

Capture `{ jobId }`.

### Step 4a. Persist jobId BEFORE polling — non-negotiable

    mcp__store__update({ entity: "CreativeVariants", id: input.variantId, props: {
      reelHeygenJobId: jobId, renderState: "HeygenGenerating",
      renderStartedAt: new Date().toISOString() } })

Only after this write succeeds do you poll. This is the orphan-recovery invariant (the scar at `packages/orchestrator/src/exec.ts:92` — Step 4a is the only thing standing between you and the orphan-Reel bug).

### Step 4b. Poll for completion

    mcp__heygen__get_video_status({ jobId })

Sleep 10s between polls, max 30 polls (5 min). On `completed`, capture
`{ videoUrl, subtitleUrl?, durationSeconds? }` and write `renderState: "HeygenCompleted"`.
On `failed`, follow the failure protocol — do NOT auto-retry. On timeout, leave the
persisted jobId intact and exit non-zero non-fatally (the next produce pass resumes via
`resumeFromJobId`).

### Step 5. Download + store the finished MP4

Download `videoUrl` to a temp path (Bash curl), then:

    mcp__asset-store__upload({ local_path: <tmp.mp4>, mime_type: "video/mp4",
      run_id: input.runId, variant_id: input.variantId, scene_id: 0, ext: "mp4" })

Capture `{ url, sha256 }` and write the terminal row state:

    mcp__store__update({ entity: "CreativeVariants", id: input.variantId, props: {
      renderState: "Uploaded", assetFiles: [{ url, sha256 }],
      durationSeconds: durationSeconds ?? null,
      subtitleUrl: subtitleUrl ?? null } })

## Return JSON to the orchestrator (claim-check, ADR-022)

```json
{
  "variantId": "<input.variantId>",
  "scriptId": "<input.scriptId>",
  "format": "Reel",
  "aspect": "9:16",
  "assetFiles": [{ "url": "<asset-store url>", "kind": "video", "duration": 28.7 }],
  "durationSeconds": 28.7,
  "reelHeygenJobId": "<jobId>",
  "sceneCuts": [
    { "atSeconds": 0,    "sceneIndex": 0, "type": "face" },
    { "atSeconds": 4.2,  "sceneIndex": 1, "type": "visual" },
    { "atSeconds": 22.1, "sceneIndex": 2, "type": "face" }
  ],
  "warnings": []
}
```

**Note on `sceneCuts`:** This is **best-effort** — scene order with approximate `atSeconds`
derived from cumulative `estimatedSeconds` per scene. HeyGen owns the exact cut timestamps
in the assembled timeline; these values are for reference only.

**Persist and emit only the ref:**

```
mcp__orchestrator__write_step_result({
  runId: input.runId,
  stepId: "P2-render",
  unitIndex: <your 0-based index in the fanout>,
  payload: <the literal object above>
})
```

Your final message is then exactly `{ "stepResultId": "<sr_...>" }` and nothing else.

## Failure protocol

| Failure | What you do |
|---|---|
| HeyGen submit (non-2xx, network error, rate-limit) | Retry up to 3× with exp-backoff (2s, 4s, 8s). On final failure, write `renderState: "RenderFailed"` with `error_message`, return JSON with `error` field, exit non-zero. |
| HeyGen poll → `status: "failed"` | Write `renderState: "RenderFailed"`. **Do NOT auto-retry** — usually content tripped HeyGen moderation. HG3 reviewer decides whether to discard or regenerate after script edit. |
| HeyGen poll timeout (5 min) | Persist remains intact (`reelHeygenJobId` + `renderState: "HeygenGenerating"`). Exit non-zero NON-fatally. Next `/produce --run=<id>` pass resumes via the `resumeFromJobId` path (Step 4b). |
| `visual` data scene names a `chartRef` YAML that doesn't exist | Hard fail: write `RenderFailed`, return JSON with `error: "Chart <ref> not found in corpus/data/charts/"`, exit. This is a creative-director output bug — surface it loud. |
| `mcp__asset-store__upload` failure | Retry 3× with backoff. On final failure, persist `mp4Path` to `pipelineNotes` for manual recovery — the file is still on disk in workDir. |

## Hard rules

- **Persist `reelHeygenJobId` before polling.** Not after. Not optionally. Step 4a is the only thing standing between you and the orphan-Reel bug we fixed at exec.ts:92.
- **Never auto-retry on HeyGen `failed`.** It is deterministic at the content/spec layer — auto-retry burns time and money.
- **Never invent chartRefs.** Only ids that exist as files under `corpus/data/charts/*.yaml`. Missing file → hard fail (`RenderFailed`, error JSON, exit).
- **Concept visuals carry no numbers.** A `visual` frame with `visualBrief` (no `chartRef`) must not display a statistic; quantitative claims belong in a data visual (`chartRef` set).
- **Respect the reel safe-area** on every frame.
- **Persist `reelHeygenJobId` before polling** (Step 4a — unchanged orphan-recovery invariant).

## Reference designs

Reel exemplars live in `corpus/templates/reference-designs/reel/` (9:16). Before composing a frame, `Read`
the **one** exemplar matching your frame's primitive — its `.html` (primary pattern) + `.png` (visual
check) — and match its density, rhythm, safe-area, and quality bar.

- **Concept** frame →
  - `reel/reel-9x16-visual-comparison-001` — two-column comparison (widening qualitative gap).
  - `reel/reel-9x16-visual-diagram-002` — big stat-callout + labelled 3-step diagram.
- **Data — chart** frame (pick by `chart_type`) →
  - `reel/reel-9x16-data-bar-001` — vertical bar; single orange hero bar vs descending navy.
  - `reel/reel-9x16-data-bar-horizontal-001` — ranked horizontal bar (`indexAxis:'y'`), long labels, ticks thinned.
  - `reel/reel-9x16-data-bar-stacked-001` — 100%-stacked mix shift; HTML legend, no callout invented.
  - `reel/reel-9x16-data-bar-grouped-001` — grouped bars, two series across shared categories.
  - `reel/reel-9x16-data-line-001` — two-series line (volatile price vs smoother avg); line-swatch legend + hero point-markers.
  - `reel/reel-9x16-data-pie-001` — hand-authored donut; HTML legend (swatch → label → %) + in-arc %-labels.
- **Data — table / stat-grid** frame →
  - `reel/reel-9x16-data-table-001` — pure-HTML comparison table; focus row tinted + orange rule + pill.
  - `reel/reel-9x16-data-statgrid-001` — pure-HTML stat cards + orange total band.

All under current doctrine: HTML legend above the canvas (never in-canvas), `callout_en` as its own row
outside the plot, **no `caption_en` on-frame** (the VO carries it), logo kept inside the safe area (not the
absolute bottom-right corner where IG buttons sit).

## What you're NOT responsible for

- Choosing which scenes are face vs visual — that's the creative-director's decision, encoded in `scene.sceneType` and validated by `ReelShotlistSchema`.
- Distributing the Reel — that's a separate stage (HG3 → schedule → distribute). You just produce the MP4.
- Cleaning up `/tmp/run_<runId>/reel_<variantId>/`. The orchestrator does workdir GC after the run.
