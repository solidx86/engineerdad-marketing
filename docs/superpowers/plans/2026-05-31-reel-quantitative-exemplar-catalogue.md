# Plan — Reel Quantitative-Visual Exemplar Catalogue

Spec: `docs/superpowers/specs/2026-05-31-reel-quantitative-exemplar-catalogue-design.html`
Branch: `feat/reel-visual-scenes`

This is mostly **content** work (fixtures, prompt, docs) — not package code, so there is little to unit-test.
Verification is "render a fixture and confirm the `.html` + `.png` both land + the layout is reviewable." Iterate fast.

---

## Phase 0 — Recon (do first, blocks the rest)

- [ ] **0.1** Grep for references to `mixed-reel` / `data-visual` fixture names in `scripts/`, `packages/`, `mcp-servers/`, `corpus/`, and any vitest. Note what must be updated when we delete/rename.
- [ ] **0.2** Confirm `ReelShotlistSchema` (in `packages/shared/src/zod.ts`) accepts a **single `visual` scene, `faceFirstHook:false`, no face scene**. If a refinement forbids it, decide the minimal reconciliation (the catalogue depends on this). Record the verdict in the plan before Phase 1.
- [ ] **0.3** Spot-check the 8 seed YAMLs' data shapes vs target layouts (grouped needs ≥2 series; pie needs proportions; table needs few entities × few metrics). Swap any misfit seed and update the spec table.

## Phase 1 — Prove the loop on ONE new fixture (`data-bar`)

- [ ] **1.1** Author `scripts/fixtures/reel-worker/data-bar.json` (single visual scene, `chartRef: dca-vs-lump`, `faceFirstHook:false`, `explains` = "side-by-side comparison of units acquired").
- [ ] **1.2** Edit `reel-render-worker.md` Step 2 data-visual branch: add **presentation latitude** (chart / table / stat-grid by `scene.explains`; numbers + citation verbatim; §4a/§8/§9 always; §5 chart rules only for charts).
- [ ] **1.3** Edit `reel-render-worker.md` Step 2: add the **persist-HTML** sub-step — after each `render_html_to_png`, `Write` the authored HTML to `data/assets/<runId>/<variantId>/<scene>.html`.
- [ ] **1.4** Run `pnpm test:reel-frames data-bar`, spawn the worker (frames-only), and verify: PNG renders, **`<scene>.html` exists beside it**, layout is a clean vertical bar. Review with the user.
- [ ] **1.5** Iterate prompt wording until the bar render passes §9 and the HTML persists reliably. **Gate: user approves the loop before scaling.**

## Phase 2 — Author the rest of the catalogue

One fixture each; same shape as `data-bar`:
- [ ] **2.1** Rename `data-visual.json` → `data-line.json` (update the rename anywhere it's referenced from 0.1).
- [ ] **2.2** `data-bar-horizontal.json` (lifestyle-bloat-leaks).
- [ ] **2.3** `data-bar-stacked.json` (glide-path-allocation).
- [ ] **2.4** `data-bar-grouped.json` (epf-baseline-tiers).
- [ ] **2.5** `data-pie.json` (glide-path-allocation).
- [ ] **2.6** `data-table.json` (single-country-vs-global).
- [ ] **2.7** `data-statgrid.json` (start-age-penalty).
- [ ] **2.8** Delete `mixed-reel.json` + clean up any reference found in 0.1.

## Phase 3 — Render, review, promote (iterative, per fixture)

For each fixture (start with the cheapest charts, end with pie/table/statgrid):
- [ ] **3.1** `pnpm test:reel-frames <fixture>` → spawn → review PNG with user.
- [ ] **3.2** On reject: sharpen `scene.explains` (or prompt) and re-render. Track tokens per agent (user is metering).
- [ ] **3.3** On approve: promote — `cp` the `.png` and `.html` into `corpus/templates/reference-designs/reel/reel-9x16-<variation>-NNN.{png,html}`; add a README "Reel exemplars" row.
- [ ] **3.4** For approved **chart** exemplars, point the prompt's reference-designs list at them (≤3 per bucket).

## Phase 4 — Docs + convention

- [ ] **4.1** Update `reference-designs/README.md`: drop `.md` from the sibling convention (now `.html` + `.png`); state the worker reads exemplar `.html` as the primary pattern, `.png` as the visual check.
- [ ] **4.2** Update `reel-render-worker.md` "Reference designs" section to instruct reading the exemplar `.html` (not just viewing the PNG).
- [ ] **4.3** Add a TASKS.md follow-up: *fold the approved pie/donut layout into `chartjs-config.js` as a `pie`/`doughnut` branch.*
- [ ] **4.4** If any worker-prompt fragment lives under `packages/shared/src/prompts/`, run `pnpm sync:agents`. (Worker prompts in `corpus/` are read at runtime — no sync needed; confirm which surface changed.)

## Out of scope (tracked, not built here)

- `chartjs-config.js` pie/donut extension (follow-up after a winner is approved).
- A `promote:exemplar` script (manual promotion for now).
- Cleaning up existing `.md` sidecars.
- Static-worker (`test:worker`) fixtures.

## Done when

- The 8 quantitative fixtures exist (+ `data-line` rename), `mixed-reel` is gone.
- The worker persists `<scene>.html` beside every rendered PNG.
- At least the `data-bar` loop is proven end-to-end (render → HTML persists → promote → exemplar in `reference-designs/`).
- README + worker prompt reflect the `.html`+`.png` (no `.md`) convention and read-the-HTML rule.
