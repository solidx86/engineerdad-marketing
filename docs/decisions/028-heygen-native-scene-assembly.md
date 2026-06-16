# ADR-028: HeyGen-native multi-scene assembly supersedes media-stitch

**Status:** Accepted (2026-05-29)
**Supersedes:** the stitch-based reel architecture in `docs/superpowers/specs/2026-05-28-heygen-reel-pipeline-design.html` (PR 1–6, B-028 rescope).
**Related:** ADR-022 (claim-check worker output), ADR-024 (staged input), B-033 (avatar `fit:"cover"`).

## Context

The reel pipeline (B-028) was built to assemble vertical reels ourselves: submit one
HeyGen render of the full narration, acquire word-level timings (HeyGen `caption_url`
or a whisper.cpp fallback), render chart frames via the static-renderer, then **stitch**
face cuts + chart cuts + burned-in subtitles with a dockerized ffmpeg pipeline
(`@engineerdad/media-stitch`). That path carried real complexity: a 3-tier timing
fallback, scene-to-time alignment, a filtergraph builder, SAR/scale normalisation
(B-032), a whisper model dependency (`WHISPER_MODEL_PATH`), and a docker-ffmpeg runtime.

On 2026-05-29 we verified empirically (see [[project_heygen_vertical_framing]]) that the
HeyGen v2 `/video/generate` API already does server-side what media-stitch did locally:

1. **`video_inputs` is an array of scenes** that HeyGen concatenates into one MP4. One
   POST returns one finished, correctly-framed reel — no download/concat/SAR fixups.
2. **`caption: true`** produces a word-timed caption sidecar (`caption_url` SRT). We do
   not burn captions ourselves; IG/FB auto-captions cover sound-off playback.
3. **Per-scene `background: {type:"image", url}`** renders an uploaded chart full-frame.
   A scene may **omit the `character`** entirely → pure voiceover over the chart image
   (verified: job `a9e8bce6…`). Face scenes keep `character.fit:"cover"` (B-033).
4. **`POST upload.heygen.com/v1/asset`** (raw binary + mime header) returns an asset
   `url` we drop straight into `background.url`.

## Decision

The reel-render worker assembles reels by building a **multi-scene `video_inputs`
payload** and issuing a single HeyGen render. We **delete `@engineerdad/media-stitch`**
and the whisper timing tier. Scene mapping:

| `sceneType`        | HeyGen scene shape                                                              |
|--------------------|---------------------------------------------------------------------------------|
| `face`             | `{ character: {avatar_id, fit:"cover"}, voice, background: {type:"color"} }`     |
| `chart`            | `{ voice, background: {type:"image", url:<uploaded chart>, fit:"cover"} }` — no character |
| `face-over-chart`  | treated as `chart` (full-frame chart + VO; we no longer dock a talking head)     |

`caption: true` is set on every reel render. Captions are a sidecar; we rely on
IG/FB auto-captions for sound-off rendering.

## Consequences

**Gone:** `packages/media-stitch` (filtergraph, docker-run, whisper, scene-to-time,
B-032), the `WHISPER_MODEL_PATH` dependency, the `alignScenesToTimings` step, and the
`Stitching` render state. The worker shrinks from 8 steps to ~5.

**Kept:** static-renderer chart frames (now uploaded to HeyGen instead of stitched);
the orphan-recovery `reelHeygenJobId`-before-poll invariant (HeyGen renders are still
async); asset-store as the artifact home (we download the finished MP4 and re-upload);
`getVideoStatus` still surfaces `subtitleUrl`/`durationSeconds` (harmless, archived).

**New wrapper surface:** `mcp__heygen__upload_asset` and `mcp__heygen__generate_reel`
join `generate_video` and `get_video_status`.

**Trade-off accepted:** we no longer control exact per-scene cut timestamps (HeyGen owns
the concatenated timeline). `sceneCuts[]` in the worker's claim-check becomes a
best-effort approximation from scene VO order, not frame-accurate cuts. `face-over-chart`
loses its docked-head semantics — full-frame chart only.
