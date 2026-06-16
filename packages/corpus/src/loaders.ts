import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Chunk } from "./chunk.js";
import type { BM25Index } from "./bm25.js";
import { BM25_PATH, CHUNKS_PATH } from "./paths.js";

let cachedChunks: Chunk[] | undefined;
let cachedIndex: BM25Index | undefined;

export async function loadChunks(): Promise<Chunk[]> {
  if (cachedChunks) return cachedChunks;
  if (!existsSync(CHUNKS_PATH)) return (cachedChunks = []);
  const raw = await readFile(CHUNKS_PATH, "utf8");
  cachedChunks = raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Chunk);
  return cachedChunks;
}

export async function loadIndex(): Promise<BM25Index> {
  if (cachedIndex) return cachedIndex;
  if (!existsSync(BM25_PATH)) {
    return (cachedIndex = {
      docCount: 0,
      avgDocLen: 0,
      postings: {},
      docLens: {},
      docFreq: {},
    });
  }
  cachedIndex = JSON.parse(await readFile(BM25_PATH, "utf8")) as BM25Index;
  return cachedIndex;
}

export function resetCorpusCache(): void {
  cachedChunks = undefined;
  cachedIndex = undefined;
}
