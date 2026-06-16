import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function findRepoRoot(): string {
  let cur = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(resolve(cur, "pnpm-workspace.yaml"))) {
    const parent = dirname(cur);
    if (parent === cur) throw new Error("repo root not found");
    cur = parent;
  }
  return cur;
}

export const REPO_ROOT = findRepoRoot();

const ROOT = process.env["CORPUS_DIR"] ?? join(process.cwd(), "corpus");
export const CORPUS_DIR = ROOT;
export const INDEX_DIR = join(CORPUS_DIR, ".index");
export const CHUNKS_PATH = join(INDEX_DIR, "chunks.jsonl");
export const BM25_PATH = join(INDEX_DIR, "bm25.json");
// ADR-030 two-layer data model: derived chart specs (YAML, one visualization
// each) vs source-of-record datasets (JSON facts). Charts are read by path,
// never BM25-indexed.
export const CHARTS_DIR = join(CORPUS_DIR, "data", "charts");
export const DATASETS_DIR = join(CORPUS_DIR, "data", "datasets");
