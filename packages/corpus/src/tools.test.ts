import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getComplianceBlock, listCharts } from "./tools.js";

describe("listCharts (ADR-030)", () => {
  it("lists every chart with picker fields + a figures haystack", async () => {
    const { charts } = await listCharts();
    expect(charts.length).toBeGreaterThanOrEqual(10);
    const inflation = charts.find((c) => c.id === "inflation-vs-savings-real-value");
    expect(inflation).toBeDefined();
    expect(inflation!.title.en).toContain("RM100,000");
    expect(inflation!.scenario).toContain("41% loss");
    expect(inflation!.figures).toContain(59000);
  });

  it("filters to a single chart by id", async () => {
    const { charts } = await listCharts({ id: "inflation-vs-savings-real-value" });
    expect(charts).toHaveLength(1);
    expect(charts[0]!.id).toBe("inflation-vs-savings-real-value");
  });

  it("returns [] for an unknown id", async () => {
    const { charts } = await listCharts({ id: "no-such-chart-xyz" });
    expect(charts).toEqual([]);
  });
});

describe("getComplianceBlock", () => {
  it("merges all three regulator files for EN by default", async () => {
    const out = await getComplianceBlock({ lang: "en" });
    expect(out.sources_included).toEqual(expect.arrayContaining(["sc", "fimm", "public-mutual"]));
    expect(out.markdown).toContain("Securities Commission Malaysia");
    expect(out.markdown).toContain("FIMM");
    expect(out.markdown).toContain("Public Mutual");
    expect(out.markdown).toContain("Past performance");
  });

  it("scopes to a single source when requested", async () => {
    const out = await getComplianceBlock({ lang: "en", sources: ["fimm"] });
    expect(out.sources_included).toEqual(["fimm"]);
    expect(out.markdown).toContain("FIMM");
    expect(out.markdown).not.toContain("Securities Commission Malaysia");
  });

  it("returns the BM section for lang=ms", async () => {
    const out = await getComplianceBlock({ lang: "ms", sources: ["sc"] });
    expect(out.markdown).toContain("Penafian");
    expect(out.markdown).toMatch(/Pelabur dinasihatkan/);
  });
});

describe("search with frontmatter filters", () => {
  let tmp: string;
  let originalCorpus: string | undefined;

  beforeEach(async () => {
    const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    vi.resetModules();
    tmp = await mkdtemp(join(tmpdir(), "corpus-tools-filter-"));
    originalCorpus = process.env["CORPUS_DIR"];
    process.env["CORPUS_DIR"] = tmp;
    await mkdir(join(tmp, "knowledge"), { recursive: true });
    await writeFile(
      join(tmp, "knowledge", "switching.md"),
      `---
cluster: mechanics
granularity: concept
source_type: public
---

## English

Switching funds inside PMB uses the intra-family route to avoid double sales charges.`,
      "utf8",
    );
    await writeFile(
      join(tmp, "knowledge", "prs-scenario.md"),
      `---
cluster: tax
granularity: fund
source_type: synthesized
---

## English

PRS relief scenario: a parent contributing RM3000 per year saves tax.`,
      "utf8",
    );
    await writeFile(
      join(tmp, "knowledge", "affordability.md"),
      `---
cluster: objection
funnel_tier: necessity
granularity: concept
source_type: public
---

## English

Many parents worry they cannot afford to invest for their children's future.`,
      "utf8",
    );
    const { reindex } = await import("./reindex.js");
    const { resetCorpusCache } = await import("./loaders.js");
    resetCorpusCache();
    await reindex();
    resetCorpusCache();
  });

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    const { resetCorpusCache } = await import("./loaders.js");
    vi.resetModules();
    if (originalCorpus === undefined) delete process.env["CORPUS_DIR"];
    else process.env["CORPUS_DIR"] = originalCorpus;
    resetCorpusCache();
    await rm(tmp, { recursive: true, force: true });
  });

  it("filters by cluster=mechanics", async () => {
    const { search } = await import("./tools.js");
    const { hits } = await search({ query: "switching PMB", cluster: "mechanics" });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.cluster).toBe("mechanics");
    }
  });

  it("filters by source_type=synthesized", async () => {
    const { search } = await import("./tools.js");
    const { hits } = await search({ query: "PRS relief", source_type: "synthesized" });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.source_type).toBe("synthesized");
    }
  });

  it("filters by granularity=fund", async () => {
    const { search } = await import("./tools.js");
    const { hits } = await search({ query: "parent contributing", granularity: "fund" });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.granularity).toBe("fund");
    }
  });

  it("filters by funnel_tier=necessity", async () => {
    const { search } = await import("./tools.js");
    const { hits } = await search({ query: "afford", funnel_tier: "necessity" });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.funnel_tier).toBe("necessity");
    }
  });
});
