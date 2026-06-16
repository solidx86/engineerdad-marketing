import { slugify, readingTime, extractKeywords, topicTag, truncateAtWord } from "./text.js";

/**
 * deriveArticlePackaging — the pure AEO/GEO packaging layer that replaces
 * media-production's Articles pass (§8.2). Substance (Title, Body, FAQ, …) is
 * content-gen's authority; this derives only packaging. Pure — the caller
 * (the produce stage) applies fill-only-if-empty.
 */

export interface ArticleSubstance {
  titleEn: string;
  topic: string;
  targetQuery: string;
  bodyEn: string;
}

export interface ArticlePackaging {
  slug: string;
  description: string;
  readingTime: string;
  keywords: string[];
  topicTag: string;
  ogImageUrl: string;
}

const DEFAULT_OG_IMAGE_URL = "https://engineerdad.my/assets/og-default.png";
const ARTICLE_DESCRIPTION_MAX = 200;

/** Drop emphasis/heading/code marks; keep link text, drop the URL. */
function stripMarkdown(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [text](url) → text
    .replace(/[*_#`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function deriveArticlePackaging(a: ArticleSubstance): ArticlePackaging {
  return {
    slug: slugify(a.titleEn) || slugify(a.topic),
    description: truncateAtWord(stripMarkdown(a.bodyEn), ARTICLE_DESCRIPTION_MAX),
    readingTime: readingTime(a.bodyEn),
    keywords: extractKeywords(a.targetQuery, a.topic),
    topicTag: topicTag(a.topic),
    ogImageUrl: DEFAULT_OG_IMAGE_URL,
  };
}
