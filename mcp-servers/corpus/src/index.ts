#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  reindex,
  search,
  getComplianceBlock,
  listProof,
  listCharts,
  resetCorpusCache,
} from "@engineerdad/corpus";

const server = new McpServer({ name: "corpus", version: "0.1.0" });

const toolResult = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
});
const errorResult = (err: unknown) => ({
  isError: true,
  content: [
    { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
  ],
});

server.tool(
  "reindex",
  "Walk /corpus, extract text from .md/.pdf/.txt/.vtt, lang-aware chunking (~800 tokens, 100 overlap), write chunks.jsonl + BM25 sidecar.",
  {},
  async () => {
    try {
      const out = await reindex();
      resetCorpusCache();
      return toolResult(out);
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.tool(
  "search",
  "BM25 search over corpus chunks. EN/BM use whitespace + stopword filter. Optional filters: scope (compliance | courses | proof | knowledge), lang, cluster (mechanics | tax | portfolio | primitive | objection), funnel_tier (necessity | avoidance | substitution), granularity (concept | fund), source_type (public | synthesized).",
  {
    query: z.string().min(1),
    k: z.number().int().positive().max(50).optional(),
    scope: z.array(z.enum(["compliance", "courses", "proof", "knowledge"])).optional(),
    lang: z.enum(["en", "ms"]).optional(),
    cluster: z.enum(["mechanics", "tax", "portfolio", "primitive", "objection"]).optional(),
    funnel_tier: z.enum(["necessity", "avoidance", "substitution"]).optional(),
    granularity: z.enum(["concept", "fund"]).optional(),
    source_type: z.enum(["public", "synthesized"]).optional(),
  },
  async (args) => {
    try { return toolResult(await search(args)); }
    catch (err) { return errorResult(err); }
  },
);

server.tool(
  "get_compliance_block",
  "Read & merge corpus/compliance/sc-malaysia.md + fimm.md + public-mutual.md (per language section). Default: union of all three, line-deduplicated. Optional sources arg scopes to a subset.",
  {
    lang: z.enum(["en", "ms"]),
    sources: z.array(z.enum(["sc", "fimm", "public-mutual"])).optional(),
  },
  async (args) => {
    try { return toolResult(await getComplianceBlock(args)); }
    catch (err) { return errorResult(err); }
  },
);

server.tool(
  "list_proof",
  "Read structured testimonials from corpus/proof/*.md. Each file should have YAML frontmatter (quote, attribution, permission_status, persona).",
  { persona: z.string().optional() },
  async (args) => {
    try { return toolResult(await listProof(args)); }
    catch (err) { return errorResult(err); }
  },
);

server.tool(
  "list_charts",
  "List the derived chart specs in corpus/data/charts/ (ADR-030 data-first claim binding). LIVE readdir, not the BM25 index. Each entry: id, chart_type, bilingual title, scenario (caption headline), source_citation, and figures (the canonical numbers the chart depicts). Use this to pick the chart whose scenario AND numbers match a quantitative claim before binding kind:data. Optional `id` returns just that chart.",
  { id: z.string().optional() },
  async (args) => {
    try { return toolResult(await listCharts(args)); }
    catch (err) { return errorResult(err); }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
