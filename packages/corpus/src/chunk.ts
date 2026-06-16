import type { Lang } from "./tokenize.js";
import type { CorpusFrontmatter } from "./frontmatter.js";
import { detectLang } from "./tokenize.js";

export interface Chunk {
  chunk_id: string;
  file: string;
  scope: "compliance" | "courses" | "proof" | "knowledge" | "other";
  lang: Lang;
  text: string;
  source_label?: string;
  cluster?: CorpusFrontmatter["cluster"];
  funnel_tier?: CorpusFrontmatter["funnel_tier"];
  granularity?: CorpusFrontmatter["granularity"];
  source_type?: CorpusFrontmatter["source_type"];
  source_ref?: string;
  verified_at?: string;
  related?: string[];
  lang_status?: CorpusFrontmatter["lang_status"];
}

const TARGET = 800;
const OVERLAP = 100;

/**
 * Split a markdown body by `## ` headers when those headers explicitly mark a
 * language section (English / Bahasa Malaysia). Otherwise return the
 * whole body as a single section with auto-detected lang.
 */
function splitByLangSection(text: string): Array<{ lang: Lang; text: string }> {
  const lines = text.split(/\r?\n/);
  const sections: Array<{ lang: Lang | null; lines: string[] }> = [
    { lang: null, lines: [] },
  ];
  const HEADER_RE = /^##\s+(.+?)\s*$/;
  for (const line of lines) {
    const m = HEADER_RE.exec(line);
    if (m) {
      const head = m[1]!.toLowerCase();
      let lang: Lang | null = null;
      if (/(english|en\b)/i.test(head)) lang = "en";
      else if (/(bahasa\s*malaysia|melayu|bm\b|ms\b)/i.test(head)) lang = "ms";
      if (lang !== null) {
        sections.push({ lang, lines: [] });
        continue;
      }
    }
    sections[sections.length - 1]!.lines.push(line);
  }
  const taggedSections = sections
    .filter((s) => s.lines.join("").trim().length > 0)
    .map((s) => {
      const text = s.lines.join("\n").trim();
      const lang = s.lang ?? detectLang(text);
      return { lang, text };
    });
  return taggedSections;
}

/** Tokens here are word-ish for EN/BM. Approximate. */
function approxLength(text: string, _lang: Lang): number {
  return (text.match(/\S+/g) ?? []).length;
}

function sliceByLength(text: string, lang: Lang, target: number, overlap: number): string[] {
  const length = approxLength(text, lang);
  if (length <= target) return [text];
  // EN/BM: split by paragraphs, then pack
  const paras = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let buf: string[] = [];
  let buflen = 0;
  for (const p of paras) {
    const plen = approxLength(p, lang);
    if (buflen + plen > target && buf.length > 0) {
      chunks.push(buf.join("\n\n"));
      // overlap: keep tail of previous buffer
      const tail = buf.slice(-1).join("\n\n");
      buf = tail ? [tail] : [];
      buflen = approxLength(tail, lang);
    }
    buf.push(p);
    buflen += plen;
  }
  if (buf.length > 0) chunks.push(buf.join("\n\n"));
  return chunks;
}

export function chunkFile(
  file: string,
  scope: Chunk["scope"],
  text: string,
  sourceLabel?: string,
  frontmatter?: CorpusFrontmatter,
): Chunk[] {
  const sections = splitByLangSection(text);
  const out: Chunk[] = [];
  let counter = 0;
  for (const sec of sections) {
    const slices = sliceByLength(sec.text, sec.lang, TARGET, OVERLAP);
    for (const slice of slices) {
      const trimmed = slice.trim();
      if (!trimmed) continue;
      out.push({
        chunk_id: `${file}#${counter++}`,
        file,
        scope,
        lang: sec.lang,
        text: trimmed,
        source_label: sourceLabel,
        cluster: frontmatter?.cluster,
        funnel_tier: frontmatter?.funnel_tier,
        granularity: frontmatter?.granularity,
        source_type: frontmatter?.source_type,
        source_ref: frontmatter?.source_ref,
        verified_at: frontmatter?.verified_at,
        related: frontmatter?.related,
        lang_status: frontmatter?.lang_status,
      });
    }
  }
  return out;
}
