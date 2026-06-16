# E-025 Per-Platform Aspect Ratios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop the `Feed 1:1` format, make single feed images universal `Feed 4:5`, and split carousels per platform — `Carousel 4:5` for Instagram, `Carousel 1:1` for Facebook — so FB stops cropping multi-photo posts.

**Architecture:** This is a prompt-engineering change set. Four of the five surfaces are agent/worker prompt Markdown (`.claude/agents/*.md`, `corpus/templates/worker-prompts/static-asset.md`); the rest is one throwaway Node script and one test harness + fixture. There is **no TypeScript change** — `Format` and `Aspect` are already separate enum fields, `Aspect` already has `1:1` and `4:5`, and `variantId = sha256(scriptId|format|aspect)` already distinguishes the two carousels. The carousel pair is one creative authored by **one worker** that emits both the 1080×1350 and 1080×1080 layouts and is split into two Variant rows.

**Tech Stack:** Claude Code subagents + worker prompts (Markdown), Node ESM scripts, pnpm workspace, vitest (regression guard only — no code under test changes).

**Spec:** `docs/superpowers/specs/2026-05-21-e-025-per-platform-aspect-ratios-design.md`
**Branch:** `feat/e-025-per-platform-aspect-ratios` (already created and checked out).

**How to read the edits:** Each edit step gives a **FIND** block and a **REPLACE** block, both inside four-backtick fences so any three-backtick fences they contain render literally. The FIND text is the exact current file content; the REPLACE text is the exact new content. Use the Edit tool with `old_string` = FIND, `new_string` = REPLACE.

**Verification note:** Because the bulk of this work is prompt Markdown, "tests" are (a) consistency greps that prove stale references are gone, (b) `pnpm sync:agents:check` proving include-regions were not disturbed, (c) `pnpm test` + sequential `pnpm -r build` as regression guards, and (d) running the two touched scripts. Do not fabricate red-green unit tests for prose edits — verify with the greps and runs specified per task.

---

## Task 1: Worker contract — dual-aspect carousel (`static-asset.md`)

The static-asset worker prompt must teach the worker the new carousel contract: an `aspects[]` array instead of a single `aspect`, authoring 2N HTML documents, and a return shape tagging each scene with its aspect. Do this first — Task 3 (media-production) writes to this contract and Task 7 (fixture) exercises it.

**Files:**
- Modify: `corpus/templates/worker-prompts/static-asset.md`

- [ ] **Step 1: Rewrite the "Inputs you'll receive" section to show both shapes**

FIND:

`````
A JSON block with this shape:

```json
{
  "runId": "run_1778212001",
  "scriptId": "<notion script page id>",
  "variantId": "<sha256-derived 12-char hex>",
  "format": "Feed" | "Carousel" | "Reel" | "YT-Long",
  "aspect": "1:1" | "4:5" | "9:16" | "16:9",
  "width": 1080,
  "height": 1080,
  "language": "en",
  "scenes": [
    {
      "scene": 1,
      "headline": "...",       // chosen_hook.en for card 1; scene.onScreenText for cards 2..N
      "headline_source": "hook" | "onScreenText",
      "body": "...",            // voiceover snippet for the scene
      "shotNotes": "...",       // any visual hints
      "chartRef": null | "compounding-30y" | "dca-vs-lump" | "children-fund-cost"
    }
    // ... more scenes for Carousel; one scene for Feed
  ],
  "thumbnailBrief": "..."       // SOURCE OF TRUTH for color tone — read carefully
}
```
`````

REPLACE:

`````
A JSON block. **Single-aspect Variants (Feed)** carry `aspect` / `width` / `height` at the top level:

```json
{
  "runId": "run_1778212001",
  "scriptId": "<notion script page id>",
  "variantId": "<sha256-derived 12-char hex>",
  "format": "Feed" | "Reel" | "YT-Long",
  "aspect": "1:1" | "4:5" | "9:16" | "16:9",
  "width": 1080,
  "height": 1080,
  "language": "en",
  "scenes": [
    {
      "scene": 1,
      "headline": "...",       // chosen_hook.en for card 1; scene.onScreenText for cards 2..N
      "headline_source": "hook" | "onScreenText",
      "body": "...",            // voiceover snippet for the scene
      "shotNotes": "...",       // any visual hints
      "chartRef": null | "compounding-30y" | "dca-vs-lump" | "children-fund-cost"
    }
    // ... more scenes for Carousel; one scene for Feed
  ],
  "thumbnailBrief": "..."       // SOURCE OF TRUTH for color tone — read carefully
}
```

**Carousel Variants are dual-aspect** (E-025) — one worker authors both the IG (`4:5`, 1080×1350) and FB (`1:1`, 1080×1080) layouts of the same cards. Instead of a single `aspect`, the spec carries an `aspects` array, each entry with its own pre-computed `variantId`:

```json
{
  "runId": "run_1778212001",
  "scriptId": "<notion script page id>",
  "format": "Carousel",
  "aspects": [
    { "aspect": "4:5", "width": 1080, "height": 1350, "variantId": "<id-4x5>" },
    { "aspect": "1:1", "width": 1080, "height": 1080, "variantId": "<id-1x1>" }
  ],
  "language": "en",
  "scenes": [
    {
      "scene": 1,
      "headline": "...",       // chosen_hook.en for card 1; scene.onScreenText for cards 2..N
      "headline_source": "hook" | "onScreenText",
      "body": "...",            // voiceover snippet for the scene
      "shotNotes": "...",       // any visual hints
      "chartRef": null | "compounding-30y" | "dca-vs-lump" | "children-fund-cost"
    }
    // ... one entry per card — the SAME cards render at both aspects
  ],
  "thumbnailBrief": "..."       // SOURCE OF TRUTH for color tone — read carefully
}
```
`````

- [ ] **Step 2: Rewrite the "Multi-scene Variant (Carousel)" paragraph in §4**

FIND:

`````
**Multi-scene Variant (Carousel — N scenes)**: author **all N HTML documents in this single reasoning pass**. Visual consistency is critical — the cards are read as a swipeable series, not isolated. Decisions to lock across all N cards before authoring:
`````

REPLACE:

`````
**Multi-scene Variant (Carousel — N cards, dual-aspect)**: the spec carries an `aspects` array — you author the carousel **twice**, once per aspect (`4:5` = 1080×1350, the IG layout; `1:1` = 1080×1080, the FB layout). Same N cards, same copy, two layouts → **2N HTML documents total**.

Author the **4:5 family first** — all N cards in one reasoning pass. Then derive the **1:1 family**: keep the exact hierarchy, palette, and copy; compress the vertical rhythm so each card fills 1080×1080 without clipping (1:1 has ~270px less height — tighten inter-block gaps, never shrink type below the §4a floor). Do NOT just re-render the 4:5 HTML at a 1080×1080 viewport — `overflow: hidden` would silently clip the bottom. Each aspect gets its own authored HTML.

Visual consistency is critical — the cards are read as a swipeable series, not isolated. Decisions to lock across all N cards (per aspect) before authoring:
`````

- [ ] **Step 3: Rewrite the "Render each HTML" intro + code block in §5**

FIND:

`````
Issue **one** `mcp__static-renderer__render_html_to_png` call per scene/card. For Carousel, batch them as parallel tool calls in one message:

```
mcp__static-renderer__render_html_to_png({
  html: "<the HTML you authored for card 1>",
  width: 1080,
  height: 1080,
  run_id: "<from spawn prompt>",
  variant_id: "<from spawn prompt>",
  scene_id: 1,
  wait_for_charts: <true if this card has chartRef, else false>
})
```

Capture each result: `{ path, sha256, bytes, render_ms }`.
`````

REPLACE:

`````
Issue **one** `mcp__static-renderer__render_html_to_png` call per HTML document. Batch them as parallel tool calls in one message. For a dual-aspect Carousel that is **2N calls** — N cards × 2 aspects.

```
mcp__static-renderer__render_html_to_png({
  html: "<the HTML you authored for this card at this aspect>",
  width: <aspect.width>,    // 1080
  height: <aspect.height>,  // 1350 for 4:5, 1080 for 1:1
  run_id: "<from spawn prompt>",
  variant_id: "<Feed: the top-level variantId. Carousel: aspects[].variantId for THIS aspect>",
  scene_id: <card number>,
  wait_for_charts: <true if this card has chartRef, else false>
})
```

Each aspect's PNGs must be rendered with that aspect's own `variant_id` so they land in the correct asset-store directory. Capture each result: `{ path, sha256, bytes, render_ms }` and remember which `aspect` it belongs to.
`````

- [ ] **Step 4: Update the §6 return-JSON shape**

FIND:

`````
```json
{
  "variantId": "<from spawn prompt>",
  "palette_emphasis": "celebratory" | "authoritative" | "calm" | "alert" | "neutral",
  "scenes": [
    {
      "scene": 1,
      "headline_source": "hook",
      "chart_ref": "compounding-30y" | null,
      "local_path": "<from renderer>",
      "sha256": "<from renderer>",
      "bytes": 123456,
      "render_ms": 850,
      "qa_passed": true,
      "qa_retries": 0,
      "qa_notes": null
    }
    // one entry per scene
  ],
  "errors": []
}
```
`````

REPLACE:

`````
```json
{
  "variantId": "<from spawn prompt — Feed only; OMIT for Carousel (per-scene instead)>",
  "palette_emphasis": "celebratory" | "authoritative" | "calm" | "alert" | "neutral",
  "scenes": [
    {
      "scene": 1,
      "aspect": "4:5",                       // Carousel only — the aspect this PNG was rendered at; omit for Feed
      "variantId": "<aspects[].variantId>",  // Carousel only — the matching aspect's id; omit for Feed
      "headline_source": "hook",
      "chart_ref": "compounding-30y" | null,
      "local_path": "<from renderer>",
      "sha256": "<from renderer>",
      "bytes": 123456,
      "render_ms": 850,
      "qa_passed": true,
      "qa_retries": 0,
      "qa_notes": null
    }
    // Feed: one entry per scene. Carousel: 2N entries — one per (card × aspect).
  ],
  "errors": []
}
```
`````

- [ ] **Step 5: Update the "Reference designs" carousel bullet**

FIND:

`````
- **(Carousel 4:5 reference render pending — see TASKS.md "Carousel 4:5 reference design")** — until a proper 1080×1350 carousel exemplar lands here, use `feed-4x5-alert-chart-001.png` as the 4:5 aspect/spacing target and apply standard carousel-card hierarchy: kicker top-left, `N / total` indicator top-right, big two-line hook headline, supporting line below, logo bottom-right. The position indicator is the only carousel-specific element; everything else inherits from the Feed 4:5 visual grammar.
`````

REPLACE:

`````
- **Carousel — no dedicated exemplar yet** (E-022 will render a `Carousel 4:5` one; a `Carousel 1:1` one follows). Until they land, adapt by aspect: for the **4:5** cards use `feed-4x5-alert-chart-001.png` as the aspect/spacing target; for the **1:1** cards use `feed-1x1-celebratory-001.png` / `feed-1x1-authoritative-chart-001.png`. Apply standard carousel-card hierarchy on top: kicker top-left, `N / total` indicator top-right, big two-line hook headline, supporting line below, logo bottom-right. The position indicator is the only carousel-specific element; everything else inherits from the matching-aspect Feed visual grammar.
`````

- [ ] **Step 6: Verify no stale single-aspect carousel language remains**

Run: `grep -n "Carousel" corpus/templates/worker-prompts/static-asset.md`
Expected: every `Carousel` mention is consistent with dual-aspect — no line says or implies a carousel has a single `aspect`. The Inputs section shows the `aspects[]` shape; §4/§5/§6 all say 2N.

- [ ] **Step 7: Commit**

```bash
git add corpus/templates/worker-prompts/static-asset.md
git commit -m "$(cat <<'EOF'
feat(worker-prompt): E-025 — dual-aspect carousel worker contract

The static-asset worker now receives an aspects[] array for carousels
and authors both the 4:5 (IG) and 1:1 (FB) layouts of the same cards —
2N HTML docs, 2N PNGs, each scene tagged with its aspect in the return.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: media-production Step 5 — Format Matrix, hooks, cost table

Replace the `Feed 1:1` row with `Carousel 1:1`, drop the hook rotation from 5 to 4 (the carousel pair shares one), and fix the cost table.

**Files:**
- Modify: `.claude/agents/media-production.md`

- [ ] **Step 1: Replace the Default Format Matrix table (Step 5)**

FIND:

`````
| # | Format | Aspect | Use |
|---|---|---|---|
| 1 | Reel | 9:16 | TOFU short vertical, primary IG/TikTok |
| 2 | Feed | 1:1 | universal IG/FB feed |
| 3 | Feed | 4:5 | portrait IG/FB feed (higher engagement) |
| 4 | YT-Long | 16:9 | long-form authority + retargeting |
| 5 | Carousel | 4:5 | multi-card static, swipeable proof (portrait 1080×1350 — 2026 IG default; 4:5 takes ~30% more vertical feed real-estate than 1:1) |
`````

REPLACE:

`````
| # | Format | Aspect | Use |
|---|---|---|---|
| 1 | Reel | 9:16 | TOFU short vertical, primary IG/TikTok |
| 2 | Feed | 4:5 | universal single feed image — IG + FB (1080×1350) |
| 3 | YT-Long | 16:9 | long-form authority + retargeting |
| 4 | Carousel | 4:5 | swipeable proof, IG layout (1080×1350) → Meta-paid + IG-organic |
| 5 | Carousel | 1:1 | swipeable proof, FB layout (1080×1080) → FB-organic only |

Rows 4 and 5 are the **same creative** — identical card copy from one shared shotlist — at two layouts. They are produced by a **single carousel worker** (Step 5.5) and split into two Variant rows. `Feed 1:1` is retired (E-025): a single 4:5 image displays uncropped on both IG and FB.
`````

- [ ] **Step 2: Rewrite the hook-rotation paragraph in Step 4**

FIND:

`````
Each Script row carries a `Hook Bank` rich_text property — a JSON array of `{en, ms, register}` containing ≥30 bilingual hooks for that Script's parent Brief. Parse it once per Script. Across the 5 Variants you produce, **rotate through 5 distinct hooks** drawn from this bank — one per Variant — picking different emotional registers per variant (e.g., Reel = curiosity, Feed 1:1 = aspiration, Feed 4:5 = identity, YT-Long = proof, Carousel = contrarian). The chosen hook drives Variant scene 1's `onScreenText` + opening `voiceover`. Never reuse the same hook across two Variants of the same Script.
`````

REPLACE:

`````
Each Script row carries a `Hook Bank` rich_text property — a JSON array of `{en, ms, register}` containing ≥30 bilingual hooks for that Script's parent Brief. Parse it once per Script. The 5-row Format Matrix is **4 distinct creatives** — the two Carousel rows (`4:5` + `1:1`) are one creative at two layouts. **Rotate through 4 distinct hooks** drawn from this bank — one per creative — picking different emotional registers per creative (e.g., Reel = curiosity, Feed 4:5 = identity, YT-Long = proof, Carousel = contrarian). The carousel pair **shares one hook**. The chosen hook drives scene 1's `onScreenText` + opening `voiceover`. Never reuse the same hook across two distinct creatives of the same Script.
`````

- [ ] **Step 3: Fix the cost table (Step 4c)**

FIND:

`````
| Format | Range MYR | Notes |
|---|---|---|
| Reel 9:16 (15–60s) | 200–500 | short vertical video, often UGC-style |
| Feed 1:1 (static or 15s video) | 80–200 | static carousel card or short loop |
| Feed 4:5 (static or video) | 100–250 | portrait, slightly more polish |
| YT-Long 16:9 (5–15 min) | 800–1500 | long-form, scripted, edited |
| Carousel 4:5 (5–10 static cards) | 100–300 | per-card design + copy |
`````

REPLACE:

`````
| Format | Range MYR | Notes |
|---|---|---|
| Reel 9:16 (15–60s) | 200–500 | short vertical video, often UGC-style |
| Feed 4:5 (static or video) | 100–250 | portrait single image, IG + FB |
| YT-Long 16:9 (5–15 min) | 800–1500 | long-form, scripted, edited |
| Carousel 4:5 (5–10 static cards) | 100–300 | per-card design + copy, IG layout |
| Carousel 1:1 (5–10 static cards) | 100–300 | same cards, FB layout (re-laid-out by the same worker) |
`````

- [ ] **Step 4: Rename the G3 single-image heading**

FIND:

`````
#### Single-image static formats (Feed 1:1, Feed 4:5) — gap fix G3
`````

REPLACE:

`````
#### Single-image static format (Feed 4:5) — gap fix G3
`````

- [ ] **Step 5: Rewrite the G4 multi-card heading + paragraph**

FIND:

`````
#### Multi-card static formats (Carousel 4:5) — gap fix G4

Each Carousel Variant is N swipeable cards — one image per scene. Card 1 carries the hook; cards 2..N use that scene's `onScreenText` as the headline so the carousel reads as **hook → development**, not five identical headlines.

- Scenes to render: all of `shotlistEN`.
- Headline rule per card:
  - card 1 (scene 1): `chosen_hook.en`
  - cards 2..N: `scene.onScreenText` (omit headline overlay if empty)
`````

REPLACE:

`````
#### Multi-card static format (Carousel — gap fix G4; dual-aspect per E-025)

The Carousel is **one creative rendered at two aspects** — `Carousel 4:5` (IG layout, 1080×1350) and `Carousel 1:1` (FB layout, 1080×1080). Both carry the same N swipeable cards from the same shotlist. Card 1 carries the hook; cards 2..N use that scene's `onScreenText` as the headline so the carousel reads as **hook → development**, not N identical headlines.

- Scenes to render: all of `shotlistEN`, **at both aspects** — 2N PNGs total.
- Headline rule per card (identical across both aspects):
  - card 1 (scene 1): `chosen_hook.en`
  - cards 2..N: `scene.onScreenText` (omit headline overlay if empty)
- A **single worker** authors both aspect families and renders all 2N PNGs (see the worker spawn loop below). The worker output is split by aspect into the two Variant rows.
`````

- [ ] **Step 6: Commit**

```bash
git add .claude/agents/media-production.md
git commit -m "$(cat <<'EOF'
feat(media-production): E-025 — Format Matrix drops Feed 1:1, adds Carousel 1:1

5-row matrix is now 4 creatives (the carousel pair shares one hook).
Cost table + G3/G4 headings updated. Step 5.5 worker loop lands next.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: media-production Step 5.5 / 5.6 / 7 — carousel one-worker-two-aspects

Teach the worker spawn loop that the carousel pair is **one render unit / one worker**, supply the dual-aspect spawn JSON, split the worker output by aspect into two Variant rows, update the Channels table, and add the doctrine carve-out + Step 7 note.

**Files:**
- Modify: `.claude/agents/media-production.md`

- [ ] **Step 1: Rewrite the "1 worker per Variant" granularity paragraph**

FIND:

`````
The granularity is **1 worker per Variant**, not 1 per scene. For Carousel (5 scenes), a single worker spawn receives all N scenes in its `scenes` array and renders all of them internally. That's by design — the worker amortises its cold-start across the Variant's full scene set.
`````

REPLACE:

`````
The granularity is **1 worker per render unit**, not 1 per scene. A render unit is one static Variant — **except the Carousel pair**: `Carousel 4:5` and `Carousel 1:1` are one creative at two layouts, so they are **one render unit served by one worker** (E-025). That single carousel worker receives all N cards plus the `aspects[]` array and renders all 2N PNGs internally — it amortises its cold-start across the full 2N scene set and guarantees the two layouts stay a coherent family. This is the one documented place where one worker produces two Variant rows; it does not relax the orchestrator-never-renders rule — the heavy HTML composition still lives entirely in worker context.
`````

- [ ] **Step 2: Replace the "Per Variant" spawn block with Feed + Carousel shapes**

FIND:

`````
**Per Variant** (Feed 1:1, Feed 4:5, Carousel 4:5):

1. **Build the worker spawn prompt** by concatenating:
   - The full text of `corpus/templates/worker-prompts/static-asset.md` (loaded in Step 1; pass verbatim — do NOT mutate it)
   - A trailing `## Spawn-time inputs` section with this Variant's JSON spec:

     ```json
     {
       "runId": "<runId>",
       "scriptId": "<script page id>",
       "variantId": "<G5 sha256-derived id>",
       "format": "<Feed | Carousel>",
       "aspect": "<1:1 | 4:5>",
       "width": <1080 typically>,
       "height": <1080 for 1:1, 1350 for 4:5>,
       "language": "en",
       "scenes": [
         {
           "scene": 1,
           "headline": "<chosen_hook.en for card 1; scene.onScreenText for cards 2..N>",
           "headline_source": "hook" | "onScreenText",
           "body": "<scene.voiceover (EN)>",
           "shotNotes": "<scene.shotNotes>",
           "chartRef": "<from scene.chartRef, may be null>"
         }
         // ... one entry per scene to render (1 for Feed, N for Carousel)
       ],
       "thumbnailBrief": "<the Variant's thumbnailBrief from Step 4b>"
     }
     ```

   For **Feed** (G3 hero-only rule): include only scene 1 in the `scenes` array. The other scenes exist as storyboard guidance for human video production but are NOT rendered.

   For **Carousel** (G4 hook variation rule): include all N scenes. Card 1's `headline` = `chosen_hook.en`; cards 2..N's `headline` = each scene's `onScreenText`. Set `headline_source` accordingly.
`````

REPLACE:

`````
**Per render unit.** Feed Variants are one render unit each; the Carousel pair is one render unit. Build one worker spawn per render unit:

1. **Build the worker spawn prompt** by concatenating:
   - The full text of `corpus/templates/worker-prompts/static-asset.md` (loaded in Step 1; pass verbatim — do NOT mutate it)
   - A trailing `## Spawn-time inputs` section with the render unit's JSON spec.

   **Feed render unit** — single-aspect spec (`aspect` / `width` / `height` at top level):

   ```json
   {
     "runId": "<runId>",
     "scriptId": "<script page id>",
     "variantId": "<G5 sha256-derived id>",
     "format": "Feed",
     "aspect": "4:5",
     "width": 1080,
     "height": 1350,
     "language": "en",
     "scenes": [
       {
         "scene": 1,
         "headline": "<chosen_hook.en>",
         "headline_source": "hook",
         "body": "<scene.voiceover (EN)>",
         "shotNotes": "<scene.shotNotes>",
         "chartRef": "<from scene.chartRef, may be null>"
       }
     ],
     "thumbnailBrief": "<the Variant's thumbnailBrief from Step 4b>"
   }
   ```

   Feed (G3 hero-only rule): include only scene 1 in `scenes`. Scenes 2..N are storyboard guidance for human video production and are NOT rendered.

   **Carousel render unit** — dual-aspect spec (`aspects[]` replaces the single `aspect`; one pre-computed `variantId` per aspect):

   ```json
   {
     "runId": "<runId>",
     "scriptId": "<script page id>",
     "format": "Carousel",
     "aspects": [
       { "aspect": "4:5", "width": 1080, "height": 1350, "variantId": "<sha256(scriptId|Carousel|4:5)[:12]>" },
       { "aspect": "1:1", "width": 1080, "height": 1080, "variantId": "<sha256(scriptId|Carousel|1:1)[:12]>" }
     ],
     "language": "en",
     "scenes": [
       {
         "scene": 1,
         "headline": "<chosen_hook.en for card 1; scene.onScreenText for cards 2..N>",
         "headline_source": "hook" | "onScreenText",
         "body": "<scene.voiceover (EN)>",
         "shotNotes": "<scene.shotNotes>",
         "chartRef": "<from scene.chartRef, may be null>"
       }
       // ... one entry per card — the SAME cards render at both aspects
     ],
     "thumbnailBrief": "<the carousel creative's thumbnailBrief from Step 4b>"
   }
   ```

   Carousel (G4 hook variation rule): include all N cards. Card 1's `headline` = `chosen_hook.en`; cards 2..N's `headline` = each scene's `onScreenText`. Compute both `variantId`s with the G5 formula — one per aspect — and place each in its `aspects[]` entry.
`````

- [ ] **Step 3: Update the worker-return JSON block + add the carousel-split note**

FIND:

`````
   ```json
   {
     "variantId": "...",
     "palette_emphasis": "celebratory" | "authoritative" | "calm" | "alert" | "neutral",
     "scenes": [
       {
         "scene": 1,
         "headline_source": "hook",
         "chart_ref": "compounding-30y" | null,
         "local_path": "<from renderer>",
         "sha256": "<from renderer>",
         "bytes": 123456,
         "render_ms": 850
       }
     ],
     "errors": []
   }
   ```

   Parse it. If the worker returns no JSON or all scenes are in `errors[]`: treat as a total worker failure (see failure handling below).
`````

REPLACE:

`````
   ```json
   {
     "variantId": "...",                       // Feed: the single variantId. Carousel: omit — see per-scene aspect tags.
     "palette_emphasis": "celebratory" | "authoritative" | "calm" | "alert" | "neutral",
     "scenes": [
       {
         "scene": 1,
         "aspect": "4:5",                      // Carousel scenes only; absent for Feed (single-aspect)
         "variantId": "<id-for-this-aspect>",  // Carousel scenes only; absent for Feed
         "headline_source": "hook",
         "chart_ref": "compounding-30y" | null,
         "local_path": "<from renderer>",
         "sha256": "<from renderer>",
         "bytes": 123456,
         "render_ms": 850
       }
     ],
     "errors": []
   }
   ```

   Parse it. If the worker returns no JSON or all scenes are in `errors[]`: treat as a total worker failure (see failure handling below).

   **Carousel render unit — split the output by aspect.** A carousel worker returns 2N scene entries, each tagged with `aspect` (`4:5` or `1:1`) and the matching `variantId`. Process steps 4–6 below per scene using that scene's own `aspect`/`variantId`. The `4:5` scenes compose the `Carousel 4:5` Variant row; the `1:1` scenes compose the `Carousel 1:1` Variant row. Each carousel row gets its own `imageGenerationNotes` array (its aspect's scenes only) and its own `Asset Files`. Both rows share the parent Script, hook, and shotlist.
`````

- [ ] **Step 4: Make the asset-store `variant_id` comment carousel-aware**

FIND:

`````
     variant_id: <variantId>,        // G5 sha256-derived id
`````

REPLACE:

`````
     variant_id: <variantId>,        // G5 id; for Carousel scenes use scene.variantId (the aspect's id)
`````

- [ ] **Step 5: Make the render-event `aspect` field carousel-aware**

FIND:

`````
       format: variant.format, aspect: variant.aspect,
`````

REPLACE:

`````
       format: variant.format, aspect: <variant.aspect; for Carousel use scene.aspect>,
`````

- [ ] **Step 6: Update the Step 5.6 intro line to key on Format + Aspect**

FIND:

`````
Compute the `Channels` multi_select value for each Variant from `Format` (set in Step 5) and the parent Brief's `Funnel Stage` (already resolved in Step 3.5 via the bucketByBriefId map; same two-hop).
`````

REPLACE:

`````
Compute the `Channels` multi_select value for each Variant from `Format` + `Aspect` (set in Step 5) and the parent Brief's `Funnel Stage` (already resolved in Step 3.5 via the bucketByBriefId map; same two-hop).
`````

- [ ] **Step 7: Replace the Step 5.6 Channels table + add the carousel-routing note**

FIND:

`````
| Format                          | Funnel Stage  | Channels                              |
|---------------------------------|---------------|---------------------------------------|
| `YT-Long` (16:9)                | any           | `["YouTube"]`                         |
| `Reel` (9:16)                   | `TOFU`        | `["Meta-paid"]`                       |
| `Reel` (9:16)                   | `MOFU` / `BOFU` | `["Meta-paid", "Meta-organic"]`     |
| `Feed` (1:1 / 4:5)              | `TOFU`        | `["Meta-paid"]`                       |
| `Feed` (1:1 / 4:5)              | `MOFU` / `BOFU` | `["Meta-paid", "Meta-organic"]`     |
| `Carousel` (4:5)                | `TOFU`        | `["Meta-paid"]`                       |
| `Carousel` (4:5)                | `MOFU` / `BOFU` | `["Meta-paid", "Meta-organic"]`     |
| `YT-Short` (9:16) if used       | any           | `["YouTube-Shorts"]`                  |
`````

REPLACE:

`````
| Format                          | Funnel Stage  | Channels                              |
|---------------------------------|---------------|---------------------------------------|
| `YT-Long` (16:9)                | any           | `["YouTube"]`                         |
| `Reel` (9:16)                   | `TOFU`        | `["Meta-paid"]`                       |
| `Reel` (9:16)                   | `MOFU` / `BOFU` | `["Meta-paid", "Meta-organic"]`     |
| `Feed` (4:5)                    | `TOFU`        | `["Meta-paid"]`                       |
| `Feed` (4:5)                    | `MOFU` / `BOFU` | `["Meta-paid", "Meta-organic"]`     |
| `Carousel` (4:5)                | any           | `["Meta-paid", "Meta-organic"]`       |
| `Carousel` (1:1)                | any           | `["Meta-organic"]`                    |
| `YT-Short` (9:16) if used       | any           | `["YouTube-Shorts"]`                  |

**Carousel aspect routing (E-025).** `Carousel 4:5` carries `Meta-organic` for all funnel stages (not just MOFU/BOFU) so the /post-week planner always finds a `4:5`+`1:1` pair of the same creative for the weekly carousel slot. `Carousel 1:1` is organic-only — never paid; Step 5.7a's Meta-paid spec derivation skips it automatically because its Channels lack `Meta-paid`.
`````

- [ ] **Step 8: Add the E-025 note after the Step 7.0 assertion explanation**

FIND:

`````
(A) catches the 2026-05-17 regression class: agent decomposes Variants, writes Notion rows, never invokes workers, returns "success" with empty Asset Files. (B) catches the 2026-05-20 F2 regression class: agent skips worker spawn but renders scenes itself via the retry-path tool, slipping past assertion (A) because scenes were rendered. Both are silent failures the orchestrator must surface, not absorb.
`````

REPLACE:

`````
(A) catches the 2026-05-17 regression class: agent decomposes Variants, writes Notion rows, never invokes workers, returns "success" with empty Asset Files. (B) catches the 2026-05-20 F2 regression class: agent skips worker spawn but renders scenes itself via the retry-path tool, slipping past assertion (A) because scenes were rendered. Both are silent failures the orchestrator must surface, not absorb.

**E-025 note.** With the dual-aspect carousel, `staticVariantsCreated` counts both `Carousel 4:5` and `Carousel 1:1` (2) while the carousel pair spawns just **one** worker — so a normal run has `workersSpawned < staticVariantsCreated`. This is expected: both assertions test `workersSpawned == 0`, never equality with the Variant count. Do not "fix" a run by forcing a 1:1 worker-to-Variant ratio.
`````

- [ ] **Step 9: Verify no stale `Feed 1:1` references remain in media-production.md**

Run: `grep -n "Feed 1:1\|1:1 / 4:5" .claude/agents/media-production.md`
Expected: **no output**. If anything matches, fix it before committing.

- [ ] **Step 10: Commit**

```bash
git add .claude/agents/media-production.md
git commit -m "$(cat <<'EOF'
feat(media-production): E-025 — one carousel worker, two aspect rows

Step 5.5 spawns a single carousel worker with an aspects[] spec; its
2N-scene output is split by aspect into the Carousel 4:5 + Carousel 1:1
rows. Channels table: Carousel 4:5 organic for all stages, Carousel 1:1
organic-only. Doctrine carve-out + Step 7.0 note added.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: brain.md §G — organic planner picks the carousel pair

The /post-week organic planner must select **one carousel creative** and queue **both** its aspect rows for the Tuesday slot.

**Files:**
- Modify: `.claude/agents/brain.md`

- [ ] **Step 1: Extend the Step 3 pool-query field pull**

FIND:

`````
   Pull `id, Format, Funnel Stage, run_id` for each row.
`````

REPLACE:

`````
   Pull `id, Format, Aspect, Script (scriptId), Funnel Stage, run_id` for each row.
`````

- [ ] **Step 2: Rewrite the Step 4 Selection block**

FIND:

`````
4. **Selection** — group by `Format` (the bare `SCRIPT_FORMAT` enum value — `Reel` | `Feed` | `Carousel` — never an aspect-suffixed string; a Format may carry several `Aspect` variants and the planner selects by Format only, aspect-agnostic. Per-platform aspect routing is downstream — see E-025). From each group, pick the top N by `(run_id DESC, funnel_stage_priority)`. `funnel_stage_priority`: TOFU=3, MOFU=2, BOFU=1. Targets:
   - 3 from `Feed`
   - 1 from `Carousel`
   - 1 from `Reel` (IFF `reelThisWeek`)

   If any group has fewer rows than target, queue what's available and add to summary: `pool_short: <format> needed N, got M`.
`````

REPLACE:

`````
4. **Selection** — group the pool by `Format` (`Reel` | `Feed` | `Carousel`). Rank within each group by `(run_id DESC, funnel_stage_priority)`; `funnel_stage_priority`: TOFU=3, MOFU=2, BOFU=1. Targets:
   - **3 from `Feed`** — each `Feed` row is a distinct Script (`Feed` is single-aspect `4:5` after E-025), so the top 3 rows are 3 distinct creatives.
   - **1 from `Carousel`** — the `Carousel` group holds **two rows per creative** (`Carousel 4:5` and `Carousel 1:1`, same `scriptId`). Dedupe the group to creatives by `scriptId`, rank the creatives, pick the top **1 creative**, then **queue both of its aspect rows** — the `4:5` row (→ IG via the manual posting pack) and the `1:1` row (→ FB via distribution §4d). Both rows take the same Carousel slot (Tue 19:00).
   - **1 from `Reel`** (IFF `reelThisWeek`).

   If a group is short, queue what's available and add to summary: `pool_short: <format> needed N, got M`. For `Carousel`, "short" means no organic-eligible carousel creative is available (M = count of creatives, not rows).
`````

- [ ] **Step 3: Verify §G is internally consistent**

Run: `sed -n '/## §G/,/^## Hard rules/p' .claude/agents/brain.md | grep -n "Carousel\|Aspect\|scriptId"`
Expected: Step 3 pulls `Aspect` + `Script (scriptId)`; Step 4 dedupes carousel by `scriptId` and queues both aspect rows. The slot table (Carousel = Tue 19:00) is unchanged.

- [ ] **Step 4: Commit**

```bash
git add .claude/agents/brain.md
git commit -m "$(cat <<'EOF'
feat(brain): E-025 — organic planner queues the carousel pair

§G Step 4 dedupes the Carousel group to creatives by scriptId, picks one,
and queues both its 4:5 (IG) and 1:1 (FB) aspect rows onto the Tue slot.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: distribution.md §4d — route Carousel 1:1 to FB

§4d publishes `Carousel 1:1` to FB via `publish_carousel_post` and excludes only `Carousel 4:5`. Also fix the stale `Carousel 1:1` reference in the paid static-formats list.

**Files:**
- Modify: `.claude/agents/distribution.md`

- [ ] **Step 1: Fix the stale paid-branch static-formats list (≈ line 169)**

FIND:

`````
- **Static formats** (Feed 1:1, Feed 4:5, Carousel 1:1): per `Asset Files`, find the image asset
`````

REPLACE:

`````
- **Static formats** (Feed 4:5, Carousel 4:5): per `Asset Files`, find the image asset
`````

(Only that prefix changes — the rest of the bullet, from "(`png`/`jpg` ext)" onward, is left exactly as is.)

- [ ] **Step 2: Rewrite the B-008 note block as the E-025 note**

FIND:

`````
> **B-008 — Carousel format is IG-only.** Facebook renders a multi-photo post as a cropped album mosaic, not a swipeable carousel — 4:5 carousel cards get clipped. Carousels stay 4:5 (best-practice for IG, the primary surface) and are **not** published to FB. FB still receives that Script's content via its Feed variant. The filter below excludes Carousel; the user posts carousels to IG by hand via the posting pack.
`````

REPLACE:

`````
> **E-025 — per-platform carousel aspect.** Carousels ship per platform: `Carousel 4:5` is the IG layout (manual posting pack, B-005) and `Carousel 1:1` is the FB layout, published here. FB renders a multi-photo post as an album mosaic that only survives intact at 1:1 — so the 1:1 row goes to FB and the 4:5 row does not. This supersedes B-008's interim "carousels are IG-only" (carousels are back on FB, at 1:1). The filter below excludes `Carousel 4:5` only.
`````

- [ ] **Step 3: Update the §4d filter**

FIND:

`````
AND(
  Channels contains "Meta-organic",
  "Organic Status" == "Approved",
  "Organic Scheduled For" is not empty,
  "FB Post ID" is empty,
  Format != "Carousel"
)
`````

REPLACE:

`````
AND(
  Channels contains "Meta-organic",
  "Organic Status" == "Approved",
  "Organic Scheduled For" is not empty,
  "FB Post ID" is empty,
  NOT (Format == "Carousel" AND Aspect == "4:5")
)
`````

- [ ] **Step 4: Rewrite the §4d step 4 "FB publish" branch**

FIND:

`````
4. **FB publish** based on Format (always `platform: "fb"`):
   - `Feed 1:1` / `Feed 4:5` → `mcp__meta-organic__publish_image_post({ variantId, platform: "fb", imageUrl: <fb_asset>, caption: <fb_body>, lang: <"en"|"ms"> matching Organic Language, scheduledPublishTime })`
   - `Reel 9:16` → `mcp__meta-organic__publish_video_post({ variantId, platform: "fb", videoUrl: <Reel MP4 URL>, caption: <fb_body>, lang, scheduledPublishTime })`
   - `Carousel` → **not published to FB** (B-008 — excluded by the filter above; IG-only via the posting pack).
`````

REPLACE:

`````
4. **FB publish** based on Format / Aspect (always `platform: "fb"`):
   - `Feed 4:5` → `mcp__meta-organic__publish_image_post({ variantId, platform: "fb", imageUrl: <fb_asset>, caption: <fb_body>, lang: <"en"|"ms"> matching Organic Language, scheduledPublishTime })`
   - `Reel 9:16` → `mcp__meta-organic__publish_video_post({ variantId, platform: "fb", videoUrl: <Reel MP4 URL>, caption: <fb_body>, lang, scheduledPublishTime })`
   - `Carousel 1:1` → `mcp__meta-organic__publish_carousel_post({ variantId, platform: "fb", imageUrls: [<all N scene PNGs from Asset Files, ordered by trailing scene number>], caption: <fb_body>, lang, scheduledPublishTime })`. The MCP accepts 2–10 image URLs and uploads them as `attached_media`. Pick the language-matched PNGs the same way as step 1 (`*_en.png` / `*_bm.png`).
   - `Carousel 4:5` → **not published to FB** (E-025 — excluded by the filter above; IG layout, goes to IG via the posting pack).
`````

- [ ] **Step 5: Verify §4d is consistent**

Run: `grep -n "Carousel\|B-008\|Feed 1:1" .claude/agents/distribution.md`
Expected: no `B-008` mention (replaced by the E-025 note); no `Feed 1:1`; the filter excludes `Carousel 4:5`; step 4 has a `Carousel 1:1` → `publish_carousel_post` branch; the paid static-formats list (≈ line 169) reads `Feed 4:5, Carousel 4:5`.

- [ ] **Step 6: Commit**

```bash
git add .claude/agents/distribution.md
git commit -m "$(cat <<'EOF'
feat(distribution): E-025 — §4d publishes Carousel 1:1 to FB

§4d routes Carousel 1:1 to publish_carousel_post (FB attached_media) and
excludes only Carousel 4:5. Supersedes B-008's carousel-IG-only interim.
Stale "Carousel 1:1" in the paid static-formats list corrected to 4:5.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Posting pack — exclude Carousel 1:1 from the IG queue

`scripts/build-posting-pack.mjs` builds the manual IG queue. `Carousel 1:1` is FB-only and never gets an `IG Post ID`, so without an exclusion it would sit in the queue forever.

**Files:**
- Modify: `scripts/build-posting-pack.mjs`

- [ ] **Step 1: Update the queue-filter comment in the header**

FIND:

`````
// Queue filter: CreativeVariants where Organic Status = Approved AND IG Post ID
// is empty. After posting a variant on IG, set its IG Post ID in Notion to
// anything non-empty — it drops off the next build.
`````

REPLACE:

`````
// Queue filter: CreativeVariants where Organic Status = Approved AND IG Post ID
// is empty, EXCLUDING Carousel 1:1 (the FB-only layout — E-025). After posting
// a variant on IG, set its IG Post ID in Notion to anything non-empty — it
// drops off the next build.
`````

- [ ] **Step 2: Add `aspect` to the post object**

FIND:

`````
    return {
      title: getTitle(p),
      format: getSelect(p, "Format") ?? "—",
      lang,
`````

REPLACE:

`````
    return {
      title: getTitle(p),
      format: getSelect(p, "Format") ?? "—",
      aspect: getSelect(p, "Aspect"),
      lang,
`````

- [ ] **Step 3: Filter out Carousel 1:1 between `.map()` and `.sort()`**

FIND:

`````
  })
  .sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)));
`````

REPLACE:

`````
  })
  // E-025: Carousel 1:1 is the FB layout — published by distribution §4d, never
  // posted to IG. Exclude it so it doesn't linger in the IG queue forever (it
  // never receives an IG Post ID).
  .filter((post) => !(post.format === "Carousel" && post.aspect === "1:1"))
  .sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)));
`````

- [ ] **Step 4: Syntax-check the script**

Run: `node --check scripts/build-posting-pack.mjs`
Expected: exits 0, no output. (A full run needs live Notion + R2 credentials — the functional check is the dry-run in the post-merge section.)

- [ ] **Step 5: Commit**

```bash
git add scripts/build-posting-pack.mjs
git commit -m "$(cat <<'EOF'
feat(scripts): E-025 — posting pack excludes Carousel 1:1 from IG queue

Carousel 1:1 is FB-only (distribution §4d) and never gets an IG Post ID,
so it would otherwise sit in the manual IG queue forever.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Worker test harness + carousel fixture — dual-aspect

The `carousel-5card.json` fixture and the `test-static-worker.mjs` harness must use the new `aspects[]` contract.

**Files:**
- Modify: `scripts/fixtures/static-worker/carousel-5card.json`
- Modify: `scripts/test-static-worker.mjs`

- [ ] **Step 1: Convert `carousel-5card.json` to the dual-aspect shape**

FIND:

`````
{
  "scriptId": "test_script_004",
  "format": "Carousel",
  "aspect": "1:1",
  "width": 1080,
  "height": 1080,
  "language": "en",
  "scenes": [
`````

REPLACE:

`````
{
  "scriptId": "test_script_004",
  "format": "Carousel",
  "aspects": [
    { "aspect": "4:5", "width": 1080, "height": 1350 },
    { "aspect": "1:1", "width": 1080, "height": 1080 }
  ],
  "language": "en",
  "scenes": [
`````

(Leave the `scenes` array and `thumbnailBrief` exactly as they are.)

- [ ] **Step 2: Make the harness derive a variantId per aspect**

FIND:

`````
// Force runId to a deterministic test value so output paths are predictable.
fixture.runId = `test-run-${fixtureName}`;

// If the fixture didn't pre-compute variantId, derive it deterministically from
// the same G5 formula media-production uses (sha256(scriptId|format|aspect)[:12]).
if (!fixture.variantId) {
  const { createHash } = await import("node:crypto");
  fixture.variantId = createHash("sha256")
    .update(`${fixture.scriptId}|${fixture.format}|${fixture.aspect}`)
    .digest("hex")
    .slice(0, 12);
}
`````

REPLACE:

`````
// Force runId to a deterministic test value so output paths are predictable.
fixture.runId = `test-run-${fixtureName}`;

// Derive variantId(s) with the G5 formula media-production uses
// (sha256(scriptId|format|aspect)[:12]).
const { createHash } = await import("node:crypto");
const deriveVariantId = (aspect) =>
  createHash("sha256")
    .update(`${fixture.scriptId}|${fixture.format}|${aspect}`)
    .digest("hex")
    .slice(0, 12);

if (Array.isArray(fixture.aspects)) {
  // E-025 dual-aspect carousel: one worker, one variantId per aspect entry.
  for (const a of fixture.aspects) {
    if (!a.variantId) a.variantId = deriveVariantId(a.aspect);
  }
} else if (!fixture.variantId) {
  fixture.variantId = deriveVariantId(fixture.aspect);
}
`````

- [ ] **Step 3: Make the render-path console line handle both shapes**

FIND:

`````
console.log(`Renders will land at:     data/assets/${fixture.runId}/${fixture.variantId}/<scene>.png`);
`````

REPLACE:

`````
if (Array.isArray(fixture.aspects)) {
  for (const a of fixture.aspects) {
    console.log(`Renders will land at:     data/assets/${fixture.runId}/${a.variantId}/<scene>.png  (${a.aspect})`);
  }
} else {
  console.log(`Renders will land at:     data/assets/${fixture.runId}/${fixture.variantId}/<scene>.png`);
}
`````

- [ ] **Step 4: Run the harness against the dual-aspect carousel fixture**

Run: `pnpm test:worker carousel-5card`
Expected: exits 0; prints **two** "Renders will land at:" lines — one ending `(4:5)`, one ending `(1:1)` — and the assembled `Task(` call embeds the `aspects[]` array in the JSON spec.

- [ ] **Step 5: Confirm a single-aspect fixture still works (regression)**

Run: `pnpm test:worker feed-4x5-portrait`
Expected: exits 0; prints exactly **one** "Renders will land at:" line (no `(aspect)` suffix). The single-aspect path is unbroken.

- [ ] **Step 6: Commit**

```bash
git add scripts/fixtures/static-worker/carousel-5card.json scripts/test-static-worker.mjs
git commit -m "$(cat <<'EOF'
feat(scripts): E-025 — dual-aspect carousel worker fixture + harness

carousel-5card.json now uses the aspects[] contract; test-static-worker
derives a variantId per aspect entry and prints both render paths.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: TASKS.md bookkeeping + full verification

Mark E-025 shipped, close B-008, and run the repo-wide regression guards.

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Update the B-008 entry's resolution line**

FIND:

`````
- **Superseded by E-025** — the user wants FB carousels back, at 1:1. E-025 is the proper per-platform-aspect fix (deferred, spec-later). B-008's interim holds until E-025 ships.
`````

REPLACE:

`````
- **Resolved by E-025** (shipped 2026-05-21) — FB carousels are back, at 1:1 (`Carousel 1:1`). The interim "carousel IG-only" filter is replaced by E-025's aspect-aware §4d routing.
`````

- [ ] **Step 2: Add a Status line to the E-025 entry**

FIND:

`````
- **Deferred — build LAST**, after the organic-cadence smoke test + the B-005..B-009 work fully wraps. Spec not yet written.
`````

REPLACE:

`````
- **Status**: ✅ Shipped 2026-05-21 (branch `feat/e-025-per-platform-aspect-ratios`). Spec: `docs/superpowers/specs/2026-05-21-e-025-per-platform-aspect-ratios-design.md`; plan: `docs/superpowers/plans/2026-05-21-e-025-per-platform-aspect-ratios.md`.
`````

- [ ] **Step 3: Run `pnpm sync:agents:check`**

Run: `pnpm sync:agents:check`
Expected: passes — the E-025 edits are all in hand-authored agent body text, never inside an `<!-- include: -->` region, so the synced fragments still match. If it fails, an edit strayed into an include-region — move that content out.

- [ ] **Step 4: Run the test suite (regression guard)**

Run: `pnpm test`
Expected: all tests pass. No code under test changed (no TS, no enum) — a failure here means an unrelated breakage; investigate before proceeding.

- [ ] **Step 5: Run the sequential build (regression guard)**

Run: `pnpm -r build`
Expected: all packages build. **Do not use `pnpm build` or `--parallel`** — the parallel form races on `@engineerdad/shared` (README §"Resuming on another machine").

- [ ] **Step 6: Final cross-file consistency grep**

Run: `grep -rn "Feed 1:1" .claude/agents/media-production.md .claude/agents/distribution.md`
Expected: **no output**. `Feed 1:1` is fully retired from the operative agent prompts. (TASKS.md is deliberately excluded — the E-025 entry there describes `Feed 1:1` as the format being dropped, which is correct historical context, not a stale reference.)

- [ ] **Step 7: Commit**

```bash
git add TASKS.md
git commit -m "$(cat <<'EOF'
docs(tasks): E-025 shipped — per-platform organic aspect ratios

Marks E-025 done and closes B-008 (FB carousels restored at 1:1).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Manual verification (post-merge, against the live workspace)

These need live Notion / Meta credentials and an approved Script — run them when validating the change end-to-end, not as part of task execution:

1. **`/produce` (or a dry walk-through)** on an approved Script → expect 5 Variant rows (`Reel 9:16`, `Feed 4:5`, `YT-Long 16:9`, `Carousel 4:5`, `Carousel 1:1`), the two carousel rows sharing one hook, and the run log showing **one** carousel worker serving both rows.
2. **`/post-week`** → the carousel slot queues **both** aspect rows of one creative; `Feed` selection draws 3 distinct Scripts.
3. **`/distribute --channels=meta-organic --dry-run`** → `Carousel 1:1` routes to `publish_carousel_post` (FB); `Carousel 4:5` is excluded from FB publishing.
4. **`/posting-pack`** (or `node scripts/build-posting-pack.mjs`) → the rebuilt IG pack contains `Feed 4:5` + `Carousel 4:5` rows and **no** `Carousel 1:1` row.

## Spec coverage check

| Spec section | Task(s) |
|---|---|
| 1 · Format Matrix (drop Feed 1:1, add Carousel 1:1, 4 hooks) | Task 2 |
| 2 · Carousel one-worker-two-aspects (contract + carve-out + Step 7) | Task 1, Task 3 |
| 3 · Channels table | Task 3 (Step 7) |
| 4 · Organic planner §G | Task 4 |
| 5 · Distribution §4d (filter, publish branch, B-008 rewrite, line-169 fix) | Task 5 |
| 6 · Posting pack exclusion | Task 6 |
| Testing — worker fixture / harness | Task 7 |
| TASKS.md bookkeeping; sync/build/test regression guards | Task 8 |
