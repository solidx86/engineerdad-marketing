#!/usr/bin/env node
// refresh-funds-corpus — parses the latest Public Mutual FundMaster xlsx and
// regenerates the dated corpus trio: item 10 (per-fund JSON), item 6 (universe
// stats snapshot), item 8 (sector/geo rotation snapshot).
//
// Does NOT run /ingest-corpus — reindexing is a deliberate human step.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_FUNDMASTERS_DIR = "/Users/solid/Downloads/Funds/output/fundmasters/";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// --- cell coercion -----------------------------------------------------------

// Numeric coercion that tolerates ExcelJS formula objects (which carry a cached
// `result` or — as in the FundMaster AE columns — no result at all).
export function num(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object") {
    if ("result" in v) return num(v.result);
    return null; // formula cell with no cached result
  }
  if (typeof v === "string") {
    const t = v.trim().replace(/[,%]/g, "");
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function str(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return str(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("").trim() || null;
    if ("text" in v) return String(v.text).trim() || null;
    return null;
  }
  const s = String(v).trim();
  return s === "" ? null : s;
}

// --- column → field maps -----------------------------------------------------

const ALLOCATION_COLS = {
  "Dom. Equity (%)": "dom_equity",
  "For. Equity (%)": "for_equity",
  "FI / Sukuk (%)": "fi_sukuk",
  "Money Mkt (%)": "money_mkt",
  "Deposits (%)": "deposits",
  "Alloc Other (%)": "other",
};
const GEO_COLS = {
  "USA (%)": "usa",
  "Taiwan (%)": "taiwan",
  "Korea (%)": "korea",
  "Japan (%)": "japan",
  "France (%)": "france",
  "Germany (%)": "germany",
  "China (%)": "china",
  "Singapore (%)": "singapore",
  "Netherlands (%)": "netherlands",
  "Indonesia (%)": "indonesia",
  "Australia (%)": "australia",
  "Geo Other (%)": "other",
};
const SECTOR_COLS = {
  "Industrial (%)": "industrial",
  "Technology (%)": "technology",
  "Financial (%)": "financial",
  "Comms (%)": "comms",
  "Cons. Disc. (%)": "cons_disc",
  "Cons. Staples (%)": "cons_staples",
  "Utilities (%)": "utilities",
  "Energy (%)": "energy",
  "Materials (%)": "materials",
  "Real Estate (%)": "real_estate",
  "Sector Other (%)": "other",
};
const ALPHA_COLS = {
  "YTD Alpha (%)": "ytd",
  "1Y Alpha (%)": "1y",
  "3Y Alpha (%)": "3y",
  "5Y Alpha (%)": "5y",
  "10Y Alpha (%)": "10y",
};
const SECTOR_LABELS = {
  industrial: "Industrial",
  technology: "Technology",
  financial: "Financial",
  comms: "Communications",
  cons_disc: "Consumer Discretionary",
  cons_staples: "Consumer Staples",
  utilities: "Utilities",
  energy: "Energy",
  materials: "Materials",
  real_estate: "Real Estate",
};
const GEO_LABELS = {
  usa: "USA",
  taiwan: "Taiwan",
  korea: "Korea",
  japan: "Japan",
  france: "France",
  germany: "Germany",
  china: "China",
  singapore: "Singapore",
  netherlands: "Netherlands",
  indonesia: "Indonesia",
  australia: "Australia",
};

// --- period / file discovery -------------------------------------------------

export function periodFromFilename(filename) {
  const base = path.basename(filename);
  const m = base.match(/FundMaster_([A-Za-z]{3})(\d{4})/);
  if (!m) throw new Error(`Cannot derive a period from filename: ${base}`);
  const mon = m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase();
  if (!MONTHS.includes(mon)) throw new Error(`Unrecognised month token "${m[1]}" in ${base}`);
  return { display: `${mon} ${m[2]}`, slug: `${mon.toLowerCase()}${m[2]}` };
}

export function findLatestXlsx(dir = DEFAULT_FUNDMASTERS_DIR) {
  const matches = fs
    .readdirSync(dir)
    .filter((f) => /^PublicMutual_FundMaster_.*\.xlsx$/.test(f))
    .map((f) => {
      const full = path.join(dir, f);
      return { full, mtime: fs.statSync(full).mtimeMs };
    });
  if (matches.length === 0) {
    throw new Error(`No PublicMutual_FundMaster_*.xlsx found in ${dir}`);
  }
  matches.sort((a, b) => b.mtime - a.mtime);
  return matches[0].full;
}

// --- parsing -----------------------------------------------------------------

export async function parseFundMaster(xlsxPath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const ws = wb.getWorksheet("Master") ?? wb.worksheets[0];

  // The Master sheet carries a title row and a section-group row above the
  // real column headers — locate the header row by its "Fund Name" anchor.
  let headerRowIdx = -1;
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    if (str(ws.getRow(r).getCell(1).value) === "Fund Name") {
      headerRowIdx = r;
      break;
    }
  }
  if (headerRowIdx === -1) throw new Error(`No "Fund Name" header row found in ${xlsxPath}`);

  const headerRow = ws.getRow(headerRowIdx);
  const col = new Map();
  for (let c = 1; c <= ws.columnCount; c++) {
    const name = str(headerRow.getCell(c).value);
    if (name && !col.has(name)) col.set(name, c);
  }
  const cell = (row, header) => (col.has(header) ? row.getCell(col.get(header)).value : null);

  const funds = [];
  for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = str(cell(row, "Fund Name"));
    if (!name) continue;

    const alpha = {};
    for (const [header, key] of Object.entries(ALPHA_COLS)) alpha[key] = num(cell(row, header));
    const vf = num(cell(row, "VF"));
    const alphaEfficiency = {};
    for (const key of Object.keys(alpha)) {
      alphaEfficiency[key] = alpha[key] != null && vf != null && vf !== 0 ? alpha[key] / vf : null;
    }

    const block = (cols) => {
      const out = {};
      for (const [header, key] of Object.entries(cols)) out[key] = num(cell(row, header));
      return out;
    };

    const shariahRaw = (str(cell(row, "Shariah-compliant")) ?? "").toLowerCase();
    const statusRaw = (str(cell(row, "Status")) ?? "").toLowerCase();
    const holdingsRaw = str(cell(row, "Top 5 Holdings"));

    funds.push({
      name,
      abbr: str(cell(row, "Abbr")),
      shariah: shariahRaw.startsWith("shariah"),
      type: str(cell(row, "Fund Type")),
      objective: str(cell(row, "Objective")),
      risk_level: num(cell(row, "Risk Level")),
      distribution: str(cell(row, "Distribution")),
      size_rm_m: num(cell(row, "Size (RM M)")),
      launch: str(cell(row, "Launch")),
      status: str(cell(row, "Status")),
      qualified: statusRaw === "qualified",
      beat_pct: num(cell(row, "Beat (%)")),
      periods: str(cell(row, "Periods")),
      weighted_alpha: num(cell(row, "Wtd Alpha (%)")),
      alpha,
      vf,
      alpha_efficiency: alphaEfficiency,
      allocation: block(ALLOCATION_COLS),
      geo: block(GEO_COLS),
      sector: block(SECTOR_COLS),
      top_holdings: holdingsRaw
        ? holdingsRaw
            .split(holdingsRaw.includes("|") ? "|" : ",")
            .map((h) => h.trim())
            .filter(Boolean)
        : [],
      lipper_class: str(cell(row, "Lipper Class")),
      benchmark: str(cell(row, "Benchmark")),
      ath_nav: num(cell(row, "ATH NAV")),
      ath_date: str(cell(row, "ATH Date")),
      cur_nav: num(cell(row, "Cur NAV")),
      drawdown_pct: num(cell(row, "Drawdown (%)")),
      days_from_ath: num(cell(row, "Days from ATH")),
    });
  }
  return funds;
}

// --- item 10: per-fund JSON snapshot ----------------------------------------

export function buildJsonSnapshot(funds, { period, sourceFile, generatedAt } = {}) {
  return {
    snapshot_period: period.display,
    source_file: sourceFile,
    generated_at: generatedAt ?? new Date().toISOString(),
    compliance_note: "Facts only. Do not derive recommendations.",
    funds: funds.map((f) => ({
      name: f.name,
      abbr: f.abbr,
      shariah: f.shariah,
      type: f.type,
      risk_level: f.risk_level,
      size_rm_m: f.size_rm_m,
      qualified: f.qualified,
      weighted_alpha: f.weighted_alpha,
      alpha: f.alpha,
      alpha_efficiency: f.alpha_efficiency,
      allocation: f.allocation,
      geo: f.geo,
      sector: f.sector,
      top_holdings: f.top_holdings,
      drawdown_pct: f.drawdown_pct,
      ath_date: f.ath_date,
    })),
  };
}

// --- aggregate maths ---------------------------------------------------------

function median(values) {
  const xs = values.filter((v) => v != null).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export function computeUniverseStats(funds) {
  const total = funds.length;
  const qualified = funds.filter((f) => f.qualified).length;

  const categories = [...new Set(funds.map((f) => f.type ?? "Uncategorised"))];
  const by_category = categories
    .map((category) => {
      const inCat = funds.filter((f) => (f.type ?? "Uncategorised") === category);
      const q = inCat.filter((f) => f.qualified).length;
      return {
        category,
        total: inCat.length,
        qualified: q,
        qualified_pct: inCat.length ? (q / inCat.length) * 100 : 0,
        median_weighted_alpha: median(inCat.map((f) => f.weighted_alpha)),
      };
    })
    .sort((a, b) => b.total - a.total);

  const with3y = funds.filter((f) => f.alpha["3y"] != null);
  const pos3y = with3y.filter((f) => f.alpha["3y"] > 0).length;

  const drawdowns = funds.map((f) => f.drawdown_pct).filter((v) => v != null);

  return {
    total,
    qualified,
    qualified_pct: total ? (qualified / total) * 100 : 0,
    by_category,
    positive_3y_alpha: {
      count: pos3y,
      of: with3y.length,
      pct: with3y.length ? (pos3y / with3y.length) * 100 : 0,
    },
    drawdown: {
      median: median(drawdowns),
      worst: drawdowns.length ? Math.min(...drawdowns) : null,
      at_ath_count: funds.filter((f) => f.drawdown_pct != null && f.drawdown_pct >= 0).length,
    },
  };
}

function rankBlock(funds, blockKey, labels) {
  // Mean weight per field across funds that carry data for the block, with the
  // "other" catch-all excluded from the ranking.
  const withData = funds.filter((f) => {
    const vals = Object.values(f[blockKey]);
    return vals.some((v) => v != null) && vals.reduce((s, v) => s + (v ?? 0), 0) > 0;
  });
  if (withData.length === 0) return [];
  const keys = Object.keys(labels);
  return keys
    .map((key) => ({
      name: labels[key],
      mean_pct: withData.reduce((s, f) => s + (f[blockKey][key] ?? 0), 0) / withData.length,
    }))
    .filter((row) => row.mean_pct > 0)
    .sort((a, b) => b.mean_pct - a.mean_pct)
    .slice(0, 5);
}

export function computeRotation(funds) {
  const qualified = funds.filter((f) => f.qualified);

  const holdingCounts = new Map();
  for (const f of qualified) {
    for (const h of new Set(f.top_holdings)) {
      holdingCounts.set(h, (holdingCounts.get(h) ?? 0) + 1);
    }
  }
  const top_holdings = [...holdingCounts.entries()]
    .map(([name, fund_count]) => ({ name, fund_count }))
    .sort((a, b) => b.fund_count - a.fund_count || a.name.localeCompare(b.name))
    .slice(0, 10);

  return {
    qualified_basis: qualified.length,
    top_sectors: rankBlock(qualified, "sector", SECTOR_LABELS),
    top_geos: rankBlock(qualified, "geo", GEO_LABELS),
    top_holdings,
  };
}

// --- rendering ---------------------------------------------------------------

const fmt2 = (n) => (n == null ? "n/a" : n.toFixed(2));
const fmtPct = (n) => (n == null ? "n/a" : `${n.toFixed(1)}%`);
const fmtSigned = (n) => (n == null ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}`);

function frontmatter({ quote, attribution, persona, period }) {
  return [
    "---",
    `quote: ${JSON.stringify(quote)}`,
    `attribution: ${JSON.stringify(attribution)}`,
    "permission_status: public",
    `persona: ${persona}`,
    "dated_snapshot: true",
    `snapshot_period: ${JSON.stringify(period.display)}`,
    "---",
    "",
  ].join("\n");
}

export function renderUniverseStatsMd(stats, { period }) {
  const attribution = `Public Mutual Monthly Fund Report — ${period.display}`;
  const quote = `Of ${stats.total} Public Mutual retail funds, ${stats.qualified} cleared the EngineerDad weighted-alpha screen in ${period.display}.`;

  const catRows = stats.by_category
    .map(
      (c) =>
        `| ${c.category} | ${c.total} | ${c.qualified} | ${fmtPct(c.qualified_pct)} | ${fmtSigned(
          c.median_weighted_alpha,
        )} |`,
    )
    .join("\n");

  return (
    frontmatter({ quote, attribution, persona: "all", period }) +
    `
# Fund Universe Stats — ${period.display}

> Aggregate state of the Public Mutual retail unit-trust universe as of the ${period.display} Monthly Fund Report (MFR). Aggregate figures only — no fund is named, ranked, or recommended.

## Headline

**${stats.qualified} of ${stats.total}** retail funds cleared the EngineerDad weighted-alpha screen this month — a ${fmtPct(
      stats.qualified_pct,
    )} qualified rate.

## Distribution by category

| Category | Funds | Qualified | Qualified rate | Median weighted alpha |
|---|---|---|---|---|
${catRows}

## Three-year alpha

${stats.positive_3y_alpha.count} of ${stats.positive_3y_alpha.of} funds with a measured three-year record (${fmtPct(
      stats.positive_3y_alpha.pct,
    )}) posted positive three-year alpha against their benchmark.

## Drawdown from all-time high

Median drawdown across the universe sits at ${fmt2(stats.drawdown.median)}% from each fund's all-time-high NAV; the deepest drawdown on file is ${fmt2(
      stats.drawdown.worst,
    )}%. ${stats.drawdown.at_ath_count} fund(s) are currently at a fresh all-time high.

## Notable shifts vs prior month

First ${period.display} snapshot in the corpus — month-over-month comparison will populate from the next refresh onward.

## Compliance

Aggregate statistics only. No individual fund is named, ranked, or recommended here. "Qualified" reflects EngineerDad's published weighted-alpha screen (see \`corpus/courses/weighted-alpha-scoring.md\`) and is a research signal, not investment advice. Past performance does not indicate future results.
`
  );
}

export function renderRotationMd(rotation, { period }) {
  const attribution = `Public Mutual Monthly Fund Report — ${period.display}`;
  const quote = `Where the qualified Public Mutual universe is collectively tilting in ${period.display}.`;

  const sectorRows = rotation.top_sectors
    .map((s, i) => `| ${i + 1} | ${s.name} | ${fmtPct(s.mean_pct)} |`)
    .join("\n");
  const geoRows = rotation.top_geos
    .map((g, i) => `| ${i + 1} | ${g.name} | ${fmtPct(g.mean_pct)} |`)
    .join("\n");
  const holdingRows = rotation.top_holdings
    .map((h, i) => `| ${i + 1} | ${h.name} | ${h.fund_count} |`)
    .join("\n");

  return (
    frontmatter({ quote, attribution, persona: "all", period }) +
    `
# Sector / Geo Rotation — ${period.display}

> Cross-fund allocation lens across the ${rotation.qualified_basis} qualified Public Mutual retail funds in the ${period.display} Monthly Fund Report. Aggregate tilt only — never a recommendation to tilt a personal portfolio.

## Top sectors

Mean sector weight across qualified funds that carry a sector breakdown (the "Other" catch-all is excluded).

| # | Sector | Mean weight |
|---|---|---|
${sectorRows}

## Top geographies

Mean geographic weight across qualified funds that carry a geographic breakdown.

| # | Geography | Mean weight |
|---|---|---|
${geoRows}

## Top holdings

How many qualified funds count each name among their top-5 holdings.

| # | Holding | Qualified funds holding it |
|---|---|---|
${holdingRows}

## Notable shifts vs prior month

First ${period.display} snapshot in the corpus — month-over-month comparison will populate from the next refresh onward.

## Compliance

Aggregate allocation lens only. This file never recommends tilting a personal portfolio toward any sector, geography, or holding. Allocation data is descriptive of the qualified universe at a point in time, not forward guidance.
`
  );
}

// --- orchestration -----------------------------------------------------------

export async function generateArtifacts(xlsxPath, opts = {}) {
  const period = opts.period ?? periodFromFilename(xlsxPath);
  const funds = await parseFundMaster(xlsxPath);
  const snapshot = buildJsonSnapshot(funds, {
    period,
    sourceFile: path.basename(xlsxPath),
    generatedAt: opts.generatedAt,
  });
  const stats = computeUniverseStats(funds);
  const rotation = computeRotation(funds);
  return {
    period,
    funds,
    snapshot,
    stats,
    rotation,
    universeStatsMd: renderUniverseStatsMd(stats, { period }),
    rotationMd: renderRotationMd(rotation, { period }),
  };
}

async function main() {
  const dir = process.argv[2] || DEFAULT_FUNDMASTERS_DIR;
  const xlsxPath = findLatestXlsx(dir);
  console.log(`Source: ${xlsxPath}`);

  const a = await generateArtifacts(xlsxPath);
  const dataDir = path.join(REPO_ROOT, "corpus", "data");
  const proofDir = path.join(REPO_ROOT, "corpus", "proof");
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.mkdir(proofDir, { recursive: true });

  const jsonPath = path.join(dataDir, `funds-${a.period.slug}.json`);
  const statsPath = path.join(proofDir, "fund-universe-stats-snapshot.md");
  const rotationPath = path.join(proofDir, "sector-geo-rotation-snapshot.md");

  await fsp.writeFile(jsonPath, JSON.stringify(a.snapshot, null, 2) + "\n");
  await fsp.writeFile(statsPath, a.universeStatsMd);
  await fsp.writeFile(rotationPath, a.rotationMd);

  console.log(
    [
      `Period:    ${a.period.display}`,
      `Funds:     ${a.stats.total} total · ${a.stats.qualified} qualified`,
      `Wrote:     ${path.relative(REPO_ROOT, jsonPath)}`,
      `Wrote:     ${path.relative(REPO_ROOT, statsPath)}`,
      `Wrote:     ${path.relative(REPO_ROOT, rotationPath)}`,
      "Reminder:  run /ingest-corpus to reindex (deliberate human step).",
    ].join("\n"),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
