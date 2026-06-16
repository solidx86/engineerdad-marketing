import { describe, it, expect } from "vitest";
import { chunkFile } from "./chunk.js";

describe("chunkFile lang-section split", () => {
  it("routes ## English / ## Bahasa Malaysia sections to per-lang chunks", () => {
    const md = `# Title

## English

This is English content about disclaimers and unit trust funds.

## Bahasa Malaysia

Ini adalah kandungan dalam Bahasa Melayu mengenai amanah saham.
`;
    const chunks = chunkFile("compliance/sample.md", "compliance", md);
    // 2 lang sections + 1 preamble (# Title) auto-detected
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const langs = new Set(chunks.map((c) => c.lang));
    expect(langs.has("en")).toBe(true);
    expect(langs.has("ms")).toBe(true);
    const enWithBody = chunks.find((c) => c.lang === "en" && c.text.includes("English content"));
    expect(enWithBody).toBeDefined();
    const ms = chunks.find((c) => c.lang === "ms")!;
    expect(ms.text).toContain("Bahasa Melayu");
  });
});

import { stripVtt } from "./extract.js";

describe("stripVtt", () => {
  it("strips WEBVTT header, cue numbers, and timestamps", () => {
    const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
Welcome to the show.

2
00:00:04.500 --> 00:00:07.000
Today we talk about <c.bold>compounding</c.bold>.
`;
    const out = stripVtt(vtt);
    expect(out).toContain("Welcome to the show.");
    expect(out).toContain("Today we talk about compounding.");
    expect(out).not.toContain("WEBVTT");
    expect(out).not.toContain("00:00:01");
    expect(out).not.toContain("<c.bold>");
  });
});

describe("chunkFile with frontmatter + knowledge scope", () => {
  it("attaches frontmatter fields to every chunk produced from a file", () => {
    const text = `## English

This is the English body which is long enough to chunk.`;
    const chunks = chunkFile("knowledge/test.md", "knowledge", text, undefined, {
      cluster: "mechanics",
      granularity: "concept",
      source_type: "public",
    });
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.scope).toBe("knowledge");
      expect(c.cluster).toBe("mechanics");
      expect(c.granularity).toBe("concept");
      expect(c.source_type).toBe("public");
    }
  });

  it("omits frontmatter fields when not provided", () => {
    const chunks = chunkFile("compliance/x.md", "compliance", "## English\n\nbody");
    expect(chunks[0]?.cluster).toBeUndefined();
    expect(chunks[0]?.granularity).toBeUndefined();
  });
});
