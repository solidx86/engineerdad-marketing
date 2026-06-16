import type { Lang } from "./tokenize.js";
import { tokenize } from "./tokenize.js";

export interface BM25Doc {
  chunk_id: string;
  tokens: string[];
}

export interface BM25Index {
  docCount: number;
  avgDocLen: number;
  // term -> [chunk_id, tf][]
  postings: Record<string, Array<[string, number]>>;
  // chunk_id -> doc length
  docLens: Record<string, number>;
  // term -> doc frequency
  docFreq: Record<string, number>;
}

const K1 = 1.5;
const B = 0.75;

export function buildIndex(docs: BM25Doc[]): BM25Index {
  const postings: Record<string, Array<[string, number]>> = {};
  const docLens: Record<string, number> = {};
  const docFreq: Record<string, number> = {};
  let totalLen = 0;
  for (const d of docs) {
    docLens[d.chunk_id] = d.tokens.length;
    totalLen += d.tokens.length;
    const tf: Record<string, number> = {};
    for (const t of d.tokens) tf[t] = (tf[t] ?? 0) + 1;
    for (const [term, count] of Object.entries(tf)) {
      (postings[term] ??= []).push([d.chunk_id, count]);
      docFreq[term] = (docFreq[term] ?? 0) + 1;
    }
  }
  const avgDocLen = docs.length > 0 ? totalLen / docs.length : 0;
  return { docCount: docs.length, avgDocLen, postings, docLens, docFreq };
}

export function search(
  index: BM25Index,
  query: string,
  lang: Lang,
  k = 10,
  filter?: (chunkId: string) => boolean,
): Array<{ chunk_id: string; score: number }> {
  if (index.docCount === 0) return [];
  const terms = tokenize(query, lang);
  const scores: Record<string, number> = {};
  for (const term of terms) {
    const posting = index.postings[term];
    if (!posting) continue;
    const idf = Math.log(
      1 + (index.docCount - posting.length + 0.5) / (posting.length + 0.5),
    );
    for (const [chunkId, tf] of posting) {
      if (filter && !filter(chunkId)) continue;
      const dl = index.docLens[chunkId] ?? 0;
      const norm = 1 - B + B * (dl / (index.avgDocLen || 1));
      const score = (idf * (tf * (K1 + 1))) / (tf + K1 * norm);
      scores[chunkId] = (scores[chunkId] ?? 0) + score;
    }
  }
  return Object.entries(scores)
    .map(([chunk_id, score]) => ({ chunk_id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
