import { describe, it, expect } from "vitest";
import { fvAnnuity, requiredPmt, buildCompoundingTable, buildMonthlyContributionTable } from "./build-derivative-tables.mjs";

describe("fvAnnuity", () => {
  it("returns 0 for 0 contributions", () => {
    expect(fvAnnuity(0, 0.08, 10)).toBe(0);
  });
  it("matches the known FV of an annuity formula", () => {
    // FV = PMT * (((1+r/12)^(n*12) - 1) / (r/12))
    // PMT=100/mo, r=0.08, n=10 → ~RM18,294
    const v = fvAnnuity(100, 0.08, 10);
    expect(v).toBeGreaterThan(18000);
    expect(v).toBeLessThan(18600);
  });
});

describe("requiredPmt", () => {
  it("inverse of fvAnnuity", () => {
    const fv = fvAnnuity(250, 0.08, 20);
    const pmt = requiredPmt(fv, 0.08, 20);
    expect(pmt).toBeCloseTo(250, 0);
  });
});

describe("buildCompoundingTable", () => {
  it("returns rows for the spec grid", () => {
    const t = buildCompoundingTable();
    expect(t.assumption_source).toMatch(/epf-sustainability-model/);
    expect(t.rows.length).toBeGreaterThan(0);
    const sample = t.rows.find(r => r.rate === 0.08 && r.years === 20 && r.monthly_pmt === 500);
    expect(sample).toBeDefined();
    expect(sample.fv).toBeGreaterThan(0);
  });
});

describe("buildMonthlyContributionTable", () => {
  it("returns rows keyed by target FV / years / rate", () => {
    const t = buildMonthlyContributionTable();
    const sample = t.rows.find(r => r.target_fv === 500000 && r.years === 20 && r.rate === 0.08);
    expect(sample).toBeDefined();
    expect(sample.monthly_pmt).toBeGreaterThan(0);
  });
});
