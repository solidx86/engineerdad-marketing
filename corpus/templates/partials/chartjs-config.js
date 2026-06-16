// chartjs-config.js — paste-ready Chart.js 4.x config builder for render-workers.
//
// Why this exists: every chart-bearing Variant needs the same scaffolding — font sizes
// that survive the ~2.7x mobile downscale (brand contract §4a), tone-driven series colors
// (§5), thick lines so series stay distinct at thumbnail scale, and the __chartsReady
// signal Playwright waits on (§7). Without a shared helper, each worker re-derives it and
// occasionally forgets a piece (the classic miss: leaving Chart.js's default 12px ticks).
// Copy this file's body into your <script>, call buildChartConfig(...), done.
//
// It does NOT pick colors for you beyond mapping semantic_role → a palette slot (or, for
// pie/stacked, cycling a category palette). The slot values come from the brand contract
// §1 tokens; pass them in `tokens`.
//
// chart_type vocabulary (set in corpus/data/charts/<ref>.yaml):
//   line | bar | bar_horizontal | bar_stacked | pie | doughnut
// `bar`/`line` are the originals; the rest are explicit so the helper can dispatch on them
// (the old convention of signalling "horizontal" in a YAML comment is not machine-readable).

// --- 1. The palette: pass the brand-contract §1 hex values for the tone you picked. ---
//
// Example for "authoritative / data-driven" on a light (--offwhite) background:
//   const tokens = {
//     hero:       '#F07621',  // --orange  — the series carrying the headline argument
//     comparison: '#1B2B6B',  // --navy    — the baseline
//     floor:      '#6b7280',  // --muted   — the do-nothing line
//     tick:       '#6b7280',  // --muted   — axis ticks + titles (light bg only!)
//     grid:       '#e5e7f0',  // --border
//     bg:         '#F7F8FC',  // --offwhite — slice border on pie/doughnut (the gap color)
//     category:   ['#1B2B6B','#00B4A6','#F07621','#111c45','#6b7280'], // pie/stacked cycle
//   };
// On a dark (--navy-dark) background, set tick: '#FEFEFE' (white) and grid:
// 'rgba(255,255,255,0.12)' — never --muted grey on navy (brand contract §4a contrast rule).
//
// `hero | comparison | floor` color a chart whose series carry an ARGUMENT (one series is
// the point, the rest are context) — line, bar, bar_horizontal. `category` colors a chart
// whose segments are PEERS with no hero (pie/doughnut slices, bar_stacked segments); they
// are cycled by index. If `tokens.category` is omitted, CATEGORY_FALLBACK is used.

const CATEGORY_FALLBACK = ['#1B2B6B', '#00B4A6', '#F07621', '#111c45', '#6b7280'];

function colorFor(semanticRole, tokens) {
  switch (semanticRole) {
    case 'hero':       return tokens.hero;
    case 'comparison': return tokens.comparison;
    case 'floor':      return tokens.floor;
    default:           return tokens.comparison; // safe fallback — navy family
  }
}

function categoryColor(i, tokens) {
  const pal = (tokens && tokens.category) || CATEGORY_FALLBACK;
  return pal[i % pal.length];
}

// --- 2. Build the full config from a parsed chart YAML + your palette + bg flag. ---
//
//   chartYaml   — the object you got from Reading corpus/data/charts/<chartRef>.yaml
//   tokens      — the palette object above
//   { lang }    — 'en' (default) or 'ms'; picks name_en/name_ms, x_label_*, y_label_*
//
// Returns a Chart.js config object. Pass it straight to `new Chart(ctx, config)`.
// For pie/doughnut you must ALSO register the in-arc % labels (see inArcLabelsPlugin below):
//   new Chart(ctx, { ...buildChartConfig(yaml, tokens), plugins: [inArcLabelsPlugin(tokens)] });

function buildChartConfig(chartYaml, tokens, { lang = 'en' } = {}) {
  const L = (base) => chartYaml[`${base}_${lang}`] ?? chartYaml[`${base}_en`];
  const TYPE = chartYaml.chart_type;
  const isLine = TYPE === 'line';
  const isPie = TYPE === 'pie' || TYPE === 'doughnut';
  const isHorizontal = TYPE === 'bar_horizontal';
  const isStacked = TYPE === 'bar_stacked';
  // pie/doughnut slices and stacked segments are peers → color by index, not by role.
  const useCategory = isPie || isStacked;

  // --- pie / doughnut: one dataset, one color per slice ---
  if (isPie) {
    const values = chartYaml.series[0].values;
    return {
      type: TYPE, // 'pie' | 'doughnut'
      data: {
        labels: chartYaml.labels,
        datasets: [{
          data: values,
          backgroundColor: values.map((_, i) => categoryColor(i, tokens)),
          borderColor: (tokens && tokens.bg) || '#F7F8FC',
          borderWidth: 4,
        }],
      },
      options: {
        responsive: false,
        animation: false,
        maintainAspectRatio: false,
        cutout: TYPE === 'doughnut' ? '52%' : 0,
        layout: { padding: 6 },
        plugins: {
          legend: { display: false },   // HTML legend block instead (see legendItems)
          tooltip: { enabled: false },
        },
      },
    };
  }

  // --- line / bar / bar_horizontal / bar_stacked ---
  const datasets = chartYaml.series.map((s, i) => {
    const color = useCategory ? categoryColor(i, tokens) : colorFor(s.semantic_role, tokens);
    const isFloor = s.semantic_role === 'floor';
    return {
      label: s[`name_${lang}`] ?? s.name_en,
      data: s.values,
      borderColor: color,
      backgroundColor: color,
      ...(isLine
        ? {
            borderWidth: 4,
            pointRadius: 6,
            pointHoverRadius: 6,
            tension: 0.3,
            borderDash: isFloor ? [8, 6] : [],   // dashed = the do-nothing line
            fill: false,
          }
        : {
            borderRadius: isStacked ? 0 : 6,     // stacked segments butt together — no radius
            borderWidth: 0,
          }),
    };
  });

  return {
    type: isLine ? 'line' : 'bar',          // pie/doughnut returned early; here it's line or a bar family
    data: { labels: chartYaml.labels, datasets },
    options: {
      responsive: false,                     // fixed-size canvas — no reflow
      animation: false,                      // Playwright captures one frame
      maintainAspectRatio: false,
      indexAxis: isHorizontal ? 'y' : 'x',   // horizontal bar = category on the y-axis
      layout: { padding: { top: 8, bottom: 16, left: 8, right: 16 } },
      plugins: {
        // Chart.js's built-in legend floats INSIDE the canvas and resists precise
        // placement — it kept landing over the gridlines/y-ticks and crashing its
        // swatch into the label text. We render the legend as a separate HTML block
        // instead (see `legendItems()` below + brand-contract §5), which structurally
        // cannot overlap the plot. So: built-in legend OFF.
        legend: { display: false },
        tooltip: { enabled: false },          // static render — no hover
      },
      scales: {
        x: {
          stacked: isStacked,
          title: {
            display: true,
            text: L('x_label'),
            font: { family: "'Inter', sans-serif", size: 28, weight: '500' },
            color: tokens.tick,
            padding: { top: 14 },
          },
          ticks: { font: { family: "'Inter', sans-serif", size: 28 }, color: tokens.tick },
          grid: { color: tokens.grid },
          beginAtZero: true,                  // value axis when horizontal; harmless on category
        },
        y: {
          stacked: isStacked,
          title: {
            display: true,
            text: L('y_label'),
            font: { family: "'Inter', sans-serif", size: 28, weight: '500' },
            color: tokens.tick,
          },
          ticks: { font: { family: "'Inter', sans-serif", size: 28 }, color: tokens.tick },
          grid: { color: tokens.grid },
          beginAtZero: true,
        },
      },
    },
  };
}

// --- 2b. HTML legend (brand contract §5). The built-in legend is disabled; build
//         the legend as an HTML block ABOVE the canvas so it can never overlap the
//         plot. `legendItems` returns one entry per series (or per slice, for pie):
//
//   - line / bar / bar_horizontal: colored by semantic_role; `dashed` true for the floor.
//   - bar_stacked: segments are peers → colored by category index.
//   - pie / doughnut: ONE entry per slice (label = chartYaml.labels[i]); carries `pct`
//     (rounded share of the total) so the legend can show "Region — 35%".
//
//   It prefers `legend_label_{lang}` from the YAML, falls back to `name_{lang}`.

function legendItems(chartYaml, tokens, { lang = 'en' } = {}) {
  const TYPE = chartYaml.chart_type;

  if (TYPE === 'pie' || TYPE === 'doughnut') {
    const values = chartYaml.series[0].values;
    const total = values.reduce((a, b) => a + b, 0) || 1;
    return chartYaml.labels.map((label, i) => ({
      label,
      color: categoryColor(i, tokens),
      dashed: false,
      pct: Math.round((values[i] / total) * 100),
    }));
  }

  const useCategory = TYPE === 'bar_stacked';
  return chartYaml.series.map((s, i) => ({
    label: s[`legend_label_${lang}`] ?? s[`legend_label_en`] ?? s[`name_${lang}`] ?? s.name_en,
    color: useCategory ? categoryColor(i, tokens) : colorFor(s.semantic_role, tokens),
    dashed: s.semantic_role === 'floor',
  }));
}

// Render it like this (flex row of pills; the `gap` is what keeps the swatch off the
// label — never let them touch). Place it directly ABOVE the <canvas>, never inside it:
//
//   <ul class="legend">                              <!-- list-style:none; display:flex;
//                                                         flex-wrap:wrap; gap:12px 28px;
//                                                         margin:0 0 16px; padding:0 -->
//     <!-- per item: -->
//     <li style="display:flex; align-items:center; gap:12px;">  <!-- gap = swatch↔label -->
//       <span style="width:28px; height:0; border-top:4px solid <color>;
//                    border-top-style:<solid|dashed>;"></span>   <!-- line swatch -->
//       <span style="font:500 28px 'Inter',sans-serif; color:var(--text); white-space:nowrap;">
//         <label></span>
//     </li>
//   </ul>
//
// Keep legend labels SHORT (e.g. "8% equity", "4% FD", "0% savings") — the full series
// name + assumptions live in the caption, not the legend.
//   - line charts: line-rule swatch (border-top: 4px solid <color>; dashed for the floor).
//   - bar / bar_horizontal / bar_stacked: filled square swatch (width:24px; height:24px;
//     background:<color>; border-radius:6px).
//   - pie / doughnut: filled square swatch + the `pct` on the right (e.g. "Asia ex-MYR  35%").

// --- 2c. In-arc % labels for pie/doughnut. Chart.js has no built-in datalabels, so the
//         slice % is drawn by a tiny plugin. Register it on the Chart you build:
//           new Chart(ctx, { ...buildChartConfig(yaml, tokens),
//                            plugins: [inArcLabelsPlugin(tokens)] });
//         Draws white, centered, 700 30px Inter on each slice. % is each slice's share of
//         the total (computed from the data), so it can never disagree with the legend.

function inArcLabelsPlugin(tokens) {
  return {
    id: 'inArcLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      const data = chart.data.datasets[0].data;
      const total = data.reduce((a, b) => a + b, 0) || 1;
      ctx.save();
      ctx.font = "700 30px 'Inter', sans-serif";
      ctx.fillStyle = '#FEFEFE';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      meta.data.forEach((arc, i) => {
        const pct = Math.round((data[i] / total) * 100);
        if (pct < 6) return;                 // too thin a slice to label legibly — skip
        const p = arc.tooltipPosition();
        ctx.fillText(pct + '%', p.x, p.y);
      });
      ctx.restore();
    },
  };
}

// --- 3. Wire it up + raise the wait-for-charts flag (brand contract §7). ---
//
//   <canvas id="chart" width="..." height="..."></canvas>   <!-- explicit px! don't let
//                                                                a flex parent collapse it -->
//   <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
//   <script>
//     window.__chartsReady = false;
//     const chartYaml = { /* paste the parsed YAML here, or inline its fields */ };
//     const tokens = { hero:'#F07621', comparison:'#1B2B6B', floor:'#6b7280',
//                      tick:'#6b7280', grid:'#e5e7f0', bg:'#F7F8FC',
//                      category:['#1B2B6B','#00B4A6','#F07621','#111c45','#6b7280'] };
//     const cfg = buildChartConfig(chartYaml, tokens);
//     const extra = (chartYaml.chart_type === 'pie' || chartYaml.chart_type === 'doughnut')
//                     ? { plugins: [inArcLabelsPlugin(tokens)] } : {};
//     new Chart(document.getElementById('chart'), { ...cfg, ...extra });
//     // Chart.js with animation:false paints synchronously; a short timeout is belt-and-braces.
//     setTimeout(() => { window.__chartsReady = true; }, 300);
//   </script>
//
// Don't forget to also render, somewhere below the canvas: chartYaml.caption_en (~28px)
// and chartYaml.source_citation (≥24px, in full — the PHS reference is a compliance line,
// it must not be truncated by body{overflow:hidden}; see QA Part A bottom-clip check).
// The source line is EXTERNAL-ONLY (see _chart-rules.md): strip internal corpus/** paths,
// course/module names, .md filenames, and internal tool URLs before rendering it.
