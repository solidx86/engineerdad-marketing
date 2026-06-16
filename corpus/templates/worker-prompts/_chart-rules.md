# Shared chart-rules partial

> **What this is.** Format-agnostic chart/visual doctrine shared by both render workers
> (`render-worker.md` for static Feed/Carousel, `reel-render-worker.md` for 9:16 Reels).
> Read this whenever a scene has a `chartRef`. The binding visual source of truth is still
> the brand contract §5 (palette, fonts, Chart.js sizing) — this file is the legend/marker/
> callout doctrine both workers kept duplicating, lifted to one place so it stops drifting.
>
> **Format-specific things live in the calling prompt, NOT here:** whether `caption_en` is
> rendered on the frame (static: yes, below the chart / reel: no — the VO carries it), the
> aspect &amp; scene model, carousel multi-card furniture, and the reel safe-area constraint.

---

## When you have a data visual (`chartRef` non-null)

1. `Read corpus/data/charts/<chartRef>.yaml`. Note `chart_type`, `labels`, `series` (each with
   `semantic_role`), `caption_en`/`caption_ms`, `source_citation`, and `callout_en` (if present).
   **Numbers come verbatim from the YAML — never invented or recomputed.**
   **`source_citation` is external-only.** The on-frame source line attributes a third-party
   authority (KWSP/EPF, Bank Negara, DOSM, the Securities Commission, a named public report)
   plus any disclaimer — **never** our own internal references (`corpus/**` paths, course/module
   names, `.md` filenames, internal tool URLs). If the YAML's `source_citation` names an internal
   source, render the external authority it derives from, or the disclaimer alone — never the
   internal path.

2. **Pick the presentation:**
   - **Chart** (Chart.js: line / bar; or pie/donut for proportion data that sums to a whole) —
     the default for trends and magnitude comparisons.
   - **Comparison table** (pure HTML) — few entities × few metrics; the layout carries the contrast.
   - **Stat-callout grid** (pure HTML) — 2–4 headline numbers in large type, one per cell; use when
     the point is a handful of punchy figures, not a relationship.
   If unsure, a clean chart is the safe default.

## Chart rules (Chart.js presentations)

- Build the config with `buildChartConfig(yaml, tokens, { lang })` from
  `corpus/templates/partials/chartjs-config.js`; embed Chart.js 4.x via CDN; emit the
  `window.__chartsReady` signal. Colors come from the picked palette emphasis (§5), not the YAML.
- **`chart_type` dispatches the layout** — `line | bar | bar_horizontal | bar_stacked | pie | doughnut`.
  `buildChartConfig` handles **all six** (horizontal = `indexAxis:'y'`; stacked sets both axes
  `stacked:true`; pie/doughnut emit a sliced dataset, no scales). `hero|comparison|floor` color the
  argument charts (line/bar/horizontal); **pie & stacked segments are peers → colored by
  `tokens.category` index**, not by role.
- **The built-in legend is OFF** (`buildChartConfig` sets `legend.display=false`). Render the legend
  as an **HTML block above the canvas** using `legendItems(yaml, tokens, {lang})` + the short
  `legend_label_en` values. **Never the in-canvas legend.**
- **Line charts:** the HTML legend uses **line-style swatches** — thin rounded bars whose heights
  mirror the line weights (hero ~6px, comparison ~4px), **not** squares (squares read as bars/areas).
  Give the **hero line white-ringed point markers** (`pointRadius:4`, `pointBorderColor` the bg,
  `pointBorderWidth:2`) for structure; keep a volatile comparison line **marker-less** (`pointRadius:0`)
  — its vertices are already the message and markers there just clutter.
- **Pie/doughnut:** `buildChartConfig` builds the sliced dataset (slice colors from `tokens.category`,
  `legend.display=false`); register `inArcLabelsPlugin(tokens)` for the in-arc %-labels and render an
  HTML legend block (`legendItems` carries each slice's `pct`, e.g. "Asia ex-MYR  35%").
- **Legend swatch shape:** line charts → line-rule swatch (above); bar / horizontal / stacked → filled
  square (24×24, `border-radius:6px`); pie/doughnut → filled square + the `pct` on the right.

## Callout / badge (brand-contract §5)

- Render a spotlight badge **only if** the YAML has `callout_en` — and render that text **verbatim**
  (never invent or compute your own; e.g. don't write "8% vs 0%" when the vetted comparison is
  "8% vs 4%"). `callout_en` may be a vetted figure **or** a crisp framing line (e.g.
  "100% home = one point of failure") — render whichever the YAML carries, as-is.
- **The badge is its own HTML row OUTSIDE the plot** (above the legend, or under the source) —
  **never floated over the canvas / axis / curve.** No `callout_en` → no badge.

## Tables &amp; stat-grids (pure HTML)

Author the HTML directly — no Chart.js, no `__chartsReady` (`wait_for_charts:false`). The chart rules
above (HTML legend, callout-outside-plot) do **not** apply; lean on §4a sizing + §8 density and let the
layout itself carry the contrast (e.g. a tinted focus row + orange left-rule for a table; a navy/orange
total band for a stat-grid).
