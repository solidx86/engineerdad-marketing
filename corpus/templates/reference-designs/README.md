# Reference designs — few-shot exemplars for the render-worker

This folder holds **example outputs** that we want the worker to pattern its design after. Empty initially; populated organically as good designs emerge from real `/produce` runs or from the test harness (`pnpm test:worker <fixture>`).

## When to add a reference

After a render produces a result you'd actually ship to a paying client. The design works visually, the brand contract is honored, the message lands. Drop it here so the worker can learn from it.

## How to add

For each reference design, add a pair of files:

```
reference-designs/
  feed-1x1-celebratory-001.html       ← the HTML the worker authored
  feed-1x1-celebratory-001.png        ← the rendered output (screenshot from data/assets/)
  feed-1x1-celebratory-001.md         ← short note: what's good, what tone it represents
```

Naming convention: `<format>-<aspect>-<tone>-<3-digit-counter>.{html,png,md}` where:
- `<format>`: `feed`, `carousel`, etc.
- `<aspect>`: `1x1`, `4x5`
- `<tone>`: `celebratory`, `authoritative`, `calm`, `alert`, `neutral` (matches the brand contract's tone table)
- `<counter>`: incrementing number per (format, aspect, tone) bucket

## Reel exemplars (9:16)

Vertical Reel exemplars for IG/FB Reels, rendered at **1080×1920** (9:16). They live in their own **`reel/`** subdirectory (retired ones under `reel/retired/`). Each is an `.html` + `.png` sibling pair — the worker reads the `.html` as the primary pattern and views the `.png` as the visual check. (Older concept exemplars still carry a legacy `.md`; new promotions are `.html` + `.png` only.)

**Safe-area constraint (reel-specific).** IG/FB overlay platform UI on the edges, so all meaningful content — text, logo, chart caption + `source_citation`, emphasis callouts — must stay inside the central column:

- **top ~14%** clear (≈269px)
- **bottom ~20%** clear (≈384px)
- **right ~12%** clear (≈130px)

The logo is pulled *up* into the safe zone (flow layout, never the absolute bottom-right corner where the IG action buttons sit).

| Exemplar | Tone / bg | What it demonstrates |
|---|---|---|
| `reel/reel-9x16-visual-comparison-001` | Calm, `--teal-light` | Concept visual, NO chart / NO numbers — two-column "Early Saver vs Late Starter" with a widening qualitative-bar gap as the single focal contrast. |
| `reel/reel-9x16-visual-diagram-002` | Neutral-authoritative, light `--offwhite` | Concept visual, NO chart / NO numbers — big qualitative stat-callout "Time > Timing" + a labelled 3-step diagram; one dominant idea. |
| `reel/reel-9x16-data-bar-001` | Authoritative, `--offwhite` | **Data (chart) visual** — vertical bar, "start early vs late" opportunity-cost spread (~11×); single orange hero bar vs descending navy bars, `callout_en` pill above the plot, `source_citation` row below. No `caption_en` on the frame (the VO carries it). First chart exemplar rendered under current doctrine (no in-canvas legend, no callout over the plot). |
| `reel/reel-9x16-data-line-001` | Authoritative, `--offwhite` | **Data (chart) visual** — two-series line (volatile market price vs your smoother average cost), the DCA averaging-down story; HTML legend uses **line-style swatches** (thin rounded bars whose heights mirror the line weights, not squares) + `callout_en` pill as their own rows above the plot, source below. Hero line carries white-ringed point markers for structure; the volatile comparison line stays marker-less (its vertices are the message). No `caption_en` on the frame (the VO carries it). The reference for line-chart frames. |
| `reel/reel-9x16-data-pie-001` | Authoritative, `--offwhite` | **Data (chart) visual** — hand-authored donut (proportions of a whole); HTML legend block above the canvas (region → swatch → %), in-arc %-labels, `callout_en` framing pill above the legend, source below. No `caption_en` on the frame (the VO carries it). The pattern to follow until `buildChartConfig` grows a pie/doughnut branch. |
| `reel/reel-9x16-data-bar-horizontal-001` | Authoritative, `--offwhite` | **Data (chart) visual** — ranked horizontal bar (`indexAxis:'y'`) for few categories with long labels; single orange alarm bar (worst case) vs navy, value axis ticks thinned (`stepSize`) so they don't crowd. Callout pill above, source below. |
| `reel/reel-9x16-data-bar-stacked-001` | Authoritative, `--offwhite` | **Data (chart) visual** — 100%-stacked bar showing a mix shift over time (equity navy → bond teal → money-market orange across plan years); HTML legend above, no callout (the YAML has none — no badge invented). |
| `reel/reel-9x16-data-bar-grouped-001` | Authoritative, `--offwhite` | **Data (chart) visual** — grouped bars comparing two series across shared categories (load-balanced orange vs MYR-only navy); HTML legend + framing-pill callout. Zero values render as gaps — honest, but keep groups few. |
| `reel/reel-9x16-data-table-001` | Authoritative, `--offwhite` | **Data (table) visual** — pure-HTML comparison table (no Chart.js); the focus row tinted + orange left-rule + a small emphasis pill carries the contrast the layout (not a chart callout) provides. Pattern for "few entities × few metrics". |
| `reel/reel-9x16-data-statgrid-001` | Authoritative, `--offwhite` | **Data (stat-grid) visual** — pure-HTML stat-callout cards (no Chart.js); 2 big navy figures + an orange total band. Pattern for "a handful of punchy numbers, not a relationship". |

The chart exemplar above (`reel-9x16-data-bar-001`, promoted 2026-05-31) is a worked example of the brand-contract chart rules, **not** a substitute for them — the worker still renders chart frames from §5 (HTML legend above the canvas; callout from the chart YAML as a row *outside* the plot rectangle), §8 (density), and the §9 rubric.

| Retired (do NOT imitate — in `reel/retired/`) | Why retired |
|---|---|
| `reel-9x16-chart-line-emphasis-001` | Callout pill floats over the lines; built-in circle legend stacked tight inside the canvas. |
| `reel-9x16-chart-bar-emphasis-002` | Callout pill floats on top of the bar; pre-doctrine emphasis layout. |

## Static 4:5 exemplars (Feed)

Static feed exemplars, rendered at **1080×1350** (4:5). They live in their own **`static/`** subdirectory. Each is an `.html` + `.png` sibling pair — the worker reads the `.html` as the primary pattern and views the `.png` as the visual check.

**Named by visual primitive, not by post type.** Both Feed (one image) and Carousel (a set of cards) go through the same static render-worker, so the exemplars carry no `feed`/`carousel` in the name — just `static-<aspect>-<primitive>-<counter>`. This pass covers `4x5` only; `1x1` (the Carousel-FB layout) will follow.

**Difference from reels:** a feed post has **no voiceover**, so the static worker **renders `caption_en`** (~28px) below the visual — there the caption *is* the explanation. The `source_citation` (≥23px) follows it. There is **no safe-area constraint** (unlike reels); the logo sits absolute bottom-right.

**Source line is external-only** (proven on the data-table/pie/statgrid promotions, 2026-05-31): the worker strips internal references (`corpus/**` paths, course/module names, `.md` filenames, internal tool URLs) and renders only the third-party authority + disclaimer. See `worker-prompts/_chart-rules.md` and `render-worker.md` §3.

| Exemplar | What it demonstrates |
|---|---|
| `static/static-4x5-hero-number-001` | **No chart** — single dominant hero figure (Feed-specific primitive); 190px Playfair figure + pre-line, caption + source below. The "one big number" layout. |
| `static/static-4x5-data-bar-001` | **Data (chart)** — vertical bar, start-age penalty (~11× spread); single orange hero bar vs descending navy, `callout_en` outside the plot, caption + source below. |
| `static/static-4x5-data-bar-horizontal-001` | **Data (chart)** — ranked horizontal bar (`indexAxis:'y'`) for long labels; fee-drag spread, value ticks thinned (`stepSize`). |
| `static/static-4x5-data-bar-stacked-001` | **Data (chart)** — 100%-stacked glide path (equity navy → bond teal → money-market orange); HTML legend, no callout (none invented). |
| `static/static-4x5-data-bar-grouped-001` | **Data (chart)** — grouped bars, load-balanced vs MYR-only; HTML legend + framing callout. |
| `static/static-4x5-data-line-001` | **Data (chart)** — two-series line (volatile price vs smoother average cost); **line-style swatch** legend + white-ringed hero point-markers; the line-chart reference. |
| `static/static-4x5-data-pie-001` | **Data (chart)** — hand-authored doughnut (proportion of a whole); HTML legend with %, in-arc %-labels, callout outside the plot. Source rendered disclaimer-only (internal refs stripped). |
| `static/static-4x5-data-table-001` | **Data (table)** — pure-HTML comparison table; focus row tinted + orange left-rule + emphasis pill. Source kept the external authority (KWSP Belanjawanku), internal path + tool URL stripped. |
| `static/static-4x5-data-statgrid-001` | **Data (stat-grid)** — pure-HTML stat cards (figure-left / description-right) + navy-dark total band with the orange payoff figure. |
| `static/static-4x5-concept-visual-001` | **Concept** — NO numbers, freeform SVG metaphor (the "Snowball" compounding hill: growing navy circles → orange payoff). Carries a caption row (static-specific). |

## How the worker uses these

The worker prompt (`corpus/templates/worker-prompts/render-worker.md`) has a "Reference designs" section. After populating this folder, edit that section to point at the most representative 2–3 references. The worker reads them inline and patterns its output after the typography hierarchy, spacing rhythm, and color emphasis it sees.

**Don't reference more than 3** — beyond that, the prompt becomes an exemplar swamp and the worker copies too literally instead of generalizing.

## Pruning

When a better reference of the same (format, aspect, tone) bucket lands, archive the older one — don't keep both as exemplars (worker gets confused by competing patterns):

```bash
mkdir -p reference-designs/archive
mv reference-designs/feed-1x1-celebratory-001.* reference-designs/archive/
```

The archive is preserved for git history but no longer referenced from the worker prompt.
