export type Cluster = "mechanics" | "tax" | "portfolio" | "primitive" | "objection";
export type FunnelTier = "necessity" | "avoidance" | "substitution";
export type Granularity = "concept" | "fund";
export type SourceType = "public" | "synthesized";
export type LangStatus = "en_only" | "both";

export interface CorpusFrontmatter {
  cluster?: Cluster;
  funnel_tier?: FunnelTier;
  granularity?: Granularity;
  source_type?: SourceType;
  source_ref?: string;
  verified_at?: string;
  related?: string[];
  lang_status?: LangStatus;
}

const FM_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

const CLUSTER_VALUES = new Set<Cluster>(["mechanics", "tax", "portfolio", "primitive", "objection"]);
const FUNNEL_TIER_VALUES = new Set<FunnelTier>(["necessity", "avoidance", "substitution"]);
const GRANULARITY_VALUES = new Set<Granularity>(["concept", "fund"]);
const SOURCE_TYPE_VALUES = new Set<SourceType>(["public", "synthesized"]);
const LANG_STATUS_VALUES = new Set<LangStatus>(["en_only", "both"]);

function parseList(raw: string): string[] {
  const inner = raw.replace(/^\[|\]$/g, "").trim();
  if (!inner) return [];
  return inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

export function parseFrontmatter(raw: string): CorpusFrontmatter {
  const m = FM_RE.exec(raw);
  if (!m) return {};
  const out: CorpusFrontmatter = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^(\w[\w_]*)\s*:\s*(.+?)\s*$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    const value = kv[2]!.replace(/^["']|["']$/g, "");
    switch (key) {
      case "cluster":
        if (CLUSTER_VALUES.has(value as Cluster)) out.cluster = value as Cluster;
        break;
      case "funnel_tier":
        if (FUNNEL_TIER_VALUES.has(value as FunnelTier)) out.funnel_tier = value as FunnelTier;
        break;
      case "granularity":
        if (GRANULARITY_VALUES.has(value as Granularity)) out.granularity = value as Granularity;
        break;
      case "source_type":
        if (SOURCE_TYPE_VALUES.has(value as SourceType)) out.source_type = value as SourceType;
        break;
      case "source_ref":
        out.source_ref = value;
        break;
      case "verified_at":
        out.verified_at = value;
        break;
      case "lang_status":
        if (LANG_STATUS_VALUES.has(value as LangStatus)) out.lang_status = value as LangStatus;
        break;
      case "related":
        out.related = parseList(value);
        break;
    }
  }
  return out;
}

export function stripFrontmatter(raw: string): string {
  const m = FM_RE.exec(raw);
  if (!m) return raw;
  return raw.slice(m[0].length);
}
