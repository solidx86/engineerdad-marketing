# Implementation plan — Static-4×5 exemplar catalogue + shared chart-rules partial

Spec: `docs/superpowers/specs/2026-05-31-static-4x5-exemplar-catalogue-design.html`
Branch: `feat/reel-visual-scenes`

## Phase 1 — Extract the shared chart-rules partial (refactor; do first)

1. **Create `corpus/templates/worker-prompts/_chart-rules.md`** — format-agnostic chart doctrine lifted from the two prompts:
   - HTML legend above the canvas; built-in legend OFF.
   - Line charts → line-style swatches (heights mirror line weight) + hero-line point markers; comparison lines marker-less.
   - Callout verbatim from YAML `callout_en`, own row outside the plot rectangle; none → no badge.
   - Numbers + `source_citation` verbatim; never invented/recomputed.
   - `buildChartConfig` + `__chartsReady`; pie/donut hand-authored in the same spirit.
   - Tables/stat-grids: pure HTML, rules above don't apply.
2. **Edit `reel-render-worker.md`** — replace the inline chart-doctrine sentences (steps 3/4/6 of the data-visual block) with a one-line pointer to `_chart-rules.md`. Keep the reel-specific step 5 (DO NOT render `caption_en`) and the safe-area constraint inline.
3. **Edit `render-worker.md`** — same one-line pointer; keep static-specific caption rendering (render `caption_en` below chart) inline. Add the pointer near step 1's brand-contract Read and step 4's chart sub-bullet.
4. **Verify no doctrine drift**: diff the partial against what each prompt said; the union must be a faithful lift. Reel substance unchanged.
5. **Commit** Phase 1.

## Phase 2 — Build the static-4×5 catalogue (10 exemplars)

Per exemplar (author → render → review → promote), reusing the reel frame CSS adapted to 1080×1350 **with a rendered caption row**:

1. `hero-number` (no chart — Feed signature giant figure)
2. `data-bar` ← `start-age-penalty`
3. `data-bar-horizontal` ← `fee-drag-30y`
4. `data-bar-stacked` ← `glide-path-allocation`
5. `data-bar-grouped` ← `single-country-vs-global`
6. `data-line` ← `dca-20y-line` (line-swatch + hero markers)
7. `data-pie` ← hand-authored donut
8. `data-table` ← `epf-baseline-tiers`
9. `data-statgrid` ← `lifestyle-bloat-leaks`
10. `concept-visual` ← freeform, no chart

Mechanics per item:
- Author HTML → `render_html_to_png({run_id:"test-static-<variation>", variant_id:<sha256(scriptId|Feed|4:5).slice(0,12)>, scene_id:1, wait_for_charts:<chart?>})`.
- `Read` the PNG, self-check against brand-contract §9 (bottom-clip, overlap, legibility, caption present).
- Present batch to user for review.

## Phase 3 — Promote + retire

1. Approved renders → `cp` html+png into `reference-designs/static-4x5-<variation>-001.{html,png}`.
2. Add README rows (new "Static 4:5 exemplars" table).
3. Move the 3 stale `feed-*` exemplars to `reference-designs/retired/`.
4. Update `render-worker.md` "Reference designs" section (lines 226–229) to the new set.
5. Commit + push.

## Risks / notes
- Context budget: 10 renders is heavy; may batch across turns. Honest stop-points if needed.
- `buildChartConfig` still lacks pie/horizontal/stacked branches — those exemplars are hand-authored HTML (same as reel). Out of scope to extend the helper now (existing TASKS.md follow-up).
- Caption is the one new on-frame element vs reel — watch vertical clearance (caption + source both below chart at 1350h).
