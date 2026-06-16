import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  periodFromFilename,
  findLatestXlsx,
  parseFundMaster,
  buildJsonSnapshot,
  computeUniverseStats,
  computeRotation,
  renderUniverseStatsMd,
  renderRotationMd,
  generateArtifacts,
} from "./refresh-funds-corpus.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures", "funds-fixture.xlsx");
const PERIOD = { display: "Apr 2026", slug: "apr2026" };

describe("periodFromFilename", () => {
  it("parses the Mon+YYYY token into display + slug", () => {
    expect(periodFromFilename("PublicMutual_FundMaster_Apr2026_v1.4.xlsx")).toEqual({
      display: "Apr 2026",
      slug: "apr2026",
    });
  });
  it("works on a full path", () => {
    expect(periodFromFilename("/x/y/PublicMutual_FundMaster_Feb2026_v1.1.xlsx").slug).toBe("feb2026");
  });
  it("throws on an unrecognised filename", () => {
    expect(() => periodFromFilename("random-spreadsheet.xlsx")).toThrow();
  });
});

describe("findLatestXlsx", () => {
  it("returns the most-recent FundMaster xlsx by mtime", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-"));
    fs.writeFileSync(path.join(dir, "PublicMutual_FundMaster_Feb2026_v1.1.xlsx"), "x");
    const newer = path.join(dir, "PublicMutual_FundMaster_Mar2026_v1.4.xlsx");
    fs.writeFileSync(newer, "x");
    const future = new Date(Date.now() + 10_000);
    fs.utimesSync(newer, future, future);
    expect(path.basename(findLatestXlsx(dir))).toBe("PublicMutual_FundMaster_Mar2026_v1.4.xlsx");
  });
  it("throws when no matching file exists", () => {
    expect(() => findLatestXlsx(__dirname)).toThrow();
  });
});

describe("parseFundMaster", () => {
  it("parses every data row from the Master sheet", async () => {
    const funds = await parseFundMaster(FIXTURE);
    expect(funds).toHaveLength(3);
  });
  it("normalises core fields", async () => {
    const funds = await parseFundMaster(FIXTURE);
    const a = funds.find((f) => f.abbr === "FEQA");
    expect(a.name).toBe("FIXTURE EQUITY A");
    expect(a.type).toBe("Equity");
    expect(a.risk_level).toBe(5);
    expect(a.size_rm_m).toBe(100);
    expect(a.qualified).toBe(true);
    expect(a.shariah).toBe(false);
    expect(a.weighted_alpha).toBe(10);
  });
  it("treats a Shariah fund as shariah:true (matches 'Shariah' or 'Shariah-compliant')", async () => {
    const funds = await parseFundMaster(FIXTURE);
    expect(funds.find((f) => f.abbr === "FFIB").shariah).toBe(true);
  });
  it("treats any non-'Qualified' status as qualified:false", async () => {
    const funds = await parseFundMaster(FIXTURE);
    expect(funds.find((f) => f.abbr === "FEQC").qualified).toBe(false);
  });
  it("captures per-period alpha with nulls for missing periods", async () => {
    const funds = await parseFundMaster(FIXTURE);
    const a = funds.find((f) => f.abbr === "FEQA");
    expect(a.alpha).toEqual({ ytd: 2, "1y": 5, "3y": 2, "5y": null, "10y": null });
    const b = funds.find((f) => f.abbr === "FFIB");
    expect(b.alpha).toEqual({ ytd: 0.2, "1y": 0.3, "3y": 0.5, "5y": 0.3, "10y": null });
  });
  it("computes alpha efficiency as period alpha / VF", async () => {
    const funds = await parseFundMaster(FIXTURE);
    const a = funds.find((f) => f.abbr === "FEQA"); // VF = 0.1
    expect(a.alpha_efficiency.ytd).toBeCloseTo(20); // 2 / 0.1
    expect(a.alpha_efficiency["3y"]).toBeCloseTo(20); // 2 / 0.1
    expect(a.alpha_efficiency["5y"]).toBeNull();
  });
  it("captures allocation / geo / sector blocks", async () => {
    const funds = await parseFundMaster(FIXTURE);
    const a = funds.find((f) => f.abbr === "FEQA");
    expect(a.allocation.dom_equity).toBe(80);
    expect(a.allocation.for_equity).toBe(15);
    expect(a.geo.usa).toBe(30);
    expect(a.geo.china).toBe(20);
    expect(a.sector.industrial).toBe(20);
    expect(a.sector.technology).toBe(15);
  });
  it("splits top holdings into an array", async () => {
    const funds = await parseFundMaster(FIXTURE);
    expect(funds.find((f) => f.abbr === "FEQA").top_holdings).toEqual(["Top1", "Top2"]);
  });
  it("captures drawdown + ATH date", async () => {
    const funds = await parseFundMaster(FIXTURE);
    const a = funds.find((f) => f.abbr === "FEQA");
    expect(a.drawdown_pct).toBe(-20);
    expect(a.ath_date).toBe("2024-12-31");
  });
});

describe("buildJsonSnapshot", () => {
  it("produces the item-10 shape", async () => {
    const funds = await parseFundMaster(FIXTURE);
    const snap = buildJsonSnapshot(funds, {
      period: PERIOD,
      sourceFile: "PublicMutual_FundMaster_Apr2026_v1.4.xlsx",
      generatedAt: "2026-05-21T00:00:00.000Z",
    });
    expect(snap.snapshot_period).toBe("Apr 2026");
    expect(snap.source_file).toBe("PublicMutual_FundMaster_Apr2026_v1.4.xlsx");
    expect(snap.generated_at).toBe("2026-05-21T00:00:00.000Z");
    expect(snap.compliance_note).toMatch(/facts only/i);
    expect(snap.funds).toHaveLength(3);
    const a = snap.funds.find((f) => f.abbr === "FEQA");
    expect(a).toMatchObject({ name: "FIXTURE EQUITY A", risk_level: 5, qualified: true });
    expect(a.alpha).toEqual({ ytd: 2, "1y": 5, "3y": 2, "5y": null, "10y": null });
    expect(a.allocation.dom_equity).toBe(80);
    expect(a.geo.usa).toBe(30);
    expect(a.sector.industrial).toBe(20);
  });
});

describe("computeUniverseStats", () => {
  it("computes headline counts", async () => {
    const funds = await parseFundMaster(FIXTURE);
    const s = computeUniverseStats(funds);
    expect(s.total).toBe(3);
    expect(s.qualified).toBe(2);
  });
  it("computes per-category breakdown with median weighted alpha", async () => {
    const funds = await parseFundMaster(FIXTURE);
    const s = computeUniverseStats(funds);
    const eq = s.by_category.find((c) => c.category === "Equity");
    expect(eq.total).toBe(2);
    expect(eq.qualified).toBe(1);
    expect(eq.median_weighted_alpha).toBeCloseTo(3.5); // median(10, -3)
  });
  it("computes the positive 3-year alpha share", async () => {
    const funds = await parseFundMaster(FIXTURE);
    const s = computeUniverseStats(funds);
    expect(s.positive_3y_alpha.count).toBe(2);
    expect(s.positive_3y_alpha.of).toBe(3);
  });
});

describe("computeRotation", () => {
  it("ranks sectors across qualified funds, excluding the Other bucket", async () => {
    const funds = await parseFundMaster(FIXTURE);
    const r = computeRotation(funds);
    expect(r.qualified_basis).toBe(2);
    expect(r.top_sectors.length).toBeGreaterThan(0);
    expect(r.top_sectors.length).toBeLessThanOrEqual(5);
    expect(r.top_sectors.every((s) => !/other/i.test(s.name))).toBe(true);
    expect(r.top_sectors[0].name).toBe("Industrial");
  });
  it("ranks geographies", async () => {
    const funds = await parseFundMaster(FIXTURE);
    const r = computeRotation(funds);
    expect(r.top_geos.length).toBeGreaterThan(0);
    expect(r.top_geos.length).toBeLessThanOrEqual(5);
  });
  it("counts top-holding frequency across qualified funds", async () => {
    const funds = await parseFundMaster(FIXTURE);
    const r = computeRotation(funds);
    const top1 = r.top_holdings.find((h) => h.name === "Top1");
    expect(top1.fund_count).toBe(2);
  });
});

describe("renderUniverseStatsMd", () => {
  it("renders dated frontmatter and the headline", async () => {
    const funds = await parseFundMaster(FIXTURE);
    const md = renderUniverseStatsMd(computeUniverseStats(funds), { period: PERIOD });
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toMatch(/dated_snapshot: true/);
    expect(md).toMatch(/snapshot_period: "Apr 2026"/);
    expect(md).toMatch(/2 of 3/);
    expect(md).toMatch(/## Compliance/);
  });
});

describe("renderRotationMd", () => {
  it("renders dated frontmatter and the rotation sections", async () => {
    const funds = await parseFundMaster(FIXTURE);
    const md = renderRotationMd(computeRotation(funds), { period: PERIOD });
    expect(md).toMatch(/dated_snapshot: true/);
    expect(md).toMatch(/snapshot_period: "Apr 2026"/);
    expect(md).toMatch(/[Ss]ector/);
    expect(md).toMatch(/## Compliance/);
  });
});

describe("generateArtifacts (integration)", () => {
  it("runs the whole pipeline against the fixture", async () => {
    const a = await generateArtifacts(FIXTURE, { period: PERIOD });
    expect(a.snapshot.funds).toHaveLength(3);
    expect(a.universeStatsMd).toMatch(/snapshot_period: "Apr 2026"/);
    expect(a.rotationMd).toMatch(/snapshot_period: "Apr 2026"/);
    expect(a.stats.total).toBe(3);
    expect(a.rotation.qualified_basis).toBe(2);
  });
});
