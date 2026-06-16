export type Lang = "en" | "ms";

export function detectLang(text: string): Lang {
  // crude BM markers; users tag chunks via ## headers in compliance files anyway
  const bmHits = /\b(yang|untuk|adalah|tidak|dengan|kepada|akan|melibatkan|risiko|pelaburan|bukan)\b/i.test(
    text,
  );
  if (bmHits && !/\b(the|and|for|are|with|that|this)\b/i.test(text)) return "ms";
  return "en";
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "is", "are",
  "was", "were", "be", "been", "by", "with", "as", "at", "this", "that", "it",
  "yang", "dan", "atau", "dengan", "untuk", "ialah", "adalah", "ini", "itu",
]);

export function tokenize(text: string, _lang: Lang): string[] {
  const lower = text.toLowerCase();
  const words = lower.match(/[a-z][a-z0-9'-]*/g) ?? [];
  return words.filter((w) => w.length > 1 && !STOPWORDS.has(w));
}
