import { readdir, mkdir, writeFile, stat, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { CHUNKS_PATH, BM25_PATH, CORPUS_DIR, INDEX_DIR } from "./paths.js";
import { extractText } from "./extract.js";
import { chunkFile, type Chunk } from "./chunk.js";
import { parseFrontmatter, stripFrontmatter } from "./frontmatter.js";
import { buildIndex } from "./bm25.js";
import { tokenize } from "./tokenize.js";

const ALLOWED_EXTS = new Set([".md", ".txt", ".vtt", ".pdf"]);

async function walk(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function scopeFromPath(file: string): Chunk["scope"] {
  const rel = relative(CORPUS_DIR, file).split(sep);
  const top = rel[0] ?? "";
  if (top === "compliance" || top === "courses" || top === "proof" || top === "knowledge") {
    return top;
  }
  return "other";
}

export interface ReindexResult {
  files: number;
  chunks: number;
  skipped: Array<{ file: string; reason: string }>;
}

export async function reindex(): Promise<ReindexResult> {
  if (!existsSync(CORPUS_DIR)) {
    await mkdir(CORPUS_DIR, { recursive: true });
  }
  await mkdir(INDEX_DIR, { recursive: true });

  const files = await walk(CORPUS_DIR);
  const skipped: ReindexResult["skipped"] = [];
  const allChunks: Chunk[] = [];

  for (const f of files) {
    const ext = f.slice(f.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      skipped.push({ file: f, reason: `unsupported extension ${ext}` });
      continue;
    }
    try {
      const s = await stat(f);
      if (s.size === 0) {
        skipped.push({ file: f, reason: "empty file" });
        continue;
      }
      let text: string;
      let frontmatter: ReturnType<typeof parseFrontmatter> | undefined;
      if (ext === ".md") {
        const raw = await readFile(f, "utf8");
        if (!raw.trim()) {
          skipped.push({ file: f, reason: "empty file" });
          continue;
        }
        frontmatter = parseFrontmatter(raw);
        text = stripFrontmatter(raw);
      } else {
        text = await extractText(f);
      }
      if (!text.trim()) {
        skipped.push({ file: f, reason: "no extractable text" });
        continue;
      }
      const scope = scopeFromPath(f);
      const rel = relative(CORPUS_DIR, f);
      const chunks = chunkFile(rel, scope, text, undefined, frontmatter);
      allChunks.push(...chunks);
    } catch (err) {
      skipped.push({ file: f, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  // Write chunks.jsonl
  const lines = allChunks.map((c) => JSON.stringify(c)).join("\n");
  await writeFile(CHUNKS_PATH, lines + (lines ? "\n" : ""), "utf8");

  // Build BM25 over tokenized chunks
  const docs = allChunks.map((c) => ({ chunk_id: c.chunk_id, tokens: tokenize(c.text, c.lang) }));
  const index = buildIndex(docs);
  await writeFile(BM25_PATH, JSON.stringify(index), "utf8");

  return { files: files.length, chunks: allChunks.length, skipped };
}
