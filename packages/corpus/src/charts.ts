import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { extractNumbers } from "@engineerdad/shared";
import { CHARTS_DIR } from "./paths.js";

/**
 * Chart-metadata loader (ADR-030 Phase 1.4).
 *
 * Reads a derived chart spec (`corpus/data/charts/<id>.yaml`) into a shape that
 * serves two consumers:
 *   • the content-writer picker (via `corpus.list_charts`) — needs id, title,
 *     and a human-readable `scenario` (the caption headline) to choose the
 *     chart whose scenario+numbers match a claim; and
 *   • the C1 figures-trace verifier — needs `traceNumbers`, the full set of
 *     canonical numbers the chart actually depicts.
 *
 * Charts vary in shape by `chart_type` (line carries numeric `labels` +
 * multi-series `values`; bar carries category labels + one series). Rather than
 * model every shape, we collect numbers robustly: every numeric scalar found
 * anywhere in the parsed YAML, plus numbers parsed out of the caption/title/
 * source text (so a derived "~41%" in the caption is traceable even though it
 * is not a raw series value). The plan's `valueRanges` is realised as
 * `traceNumbers` (a superset that also covers derived/caption figures).
 */
export interface ChartMetadata {
  id: string;
  chartType: string | null;
  title: { en: string; ms: string };
  /** The caption headline — what scenario this chart argues (EN). */
  scenario: string;
  scenarioMs: string;
  sourceCitation: string | null;
  /** Raw labels as authored (numbers for line charts, strings for bar). */
  labels: unknown[];
  /** Full canonical haystack for the figures-trace (labels ∪ all series values
   *  ∪ numbers parsed from title/caption/source). */
  traceNumbers: number[];
}

/** Recursively collect every finite numeric scalar in a parsed-YAML value. */
function collectNumbers(value: unknown, out: number[]): void {
  if (typeof value === "number") {
    if (Number.isFinite(value)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, out);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectNumbers(v, out);
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Parse one chart YAML string into ChartMetadata. `id` falls back to the file
 *  stem when the YAML omits its own `id`. */
export function parseChartYaml(raw: string, fallbackId: string): ChartMetadata {
  const doc = (parseYaml(raw) ?? {}) as Record<string, unknown>;

  const titleEn = str(doc["title_en"]);
  const titleMs = str(doc["title_ms"]);
  const captionEn = str(doc["caption_en"]);
  const captionMs = str(doc["caption_ms"]);
  const sourceCitation = typeof doc["source_citation"] === "string" ? doc["source_citation"] : null;
  const labels = Array.isArray(doc["labels"]) ? (doc["labels"] as unknown[]) : [];

  // Haystack: structural numbers (labels, every series `values` array, any
  // numeric scalar) ∪ text numbers (title, caption, source citation).
  const trace: number[] = [];
  collectNumbers(doc["labels"], trace);
  collectNumbers(doc["series"], trace);
  for (const text of [titleEn, titleMs, captionEn, captionMs, sourceCitation ?? ""]) {
    trace.push(...extractNumbers(text));
  }
  // De-dupe (cheap, keeps the haystack small).
  const traceNumbers = [...new Set(trace)];

  return {
    id: typeof doc["id"] === "string" && doc["id"] ? (doc["id"] as string) : fallbackId,
    chartType: typeof doc["chart_type"] === "string" ? (doc["chart_type"] as string) : null,
    title: { en: titleEn, ms: titleMs },
    scenario: captionEn,
    scenarioMs: captionMs,
    sourceCitation,
    labels,
    traceNumbers,
  };
}

/** Load and parse one chart by id from `corpus/data/charts/<id>.yaml`.
 *  Returns null when the file does not exist. */
export async function loadChart(id: string): Promise<ChartMetadata | null> {
  const path = join(CHARTS_DIR, `${id}.yaml`);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf8");
  return parseChartYaml(raw, id);
}

/** Live `readdir` of the charts directory → metadata for every chart.
 *  Not backed by the BM25 index (charts are read by path). */
export async function loadAllCharts(): Promise<ChartMetadata[]> {
  if (!existsSync(CHARTS_DIR)) return [];
  const entries = await readdir(CHARTS_DIR, { withFileTypes: true });
  const out: ChartMetadata[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".yaml")) continue;
    const id = e.name.slice(0, -".yaml".length);
    const raw = await readFile(join(CHARTS_DIR, e.name), "utf8");
    out.push(parseChartYaml(raw, id));
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
