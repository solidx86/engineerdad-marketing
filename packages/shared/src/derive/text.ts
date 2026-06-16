/** kebab-case slug: lowercase, alphanumerics joined by single hyphens, trimmed. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Truncate to at most `max` chars, preferring the last word boundary. */
export function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

/** Estimated reading time at 250 wpm, e.g. "3 min read" (minimum 1 minute). */
export function readingTime(body: string): string {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.ceil(words / 250));
  return `${minutes} min read`;
}

const TOPIC_TAG_STOPWORDS = new Set([
  "how", "to", "why", "what", "is", "should", "i", "the", "a", "an",
  "set", "up", "start", "begin", "learn", "understand", "and", "or", "in", "of", "for",
]);

/** Short uppercase category chip from a topic line, capped at 60 chars. */
export function topicTag(topic: string): string {
  const kept = topic
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !TOPIC_TAG_STOPWORDS.has(w.toLowerCase()));
  let tag = kept.join(" ");
  while (tag.length > 60 && tag.includes(" ")) {
    tag = tag.slice(0, tag.lastIndexOf(" "));
  }
  return tag.slice(0, 60);
}

const KEYWORD_STOPWORDS = new Set([
  "the", "a", "an", "is", "to", "for", "of", "and", "or", "in", "on", "with",
  "how", "what", "why", "do", "i",
]);

/** Deduped lowercase keywords from a target query plus up to 3 from the topic, capped at 10. */
export function extractKeywords(targetQuery: string, topic: string): string[] {
  const tokenize = (s: string): string[] =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const fromQuery = tokenize(targetQuery).filter((w) => !KEYWORD_STOPWORDS.has(w));
  const fromTopic = tokenize(topic).filter((w) => !KEYWORD_STOPWORDS.has(w)).slice(0, 3);
  const out: string[] = [];
  for (const w of [...fromQuery, ...fromTopic]) {
    if (!out.includes(w)) out.push(w);
  }
  return out.slice(0, 10);
}
