# EngineerDad — Brand Visual Contract

Source of truth for the visual identity of every static asset produced by the marketing OS. Extracted verbatim from `engineerdad-site/styles.css` + `engineerdad-site/index.html` on 2026-05-11.

This file is read by the produce stage and passed inline to every render-worker job. **Never violate the rules in this file — they are the brand.**

---

## 1. Color tokens (CSS custom properties)

Use these exactly. Never invent new colors. Never use colors outside this palette.

```css
:root {
  --navy:        #1B2B6B;   /* primary; "Engineer" wordmark; headings */
  --navy-dark:   #111c45;   /* hover / dark backgrounds */
  --orange:      #F07621;   /* secondary accent; "Dad" wordmark; CTAs */
  --teal:        #00B4A6;   /* tertiary; data viz accent */
  --teal-light:  #e6f8f7;   /* calm backgrounds */
  --offwhite:    #F7F8FC;   /* default page background */
  --warm-white:  #FEFEFE;   /* card surfaces */
  --text:        #1a1a2e;   /* body copy */
  --muted:       #6b7280;   /* secondary text */
  --border:      #e5e7f0;   /* dividers */
}
```

## 2. Fonts (Google Fonts)

Always preload + load via these `<link>` tags in `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;900&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
```

Then declare:

```css
:root {
  --font-head: 'Playfair Display', Georgia, serif;   /* headlines, titles, hero numbers */
  --font-body: 'Inter', system-ui, sans-serif;       /* body copy, captions, labels */
}
```

**Lining figures, always (mandatory).** Playfair Display renders *oldstyle* (text) figures by default — digits with ascenders/descenders, so "40" reads like "4o" and "30" like "3o". For a numbers-first brand that is a legibility failure. Force lining (cap-height, uniform-baseline) figures everywhere numerals appear — headlines, hero numbers, callouts, captions:

```css
* { font-variant-numeric: lining-nums tabular-nums; }
```

Apply on a wildcard (or on every text element you author). Verify in the render: a digit "0" must read as a full cap-height "0", never a lowercase-style "o". (Chart.js axis ticks render on `<canvas>` and are unaffected by CSS — they are already lining.)

## 3. Logo (always present, fixed corner)

**HTML** — drop this exact block into every static asset:

```html
<div class="logo-mark">
  <div class="logo-text">
    <span class="engineer">Engineer</span><span class="dad">Dad</span>
  </div>
</div>
```

**CSS** — bottom-right, 24px margin from each edge:

```css
.logo-mark {
  position: absolute;
  bottom: 24px;
  right: 24px;
  z-index: 100;
  pointer-events: none;
}
.logo-text {
  font-family: var(--font-head);
  font-size: clamp(20px, 2vw, 28px);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.5px;
}
.logo-text .engineer { color: var(--navy); }
.logo-text .dad      { color: var(--orange); }
```

**Hard rule**: Logo MUST appear on every rendered Variant. Never omit. Never recolor. Never reposition outside the bottom-right corner.

For dark-background variants (e.g., `--navy-dark` background): change `.logo-text .engineer { color: white; }` only — keep `.dad` as `--orange`. This is the only allowed variant.

## 4. Output contract for worker HTML

Every worker-produced HTML document must:

1. Be a **single self-contained file** — inline `<style>`, optional inline `<script>`, no external CSS/JS files (Google Fonts CDN is the only external dep).
2. Set `<body>` to exact viewport pixel dimensions (passed in spawn prompt):
   ```css
   body {
     width: ${WIDTH}px;
     height: ${HEIGHT}px;
     margin: 0;
     overflow: hidden;
     position: relative;            /* logo-mark absolute-positions against body */
     font-family: var(--font-body);
     color: var(--text);
     background: var(--offwhite);   /* default; override per tone */
   }
   ```
3. Include the brand `<link>` tags in `<head>` (section 2 above).
4. Include the logo block (section 3 above) inside `<body>`.
5. Use ONLY palette colors from section 1. Never `#000000`, never `#ffffff` (use `--text` and `--warm-white`).
6. **Respect the minimum type sizes (§4a below).** These renders are viewed in phone feeds — the 1080px canvas is downscaled ~2.7×. Anything under ~24px on-canvas is illegible on a phone.

### 4a. Minimum type sizes (mobile legibility)

A 1080-wide canvas shown in an Instagram/Facebook feed renders at roughly 400px — a 2.7× shrink. Pick on-canvas sizes so the *shrunk* result is still readable:

| Element | Min on-canvas size | Shrinks to ~ |
|---|---|---|
| Headline / hero number | ≥ 72px (usually 100–180px) | ≥ 27px |
| Subhead / kicker line | ≥ 40px | ≥ 15px |
| Body copy | ≥ 36px | ≥ 13px |
| Chart legend / axis ticks / axis titles | ≥ 28px (see §5 — Chart.js defaults to 12px and must be overridden) | ≥ 10px |
| Legal disclaimer line (PHS / prospectus) | ≥ 24px — the **only** text allowed below 28px | ≥ 9px |

**Squint test** (do this in §5.5 QA): shrink the render to ~37% in your mind's eye — every line that carries meaning must still be readable. The legal line may be borderline; nothing else may be.

Contrast also matters at this scale: never grey-on-navy (`--muted` on `--navy`/`--navy-dark`). On dark backgrounds use `white` or `--offwhite` for body/labels/chart text; reserve `--muted` for light backgrounds only.

### 4b. Vertical clearance between stacked blocks (anti-overlap)

The single most common QA failure on carousel cards is **subhead-overlapping-headline descenders** — the model picks a `top: <N>px` for the subhead based on where the headline visually ends, not where its descenders + line-height actually sit. Re-rendering fixes it, but each retry burns ~10–15k tokens and the issue keeps recurring.

Bake this into first-pass layout, not into QA retries:

| Stack | Minimum vertical gap |
|---|---|
| Headline → subhead | ≥ `line-height × 0.45` of the headline (i.e. ≥ 48px when headline is ~108px @ 1.1 line-height) |
| Headline → any chart, table, or hero number | ≥ 64px |
| Subhead → body / pull-quote | ≥ 32px |
| Body / chart → footnote-or-citation row | ≥ 40px |
| Footnote / citation → logo (bottom-right block) | ≥ 32px clear vertical space |

**How to compute the subhead `top` for an absolutely-positioned layout** (the most common carousel template):
```
subhead.top  ≥  headline.top + (headline.lines × headline.fontSize × headline.lineHeight) + 48px
```
A 108px headline at line-height 1.1 wrapping to 2 lines lands its descender at `top + 238px` — put the subhead at `top + 300px` or use `position: static` + `margin-top: 48px` so the browser computes it. **`position: absolute` + hand-picked `top` is the trap; prefer flow layout (`flex-column` with `gap`) wherever possible.**

If you find yourself iterating subhead `top` across QA retries, switch the card to flex-column-with-gap on the next retry instead of guessing another offset.

## 5. Tone → palette emphasis mapping

The Variant's `thumbnailBrief` (authored by media-production in Step 4b) is the source of tone. Worker reads thumbnailBrief, picks the closest tone below, applies the corresponding palette emphasis.

| Message tone | Background | Primary text/headline | Accent | Notes |
|---|---|---|---|---|
| **Celebratory / growth / milestone** | `--offwhite` or `--warm-white` | `--navy` | `--orange` (large, bold) | Orange-dominant; use for "you can retire by 55" / "RM450K terminal value" energy |
| **Authoritative / data-driven / proof** | `--offwhite` | `--navy-dark` | `--orange` (single accent only — one element) | Navy-dominant; serious; chart axes in `--muted`; headline in `--navy-dark`; one CTA word in `--orange` |
| **Calm reassurance / education** | `--teal-light` | `--navy` | `--teal` | Soft; uses teal-light as 60–80% of the surface; body copy in `--text` |
| **Alert / warning / loss-prevention** | `--navy-dark` | `white` (logo `.engineer` becomes white) | `--orange` (urgent emphasis) | High-contrast; muted backgrounds avoided; "are you losing money to inflation?" energy |
| **Neutral / explanatory** | `--offwhite` | `--text` | `--navy` (subtle) | Default fallback when thumbnailBrief doesn't clearly signal tone; body copy dominant |

### Chart series colors (per tone)

Chart YAMLs in `corpus/data/charts/` deliberately do NOT specify colors. Worker picks per tone:

- **Celebratory / growth**: hero series (e.g., 8% line) in `--orange`; secondary series (4%) in `--navy`; "do-nothing" baseline (0%) in `--muted`. Chart fills (area under line) at low opacity.
- **Authoritative / data-driven**: all series in the `--navy` family — vary by saturation, not hue. One series gets `--orange` if it carries the headline argument. No fills.
- **Calm reassurance**: `--teal` for the positive series; `--navy` for the comparison; `--muted` for the negative case.
- **Alert / warning**: `--orange` for the alarming line (e.g., inflation drag); `--navy-dark` for the baseline; white axes/labels.
- **Neutral**: `--navy` primary; `--teal` secondary; `--muted` for the third.

### Chart text sizing (mandatory Chart.js overrides)

Chart.js renders everything at 12px by default — illegible after the mobile downscale (§4a). Every chart config MUST set explicit font sizes and colors:

```js
const tickColor  = /* dark bg → 'white' or '--offwhite'; light bg → '--muted' */;
const labelColor = /* dark bg → 'white'; light bg → '--text' */;

options: {
  responsive: false,                    // fixed-size canvas, no reflow
  animation: false,                     // Playwright captures one frame
  plugins: {
    legend: { display: false },   // built-in legend OFF — we render an HTML legend (see "Legend placement" below)
  },
  scales: {
    x: {
      ticks: { font: { family: "'Inter', sans-serif", size: 28 }, color: tickColor },
      title: { display: true, text: '<x_label from YAML>', font: { family: "'Inter', sans-serif", size: 28, weight: '500' }, color: tickColor, padding: { top: 14 } },
      grid:  { color: '<--border on light; rgba(255,255,255,0.12) on dark>' }
    },
    y: {
      ticks: { font: { family: "'Inter', sans-serif", size: 28 }, color: tickColor },
      title: { display: true, text: '<y_label from YAML>', font: { family: "'Inter', sans-serif", size: 28, weight: '500' }, color: tickColor },
      grid:  { color: '<--border on light; rgba(255,255,255,0.12) on dark>' }
    }
  }
}
```

Datasets: `borderWidth: 4` on line series, `pointRadius: 6`, `pointHoverRadius: 6`, `tension: 0.3` for smooth curves — so the lines stay distinguishable at thumbnail scale. For bar series, `borderRadius: 6` and a clear fill.

Color the tick/title text per §4a contrast rule — **`--muted` only on light backgrounds**. On `--navy-dark` use `white`.

### Chart layout spacing (anti-overlap)

Chart.js's default x-axis title placement bleeds into whatever sits immediately below the canvas. If the layout has a caption / source-citation / body text beneath the chart, you MUST insert vertical separation. Use either:

**Option A — container padding** (simplest):

```css
.chart-wrapper { margin-bottom: 56px; }   /* min 48px; 56–64px is safer */
```

**Option B — Chart.js layout options** (combine with A for stubborn cases):

```js
options: {
  layout: { padding: { bottom: 16 } },
  scales: {
    x: { title: { display: true, text: 'Years', padding: { top: 16 } } }
  }
}
```

**Worst case (what to avoid)**: chart canvas ends at y=820px, x-axis title "Years" renders at y=830px, caption text begins at y=835px → "Years" sits on top of the caption. Always leave ≥40px of clear space between the bottom of the chart canvas and the top of the next text block.

### Legend placement (mandatory) — HTML legend, NOT Chart.js's built-in

**Disable Chart.js's built-in legend (`plugins.legend.display = false`) and render the legend as a plain HTML block above the canvas.** The built-in legend floats *inside* the canvas, drifts over the gridlines/y-ticks, and its swatch crashes into the label text — it is not reliably placeable. An HTML block sits in the page flow, so it **structurally cannot** overlap the plot, and you control the swatch↔label gap exactly.

- Build the items with `legendItems(chartYaml, tokens, { lang })` from `chartjs-config.js` (returns `{ label, color, dashed }` per series, preferring the YAML's short `legend_label_{lang}`).
- **Use the SHORT labels** (e.g. "8% equity", "4% FD", "0% savings"). The full series name + assumptions live in the `caption_en`, never in the legend — that bulk is what made the legend collide with everything.
- Lay it out as a flex row of pills directly **above** the `<canvas>` (markup + the exact `gap` values are in `chartjs-config.js` §2b). The swatch is a short line rule (`border-top:4px solid <color>`, dashed for the floor series) for line charts, or a filled square for bars. **Never let the swatch touch its label** — that's what the flex `gap` is for (≥12px).
- Verify in the render: the legend block is entirely **above** the plotting rectangle; draw an imaginary box around the plotted lines/bars + axes — **no legend swatch or label may fall inside it**, and no swatch overlaps its own label text.

### Floating callouts / annotation badges (mandatory)

**Callout TEXT comes from the chart YAML, never invented.** If the chart YAML has a `callout_en` / `callout_ms` field, render it **verbatim** for the frame language. Do NOT write, compute, or paraphrase your own callout — the worker has repeatedly invented wrong figures (e.g. "~3× / 8% vs 0%" when the vetted comparison is "8% vs 4%, ~2×"). The comparison the callout makes is a vetted editorial choice baked into the YAML (hero-vs-comparison series), not a number you derive at render time. If the YAML has **no** `callout` field, render **no** badge — a missing callout is not a license to make one up.

**Placement — the badge ALWAYS renders OUTSIDE the plotting rectangle.** Do NOT float it into a plot quadrant — that choice is removed. Floating a box over the plot is the recurring failure: it lands on the y-axis tick labels or the rising curve, and the self-QA keeps mis-judging it as clear. A badge in the page flow, outside the plot, structurally cannot overlap anything and leaves nothing to misjudge.

- Render the badge as its **own HTML block**, either directly **above the legend** or directly **under the chart caption** — a discrete row in the layout, never absolutely-positioned over the `<canvas>`.
- One badge per frame, ceiling. It must not touch the legend, the caption, or another element — give it the same margin discipline as any other text block (§4b).
- It is fine (and good) for the badge to span the column width as a slim banner; it is NOT fine for it to sit on top of the chart's plotting area, axis ticks, axis titles, or data lines.

Before finalizing, `Read` the render and confirm the badge is a separate row outside the chart box — if any part of it overlaps the canvas/axis/curve, it's in the wrong place.

## 6. Hard "do nots"

- ❌ No lorem ipsum, no placeholder text — always Variant's real content
- ❌ No `<img>` for charts — always inline Chart.js (Chart.js 4.x via CDN: `https://cdn.jsdelivr.net/npm/chart.js`)
- ❌ Never omit the logo block
- ❌ Never use colors outside the section 1 palette
- ❌ Never use `font-family` other than `var(--font-head)` or `var(--font-body)` (no system-ui fallback as primary, no Arial, no generic "sans-serif")
- ❌ Never set `<body>` to anything other than the exact W×H passed in the spawn prompt
- ❌ Never use `100vh` / `100dvh` viewport units in the worker's HTML (fights pixel-perfect renders)
- ❌ Never spawn animations — Playwright captures one frame; animation is wasted work and risks capture-mid-frame
- ❌ **Never hand-draw figurative/illustrative SVG** — no piggy banks, animals, mascots, people, drawn "growth arrows", or any pictorial object. Inline SVG you author always renders amateur (lumpy blobs, stray strokes, broken arrowheads). Concept visuals are **typographic + geometric only** (see §8): large type, palette-colour rules/dividers, plain rectangles/bars, and at most a single clean directional cue built from a CSS border-triangle or a Unicode arrow glyph (→ ↗) set in `var(--font-body)`. Charts are the ONLY non-text graphic, and they come from Chart.js (§5), never freehand SVG.

## 7. Wait-for-charts signal

When the HTML embeds Chart.js, the worker MUST add this script tag at the end of `<body>`:

```html
<script>
  window.__chartsReady = false;
  // After Chart.js renders, set the flag. Use animation.onComplete OR a setTimeout
  // fallback for safety.
  document.addEventListener('DOMContentLoaded', () => {
    // ... after new Chart(...) construction ...
    setTimeout(() => { window.__chartsReady = true; }, 500);
  });
</script>
```

The static-renderer MCP will be passed `wait_for_charts: true` when `chartRef` is set on the scene, and waits for this flag before screenshotting.

## 8. Text density by format

**Principle:** match on-frame words to whether a voiceover exists. Reels are narrated → the frame is a visual aid with a *concise* support line, not a paragraph. Feed/Carousel are silent → the frame must fully self-explain, so they carry a short body block. **Over budget → trim words, never shrink type below §4a.** Counts are whitespace-split tokens, per language (EN and BM frames each independently in budget).

| Surface | Mandatory on frame | Discretionary text budget | Notes |
|---|---|---|---|
| **Reel `face`** | logo | none (avatar fills frame) | copy lives in HeyGen captions |
| **Reel `visual` — data** (chartRef set) | the chart/table/graph, YAML `caption_en`, full `source_citation`, logo | headline ≤ 6 words + 1 support line ≤ 12 words | **numbers OK** (vetted); single-stat callout lives here; support line = the scene's `explains` |
| **Reel `visual` — concept** (visualBrief set) | logo | headline ≤ 6 words + 1 support line ≤ 12 words + ≤ 2 labels ≤ 3 words each | **no numbers** (compliance boundary); **typographic + geometric only — NO figurative illustration** (§6); support line = `explains`; labels qualitative |
| **Feed** | logo (+ chart caption/citation if charted) | headline + body block: 2–3 lines, ~30–45 words total | self-explains, no VO; body = condensed `body` field |
| **Carousel card** | kicker, `N / total` indicator, logo | 2-line headline + body block: 2–3 lines, ~30–45 words | card 1 (hook hero) may be headline-only; cards 2..N carry the body |

- "Headline" = the hook / `onScreenText` in `var(--font-head)` at the §4a floor.
- Reel mandatory chart caption + `source_citation` are NEVER counted against the headline/support budget and NEVER truncated.
- The reel support line is the lever against wordiness: one line, ≤12 words — if it grows into a paragraph, it belongs in the voiceover.
- Feed/Carousel body is deliberately richer (no VO) but still concise + self-explanatory — ~45 words is the ceiling, and it must pass the §4a squint + §4b no-overlap checks.

## 9. Self-critique rubric (every render worker runs this)

After rendering a PNG, `Read` it and write a one-line, evidence-cited observation for EACH item below. A "looks good" with no evidence is not acceptable. Any fail → fix and re-render within the retry budget.

1. **No overlap** — no text-on-text, text-on-chart, or headline-descender collisions. For charted frames, explicitly inspect the three collisions the worker keeps rationalizing as fine: (a) **callout/badge over the legend** (does the badge clip a legend row, e.g. "0% (no investm…"?), (b) **legend inside the plot / over axis ticks** (per §5 the legend must be outside the plotting rectangle), (c) **badge over the data lines/axis labels**. Cite the §4b vertical-clearance gaps you relied on, and name where the badge and legend sit relative to the plot box.
2. **No edge clip** — quote the bottom-most line in full; if it ends mid-sentence it is clipped. Reels additionally respect the safe-area: top ~14% / bottom ~20% / right ~12% clear of the Reels UI.
3. **Density within §8 for this surface** — count the on-frame words for this format; if over budget, trim words (never shrink type below §4a).
4. **Legibility** — meets the §4a minimum sizes at the ~37% squint test. **Numerals are lining figures** (§2): confirm a "0" reads as a cap-height "0", not a lowercase "o" — check the headline and any hero number specifically.
5. **Hierarchy / contrast** — one clear focal point; palette-correct contrast (no grey-on-navy, etc.).
6. **No figurative illustration** (concept visuals) — confirm there is NO hand-drawn pictorial SVG (piggy/animal/mascot/person/drawn arrow). The frame must be type + geometric primitives only (§6). A lumpy blob or a broken arrowhead is an automatic fail → rebuild as typographic.
   - **No digits on a concept visual.** A concept visual (`visualBrief` set, no `chartRef`) must carry no statistic — any number belongs on a data visual bound to a chart. This is now enforced structurally upstream: the P1 verifier (`verify-produce`) rejects a concept visual containing a digit (ADR-030, folds in B-036), so a leaked figure fails the produce gate, not just this rubric.
7. **Callout integrity** (data visuals) — if a badge is present, its text matches the chart YAML `callout_en/ms` verbatim, and its box intersects no data line, legend, or axis label (§5). If you invented the number or it overlaps the curve, fail → fix.
8. **No vertical dead-zone** — no card/column/panel is left >60% empty while content crowds elsewhere; balance the fill or shrink the container.

**Retry budget:** HARD CAP of 1 retry per scene/frame. A second failure is the signal — record it honestly in `qa_notes`/`warnings` and move on; the conductor decides whether to re-spawn. Do not author a third render.
