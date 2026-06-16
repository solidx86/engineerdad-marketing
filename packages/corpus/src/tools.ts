import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { CORPUS_DIR } from "./paths.js";
import { loadChunks, loadIndex } from "./loaders.js";
import { loadChart, loadAllCharts, type ChartMetadata } from "./charts.js";
import { search as bm25Search } from "./bm25.js";
import type { Chunk } from "./chunk.js";
import type { Lang } from "./tokenize.js";
import type { Cluster, FunnelTier, Granularity, SourceType } from "./frontmatter.js";

export type Scope = "compliance" | "courses" | "proof" | "knowledge";
export type RegulatorSource = "sc" | "fimm" | "public-mutual";

const SOURCE_FILE: Record<RegulatorSource, string> = {
  sc: "sc-malaysia.md",
  fimm: "fimm.md",
  "public-mutual": "public-mutual.md",
};

export interface SearchInput {
  query: string;
  k?: number;
  scope?: Scope[];
  lang?: Lang;
  cluster?: Cluster;
  funnel_tier?: FunnelTier;
  granularity?: Granularity;
  source_type?: SourceType;
}

export interface SearchHit {
  file: string;
  chunk_id: string;
  text: string;
  score: number;
  scope: string;
  lang: Lang;
  cluster?: Cluster;
  funnel_tier?: FunnelTier;
  granularity?: Granularity;
  source_type?: SourceType;
}

export async function search(input: SearchInput): Promise<{ hits: SearchHit[] }> {
  const k = input.k ?? 8;
  const lang: Lang = input.lang ?? "en";
  const scopeSet = input.scope && input.scope.length > 0 ? new Set<string>(input.scope) : null;

  const chunks = await loadChunks();
  if (chunks.length === 0) return { hits: [] };
  const index = await loadIndex();
  const byId = new Map<string, Chunk>(chunks.map((c) => [c.chunk_id, c]));

  const filter = (chunkId: string): boolean => {
    const c = byId.get(chunkId);
    if (!c) return false;
    if (scopeSet && !scopeSet.has(c.scope)) return false;
    if (input.lang && c.lang !== input.lang) return false;
    if (input.cluster && c.cluster !== input.cluster) return false;
    if (input.funnel_tier && c.funnel_tier !== input.funnel_tier) return false;
    if (input.granularity && c.granularity !== input.granularity) return false;
    if (input.source_type && c.source_type !== input.source_type) return false;
    return true;
  };

  const results = bm25Search(index, input.query, lang, k, filter);
  const hits = results
    .map((r): SearchHit | null => {
      const c = byId.get(r.chunk_id);
      if (!c) return null;
      return {
        file: c.file,
        chunk_id: c.chunk_id,
        text: c.text,
        score: r.score,
        scope: c.scope,
        lang: c.lang,
        cluster: c.cluster,
        funnel_tier: c.funnel_tier,
        granularity: c.granularity,
        source_type: c.source_type,
      };
    })
    .filter((h): h is SearchHit => h !== null);
  return { hits };
}

export interface ComplianceBlockInput {
  lang: Lang;
  sources?: RegulatorSource[];
}

export interface ComplianceBlockOutput {
  markdown: string;
  sources_included: RegulatorSource[];
  warnings: string[];
}

const LANG_HEADER: Record<Lang, RegExp> = {
  en: /^##\s+English\s*$/im,
  ms: /^##\s+(Bahasa\s*Malaysia|Melayu|BM)\s*$/im,
};

function extractLangSection(markdown: string, lang: Lang): string {
  const headerRe = LANG_HEADER[lang];
  const m = headerRe.exec(markdown);
  if (!m) return "";
  const start = m.index + m[0].length;
  // find next "## " header
  const tail = markdown.slice(start);
  const next = /^##\s+/m.exec(tail);
  const body = next ? tail.slice(0, next.index) : tail;
  return body.trim();
}

export async function getComplianceBlock(
  input: ComplianceBlockInput,
): Promise<ComplianceBlockOutput> {
  const sources = input.sources && input.sources.length > 0
    ? input.sources
    : (["sc", "fimm", "public-mutual"] as RegulatorSource[]);
  const blocks: string[] = [];
  const included: RegulatorSource[] = [];
  const warnings: string[] = [];
  const seenLines = new Set<string>();

  for (const src of sources) {
    const path = join(CORPUS_DIR, "compliance", SOURCE_FILE[src]);
    if (!existsSync(path)) {
      warnings.push(`missing corpus file: corpus/compliance/${SOURCE_FILE[src]}`);
      continue;
    }
    const md = await readFile(path, "utf8");
    const section = extractLangSection(md, input.lang);
    if (!section) {
      warnings.push(`no '${input.lang}' section in corpus/compliance/${SOURCE_FILE[src]}`);
      continue;
    }
    // dedupe at line granularity
    const deduped: string[] = [];
    for (const line of section.split(/\r?\n/)) {
      const key = line.trim().toLowerCase();
      if (!key) {
        deduped.push("");
        continue;
      }
      if (seenLines.has(key)) continue;
      seenLines.add(key);
      deduped.push(line);
    }
    const labelMap: Record<RegulatorSource, string> = {
      sc: "Securities Commission Malaysia",
      fimm: "FIMM",
      "public-mutual": "Public Mutual",
    };
    blocks.push(`### ${labelMap[src]}\n\n${deduped.join("\n").trim()}`);
    included.push(src);
  }

  const markdown = blocks.join("\n\n");
  return { markdown, sources_included: included, warnings };
}

export interface ListProofInput {
  persona?: string;
}

export interface ProofItem {
  file: string;
  quote: string;
  attribution: string;
  permission_status: string;
}

export async function listProof(input: ListProofInput): Promise<{ items: ProofItem[] }> {
  const proofDir = join(CORPUS_DIR, "proof");
  if (!existsSync(proofDir)) return { items: [] };
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(proofDir, { withFileTypes: true }))
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .map((d) => join(proofDir, d.name));
  const items: ProofItem[] = [];
  for (const f of files) {
    const raw = await readFile(f, "utf8");
    // parse frontmatter
    const fm = parseProofFrontmatter(raw);
    if (input.persona && fm["persona"] && fm["persona"] !== input.persona) continue;
    items.push({
      file: f.replace(CORPUS_DIR + "/", ""),
      quote: fm["quote"] ?? raw.slice(0, 300),
      attribution: fm["attribution"] ?? "(unattributed)",
      permission_status: fm["permission_status"] ?? "unknown",
    });
  }
  return { items };
}

function parseProofFrontmatter(raw: string): Record<string, string> {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n/.exec(raw);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^(\w[\w_]*)\s*:\s*(.+?)\s*$/.exec(line);
    if (kv) out[kv[1]!] = kv[2]!.replace(/^"|"$/g, "");
  }
  return out;
}

// ── list_charts (ADR-030) ─────────────────────────────────────────────────
//   The content-writer's chart picker. A LIVE readdir of corpus/data/charts/
//   (NOT the BM25 index — charts are read by path), each mapped through the
//   chart-metadata loader. The binder uses `scenario` + `figures` to choose the
//   chart whose scenario AND numbers match a claim before binding kind:data.

export interface ChartListing {
  id: string;
  chartType: string | null;
  title: { en: string; ms: string };
  /** The caption headline — what scenario this chart argues. */
  scenario: string;
  sourceCitation: string | null;
  /** Canonical numbers the chart depicts — the binder confirms a claim's
   *  figures actually appear here before binding kind:data. */
  figures: number[];
}

export async function listCharts(input?: { id?: string }): Promise<{ charts: ChartListing[] }> {
  let metas: ChartMetadata[];
  if (input?.id) {
    const one = await loadChart(input.id);
    metas = one ? [one] : [];
  } else {
    metas = await loadAllCharts();
  }
  return {
    charts: metas.map((m) => ({
      id: m.id,
      chartType: m.chartType,
      title: m.title,
      scenario: m.scenario,
      sourceCitation: m.sourceCitation,
      figures: m.traceNumbers,
    })),
  };
}
