# ADR-029: Reel two-type visual scene model (face | visual)

**Status:** Accepted (2026-05-30) — revised 2026-05-31 to collapse three-value enum to two.
**Refines:** ADR-028 (HeyGen-native multi-scene assembly).
**Related:** ADR-014 (static-renderer render-vs-handoff), ADR-016 (render worker), ADR-028 (HeyGen-native pipeline).

## Context

ADR-028 shipped the HeyGen-native multi-scene pipeline with three `sceneType` values:
`face` (talking head), `chart` (full-frame chart over VO), and `face-over-chart` (deprecated
alias treated identically to `chart`). Three limitations surfaced during content planning:

1. **Thin chart narration.** A 30-word VO cap (inherited from face scenes) is too tight to
   explain what a chart shows *and* add a memorable takeaway. Educators routinely take 40–50
   words to walk a single chart.
2. **Effectively one chart.** The original spec said "up to one chart scene per reel." A
   60-second reel with a single chart wastes the format; a 3-scene reel (face → chart → face)
   leaves one visual beat on the table.
3. **"Chart" too narrow.** Many concepts worth showing — compound-growth metaphors, habit
   stacks, mindset reframes — are best conveyed as a styled concept visual (illustration-style
   with a big typographic hook), not a data chart. The `chart` type forced data charts into
   slots where a concept visual would land better.

The render substrate already supports N interleaved scenes through `video_inputs`, and the
static-renderer can produce arbitrary HTML → PNG (as used by the chart path). No new
infrastructure was needed.

**Superseded portion:** the original three-value `face | chart | visual` enum is collapsed
to `face | visual`. The `chart` type is merged into `visual` (distinguished by `chartRef`
being non-null vs. null); `emphasize` is removed; the HeyGen-wrapper `kind` is aligned to
`face | visual` (the dead `face-over-chart` kind is deleted).

## Decision

### Two-type model

`sceneType` is now a **two-value enum: `face | visual`**. `face-over-chart` and `chart` are
retired; `visual` subsumes both data-chart and concept-visual renders, distinguished by
which optional field is populated.

| Scene type | HeyGen substrate | `chartRef` | `visualBrief` | Notes |
|---|---|---|---|---|
| `face` | avatar, `fit: "cover"` | null | null | Avatar-led: hooks, anecdotes, CTAs |
| `visual` (data) | full-frame image bg | non-null | null | Vetted YAML chart; numbers OK |
| `visual` (concept) | full-frame image bg | null | non-null | Brand HTML; no numbers |

**HARD RULE:** `visual` concept scenes carry **no numbers or statistics** on-frame. Anything
quantitative must be a `visual` data scene backed by a vetted `corpus/data/charts/*.yaml`
entry. The no-numbers rule for concept visuals is not machine-scanned at HG3; the HG3 human
review is the backstop.

### Per-scene fields

| Field | Type | Used on |
|---|---|---|
| `sceneType` | `"face" \| "visual"` | all |
| `chartRef` | `string \| null` | visual (data) — key into `corpus/data/charts/*.yaml` |
| `visualBrief` | `string \| null` | visual (concept) — inline creative brief |
| `explains` | `string \| null` | visual (all) — rendered on-frame as ≤12-word support line |

`emphasize` is removed from the schema. The HTML/CSS overlay use case it targeted is
subsumed by the `explains` caption or by the `visualBrief`-authored layout.

### VO budget

- `face` scenes: ≤ 30 words (unchanged).
- `visual` scenes: ≤ 45 words (relaxed from 30). A chart walk needs the headroom.

### Reel composition rules

- Up to **3 visual scenes** per reel.
- A reel must **open and close with a `face` scene**.
- `targetSeconds ≥ Σ estimatedSeconds` remains a creative-director prompt rule; it is not
  enforced in Zod.
- Reels remain **EN-only** (`ReelWorkerInput.language = "en"`).

### Brand-contract alignment

- **§8 (text density by format):** visual scenes must respect the 9:16 safe-area encoding
  (top ~14% / bottom ~20% / right ~12% clear of IG/FB Reels UI chrome). The `explains`
  caption is the only on-frame text on a `visual` scene; all other text lives in the
  face-scene VO.
- **§9 (self-critique rubric):** the `reel-render-worker` agent (model: Opus, per the
  asset-quality plan D10) applies the §9 rubric before calling `render_html_to_png` — it
  self-critiques the generated HTML against density, safe-area, and no-numbers rules before
  rendering.
- **Opus pins:** `render-worker` (model: Opus) handles P2-render for all Reel visual frames;
  `creative-director` (model: Opus) authors the creative plan that selects scene types and
  writes `visualBrief` / `explains` copy.

### Gap fixes shipped with this branch

**G1 — palette plumbing.** `paletteEmphasis` and the new per-scene fields (`visualBrief`,
`explains`) are now plumbed into `ReelWorkerInput` and its projection in
`packages/orchestrator/src/produce/reel-worker-input.ts`.

**G2 — reel safe-area rule.** A reel safe-area encoding (top ~14% / bottom ~20% / right ~12%
of frame must remain clear of IG/FB Reels UI chrome) is documented in the reel-render-worker
prompt and in the 9:16 reference-design exemplars.

**G3 — compliance backstop.** Concept-visual on-frame text is not machine-scanned; the
no-numbers HARD RULE + the HG3 human review are the enforcement surface.

**chartRef defect fix.** The reel-render-worker previously called `render_html_to_png` with
a non-existent `chartRef` argument. The worker now builds chart/visual HTML itself using the
same `buildChartConfig` recipe as the static render worker, then calls
`render_html_to_png({ html })` — the correct signature.

### Supporting artefacts

- **Frames-only dev harness:** `pnpm test:reel-frames <fixture>` renders visual frames
  via the static-renderer without invoking HeyGen. Enables fast iteration on visual scenes.
- **Reference-design exemplars:** 4 reel 9:16 reference designs added under
  `corpus/templates/reference-designs/`.
- **Chart library:** 14 vetted charts under `corpus/data/charts/`. The prior 3-chart cap in
  the creative-director and render-worker prompts is lifted.

## Consequences

**`sceneType` enum change** propagates to: Zod (`ReelSceneTypeEnum`), `ReelWorkerInput`,
the heygen-wrapper `kind` (aligned to `face | visual`; dead `face-over-chart` deleted),
both worker prompts (`reel-render-worker.md`, `creative-director.md`), the
`creative-director` agent, fixtures, and `produce.ts` (worker name is now `render-worker`).
`face-over-chart` references are gone.

**Visual scenes (data)** are corpus-grounded (`corpus/data/charts/*.yaml` vetted numbers +
`source_citation`). Creative-director must select from the library; no ad-hoc numbers.

**Visual scenes (concept)** unlock concept/metaphor communication without data, but
introduce a compliance gap (on-frame text is not scanned). HG3 human review is the sole
backstop until a machine scan is added.

**Reference designs** in `corpus/templates/reference-designs/` now carry 9:16 reel exemplars
alongside the existing static exemplars.

**No downstream branching change:** both paths still converge on
`CreativeVariants.assetFiles[0].url`, which the distribute stage consumes unchanged.
