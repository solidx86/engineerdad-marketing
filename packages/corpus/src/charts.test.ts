import { describe, expect, it } from "vitest";
import { parseChartYaml, loadChart, loadAllCharts } from "./charts.js";
import { tracesTo } from "@engineerdad/shared";

const INFLATION_YAML = `
id: inflation-vs-savings-real-value
title_en: "RM100,000 in a 2% savings account — nominal vs real value over 18 years"
title_ms: "RM100,000 dalam akaun simpanan 2% — nilai nominal vs nilai sebenar selama 18 tahun"
chart_type: line
labels: [0, 5, 10, 15, 18]
series:
  - name_en: "Real value"
    values: [100000, 86000, 75000, 65000, 59000]
  - name_en: "Nominal value"
    values: [100000, 110000, 122000, 135000, 143000]
caption_en: "Your statement shows RM143,000 at year 18. What it buys is RM59,000 — a ~41% loss."
caption_ms: "Penyata anda menunjukkan RM143,000."
source_citation: "RM100,000 × (1.02)^t."
`;

describe("parseChartYaml", () => {
  const meta = parseChartYaml(INFLATION_YAML, "fallback-id");

  it("extracts id, chart_type, bilingual title", () => {
    expect(meta.id).toBe("inflation-vs-savings-real-value");
    expect(meta.chartType).toBe("line");
    expect(meta.title.en).toContain("RM100,000");
    expect(meta.title.ms).toContain("RM100,000");
  });

  it("uses caption_en as the scenario headline", () => {
    expect(meta.scenario).toContain("41% loss");
  });

  it("builds a trace haystack from labels, series values, and caption", () => {
    // series values
    expect(meta.traceNumbers).toContain(59000);
    expect(meta.traceNumbers).toContain(143000);
    // labels
    expect(meta.traceNumbers).toContain(18);
    // derived percentage parsed from the caption text
    expect(meta.traceNumbers).toContain(0.41);
  });

  it("the haystack lets real figures trace and absent ones fail", () => {
    expect(tracesTo("RM59,000", meta.traceNumbers)).toBe(true);
    expect(tracesTo("41%", meta.traceNumbers)).toBe(true);
    expect(tracesTo("RM1.2M", meta.traceNumbers)).toBe(false);
  });

  it("falls back to the file stem when YAML omits id", () => {
    expect(parseChartYaml("title_en: x\ntitle_ms: y\n", "my-stem").id).toBe("my-stem");
  });
});

describe("loadChart / loadAllCharts (real corpus YAMLs)", () => {
  it("loads a known chart by id", async () => {
    const meta = await loadChart("inflation-vs-savings-real-value");
    expect(meta).not.toBeNull();
    expect(meta?.id).toBe("inflation-vs-savings-real-value");
    expect(tracesTo("RM59,000", meta!.traceNumbers)).toBe(true);
  });

  it("returns null for a non-existent chart", async () => {
    expect(await loadChart("no-such-chart-xyz")).toBeNull();
  });

  it("lists every chart in corpus/data/charts, sorted, with non-empty ids", async () => {
    const all = await loadAllCharts();
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(all.every((c) => c.id.length > 0)).toBe(true);
    const ids = all.map((c) => c.id);
    expect([...ids].sort()).toEqual(ids);
  });
});
