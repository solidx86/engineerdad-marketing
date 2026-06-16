// Public surface of @engineerdad/corpus — consumed by the corpus MCP adapter
// and (post-Phase E) by the orchestrator's eager-execute dispatch (ADR-023).

export { reindex } from "./reindex.js";
export type { ReindexResult } from "./reindex.js";

export { search, getComplianceBlock, listProof, listCharts } from "./tools.js";
export type {
  Scope,
  RegulatorSource,
  SearchInput,
  SearchHit,
  ChartListing,
} from "./tools.js";

export { loadChunks, loadIndex, resetCorpusCache } from "./loaders.js";

export { loadChart, loadAllCharts, parseChartYaml } from "./charts.js";
export type { ChartMetadata } from "./charts.js";
export { CHARTS_DIR, DATASETS_DIR } from "./paths.js";

export type {
  CorpusFrontmatter,
  Cluster,
  Granularity,
  SourceType,
  LangStatus,
} from "./frontmatter.js";
