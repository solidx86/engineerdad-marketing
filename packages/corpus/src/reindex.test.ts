import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("reindex with knowledge scope + frontmatter", () => {
  let tmp: string;
  let originalCorpus: string | undefined;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "corpus-test-"));
    originalCorpus = process.env["CORPUS_DIR"];
    process.env["CORPUS_DIR"] = tmp;
  });

  afterEach(async () => {
    if (originalCorpus === undefined) delete process.env["CORPUS_DIR"];
    else process.env["CORPUS_DIR"] = originalCorpus;
    await rm(tmp, { recursive: true, force: true });
  });

  it("parses knowledge/*.md frontmatter and tags chunks", async () => {
    const { reindex } = await import("./reindex.js");
    const { loadChunks, resetCorpusCache } = await import("./loaders.js");
    resetCorpusCache();
    await mkdir(join(tmp, "knowledge"), { recursive: true });
    await writeFile(
      join(tmp, "knowledge", "switching.md"),
      `---
cluster: mechanics
granularity: concept
source_type: public
source_ref: PMB prospectus 2025
verified_at: 2026-05-29
lang_status: en_only
---

## English

Switching funds inside PMB uses the intra-family route.`,
      "utf8",
    );
    const result = await reindex();
    expect(result.chunks).toBeGreaterThan(0);
    resetCorpusCache();
    const chunks = await loadChunks();
    const k = chunks.find((c) => c.file === "knowledge/switching.md");
    expect(k).toBeDefined();
    expect(k?.scope).toBe("knowledge");
    expect(k?.cluster).toBe("mechanics");
    expect(k?.granularity).toBe("concept");
    expect(k?.source_type).toBe("public");
    expect(k?.text).not.toContain("---");
    expect(k?.text).not.toContain("cluster:");
  });
});
