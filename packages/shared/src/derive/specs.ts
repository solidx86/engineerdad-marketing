import type { Aspect, FunnelStage, Lang, Persona, ScriptFormat } from "../types.js";
import { metaCtaType, deriveChannels } from "./channels.js";
import { variantId } from "./ids.js";
import { truncateAtWord, extractKeywords } from "./text.js";

/**
 * deriveSpecs — the pure spec layer that replaces media-production's §5.6–§5.8.
 * It composes the Phase-1 atomics into per-channel ad-copy specs. The
 * creative-director agent authors the CreativePlan (taste); this code derives
 * everything mechanical. Pure throughout.
 */

// ── Creative-director output (§1.1) ──────────────────────────────────────

export interface SceneCard {
  scene: number;
  durationSec: number;
  visual: string;
  onScreenText: string;
  voiceover: string;
  shotNotes: string;
  chartRef: string | null;
  // Reel-only optional fields (per ADR-029 two-type face|visual model).
  // Static formats (Feed/Carousel/YT-Long) leave these undefined; the
  // ReelShotlistSchema enforces them for every Reel CreativeUnit at the
  // P1-fanout boundary.
  sceneType?: "face" | "visual";
  estimatedSeconds?: number;
  visualBrief?: string | null; // concept-visual brief (XOR chartRef); visual scenes only
  explains?: string | null;    // one-line takeaway the narration must land
}

/** The 4 distinct creatives — the Carousel pair is one CreativeUnit. */
export type CreativeFormat = "Reel" | "Feed" | "YT-Long" | "Carousel";

export interface CreativeSource {
  scriptBodyEn: string;
  scriptBodyMs: string;
  ctaEn: string;
  ctaMs: string;
  funnelStage: FunnelStage;
  persona: Persona;
  topic: string;
  targetQuery: string;
  primaryLang: Lang;
}

export interface CreativeUnit {
  scriptId: string;
  format: CreativeFormat;
  hook: { en: string; ms: string; register: string };
  shotlistEn: SceneCard[];
  shotlistBm: SceneCard[];
  thumbnailBrief: string;
  paletteEmphasis: string;
  estCostMyr: number;
  source: CreativeSource;
  // Reel-only optional fields (per 2026-05-28-heygen-reel-pipeline §5.1).
  // ReelShotlistSchema enforces these for every Reel CreativeUnit at the
  // P1-fanout boundary; static formats leave them undefined.
  targetSeconds?: number;
  faceFirstHook?: boolean;
}

export interface CreativePlan {
  runId: string;
  creatives: CreativeUnit[];
}

// ── Meta copy spec (§1.2 · media-production Step 5.7a) ────────────────────

export interface MetaCopySpec {
  primaryTextEn: string;
  primaryTextMs: string;
  headlineEn: string;
  headlineMs: string;
  descriptionEn: string;
  descriptionMs: string;
  ctaType: string;
  targetingJson: string;
}

const META_PRIMARY_MAX = 180;
const META_HEADLINE_MAX = 40;
const META_DESCRIPTION_MAX = 30;

/** Canonical regulator disclaimer appended when the body lacks one. */
const DISCLAIMER: Record<Lang, string> = {
  en: "Past performance is not guaranteed.",
  ms: "Prestasi lampau tidak menjamin pulangan.",
};

/** Substrings that count as a baked-in regulator phrase (case-insensitive). */
const REGULATOR_HINTS = [
  "past performance",
  "prestasi lampau",
  "not guaranteed",
  "tidak menjamin",
];

function hasRegulatorPhrase(text: string): boolean {
  const lower = text.toLowerCase();
  return REGULATOR_HINTS.some((h) => lower.includes(h));
}

/** Opening of `body`, ≤180 chars, with a regulator disclaimer guaranteed. */
function metaPrimaryText(body: string, lang: Lang): string {
  const opener = truncateAtWord(body.trim(), META_PRIMARY_MAX);
  if (hasRegulatorPhrase(opener)) return opener;
  const disclaimer = DISCLAIMER[lang];
  const room = META_PRIMARY_MAX - disclaimer.length - 1;
  const trimmed = room > 0 ? truncateAtWord(opener, room) : "";
  return trimmed ? `${trimmed} ${disclaimer}` : disclaimer;
}

const TARGETING_BASE = {
  geo_locations: { countries: ["MY"] },
  age_min: 25,
  age_max: 45,
  publisher_platforms: ["facebook", "instagram"],
  facebook_positions: ["feed", "video_feeds"],
  instagram_positions: ["stream", "story", "reels"],
};

/** Persona-specific age narrowing; everything else keeps the 25–45 band. */
const PERSONA_AGE_BAND: Partial<Record<Persona, { age_min: number; age_max: number }>> = {
  young_parents_25_35: { age_min: 25, age_max: 35 },
  established_parents_35_45: { age_min: 35, age_max: 45 },
  pre_retirement_prs_focus: { age_min: 45, age_max: 60 },
};

function metaTargetingJson(persona: Persona): string {
  const band = PERSONA_AGE_BAND[persona];
  return JSON.stringify(band ? { ...TARGETING_BASE, ...band } : TARGETING_BASE);
}

/** The Meta ad-copy spec for a creative — media-production Step 5.7a. Pure. */
export function deriveMetaSpec(unit: CreativeUnit): MetaCopySpec {
  const s = unit.source;
  return {
    primaryTextEn: metaPrimaryText(s.scriptBodyEn, "en"),
    primaryTextMs: metaPrimaryText(s.scriptBodyMs, "ms"),
    headlineEn: truncateAtWord(unit.hook.en, META_HEADLINE_MAX),
    headlineMs: truncateAtWord(unit.hook.ms, META_HEADLINE_MAX),
    descriptionEn: truncateAtWord(s.ctaEn, META_DESCRIPTION_MAX),
    descriptionMs: truncateAtWord(s.ctaMs, META_DESCRIPTION_MAX),
    // Both CTA strings are scanned so a consult hint in either language wins.
    ctaType: metaCtaType(s.funnelStage, `${s.ctaEn} ${s.ctaMs}`),
    targetingJson: metaTargetingJson(s.persona),
  };
}

// ── YouTube copy spec (§1.2 · media-production Step 5.7b) ─────────────────

export interface YtCopySpec {
  title: string;
  description: string;
  tags: string[];
  category: string; // Notion "YT Category" select name; distribute maps it to an id
}

const YT_TITLE_MAX = 100;
const YT_TAGS_JOINED_MAX = 500;
const YT_DESCRIPTION_FOOTER =
  "Read more / book a free consultation: https://engineerdad.my";

/** Topic-keyword → YouTube category NAME (media-production §5.7b auto-detect). */
function detectYtCategory(topic: string): string {
  const t = topic.toLowerCase();
  if (/\b(how to|step[- ]by[- ]step|guide|set ?up|tutorial)\b/.test(t)) {
    return "Howto & Style";
  }
  if (/\b(family|parent|parenting|lifestyle|kids|children)\b/.test(t)) {
    return "People & Blogs";
  }
  return "Education";
}

/** Tags — persona + funnel + topic/query keywords, deduped, joined ≤500 chars. */
function ytTags(s: CreativeSource): string[] {
  const raw = [
    s.persona.replace(/_/g, " "),
    s.funnelStage.toLowerCase(),
    ...extractKeywords(s.targetQuery, s.topic),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  let joined = 0;
  for (const tag of raw) {
    const clean = tag.trim();
    if (!clean || seen.has(clean.toLowerCase())) continue;
    const next = joined + clean.length + (out.length > 0 ? 1 : 0); // +1 for the comma
    if (next > YT_TAGS_JOINED_MAX) break;
    seen.add(clean.toLowerCase());
    out.push(clean);
    joined = next;
  }
  return out;
}

/** The YouTube spec for a creative — media-production Step 5.7b. Pure. */
export function deriveYtSpec(unit: CreativeUnit): YtCopySpec {
  const s = unit.source;
  const body = s.primaryLang === "ms" ? s.scriptBodyMs : s.scriptBodyEn;
  const cta = s.primaryLang === "ms" ? s.ctaMs : s.ctaEn;
  const hook = s.primaryLang === "ms" ? unit.hook.ms : unit.hook.en;
  return {
    title: truncateAtWord(hook, YT_TITLE_MAX),
    description: `${body}\n\n${cta}\n\n${YT_DESCRIPTION_FOOTER}`,
    tags: ytTags(s),
    category: detectYtCategory(s.topic),
  };
}

// ── Organic copy spec (§1.2 · media-production Step 5.8) ──────────────────

export interface OrganicCopySpec {
  language: "EN" | "BM";
  captionEn: string;
  captionMs: string;
  hashtagsIg: string[];
  hashtagsFb: string[];
}

const ORGANIC_CAPTION_MAX = 2200; // IG caption limit, shared across IG + FB

/** 8–15 IG tags — broad + niche + community + branded (media-production §5.8). */
const IG_HASHTAGS = [
  "#unittrust",
  "#kewangan",
  "#prsmalaysia",
  "#publicmutual",
  "#parenting",
  "#malaysiankids",
  "#financialplanning",
  "#engineerdad",
];

/** 1–3 FB tags — FB punishes hashtag stacking (media-production §5.8). */
const FB_HASHTAGS = ["#engineerdad", "#kewangan"];

/**
 * A v1 organic caption — hook opener + body excerpt, capped. Warm first-person
 * prose is a future creative-director extension; for now this is deterministic.
 */
function organicCaption(hook: string, body: string): string {
  return truncateAtWord(`${hook}\n\n${body}`.trim(), ORGANIC_CAPTION_MAX);
}

/** The organic FB/IG spec for a creative — media-production Step 5.8. Pure. */
export function deriveOrganicSpec(unit: CreativeUnit): OrganicCopySpec {
  const s = unit.source;
  return {
    language: s.primaryLang === "ms" ? "BM" : "EN",
    captionEn: organicCaption(unit.hook.en, s.scriptBodyEn),
    captionMs: organicCaption(unit.hook.ms, s.scriptBodyMs),
    hashtagsIg: IG_HASHTAGS,
    hashtagsFb: FB_HASHTAGS,
  };
}

// ── Entry point — the 5-format matrix (§1.2 · media-production Step 5) ─────

export interface RenderResult {
  variantId: string;
  url: string;
  sha256: string;
}

export interface VariantSpec {
  variantId: string;
  scriptId: string;
  format: string;
  aspect: string;
  channels: string[];
  estCostMyr: number;
  shotlistEn: SceneCard[];
  shotlistBm: SceneCard[];
  thumbnailBrief: string;
  assetFiles: { url: string; sha256: string }[];
  meta: MetaCopySpec | null;
  yt: YtCopySpec | null;
  organic: OrganicCopySpec | null;
}

/** Each distinct creative → its format-matrix rows; Carousel → two layouts. */
const MATRIX: Record<CreativeFormat, { format: ScriptFormat; aspect: Aspect }[]> = {
  Reel: [{ format: "Reel", aspect: "9:16" }],
  Feed: [{ format: "Feed", aspect: "4:5" }],
  "YT-Long": [{ format: "YT-Long", aspect: "16:9" }],
  Carousel: [
    { format: "Carousel", aspect: "4:5" },
    { format: "Carousel", aspect: "1:1" },
  ],
};

/**
 * Expand a CreativePlan into the per-variant spec matrix. Each CreativeUnit
 * yields one VariantSpec per matrix row (the Carousel pair shares a shotlist
 * across its two layouts); Channels and the per-channel copy are derived,
 * asset files joined by variantId. The creative's cost lands on its first row
 * only, so the variant-sum equals the creative-director's reported total. Pure.
 */
export function deriveSpecs(plan: CreativePlan, renders: RenderResult[]): VariantSpec[] {
  // Group all render results by variantId so multi-slide formats (Carousel)
  // accumulate every slide into assetFiles rather than just the last result.
  const rendersByVariant = new Map<string, { url: string; sha256: string }[]>();
  for (const r of renders) {
    const arr = rendersByVariant.get(r.variantId) ?? [];
    arr.push({ url: r.url, sha256: r.sha256 });
    rendersByVariant.set(r.variantId, arr);
  }

  const out: VariantSpec[] = [];
  for (const unit of plan.creatives) {
    const meta = deriveMetaSpec(unit);
    const yt = deriveYtSpec(unit);
    const organic = deriveOrganicSpec(unit);
    MATRIX[unit.format].forEach((row, i) => {
      const id = variantId(unit.scriptId, row.format, row.aspect);
      const channels = deriveChannels(row.format, row.aspect, unit.source.funnelStage);
      out.push({
        variantId: id,
        scriptId: unit.scriptId,
        format: row.format,
        aspect: row.aspect,
        channels,
        estCostMyr: i === 0 ? unit.estCostMyr : 0,
        shotlistEn: unit.shotlistEn,
        shotlistBm: unit.shotlistBm,
        thumbnailBrief: unit.thumbnailBrief,
        assetFiles: rendersByVariant.get(id) ?? [],
        meta: channels.some((c) => c.startsWith("Meta")) ? meta : null,
        yt: channels.some((c) => c.startsWith("YouTube")) ? yt : null,
        organic: channels.includes("Meta-organic") ? organic : null,
      });
    });
  }
  return out;
}
