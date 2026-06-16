#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Canonical assumptions — keep in sync with corpus/courses/epf-sustainability-model.md
const ASSUMPTION_SOURCE = "corpus/courses/epf-sustainability-model.md";

const RATES = [0.06, 0.07, 0.08, 0.10];
const YEARS = [5, 10, 15, 20, 25, 30, 35];
const PMTS = [100, 200, 300, 500, 750, 1000, 1500, 2000];
const TARGET_FVS = [50_000, 100_000, 200_000, 300_000, 500_000, 750_000, 1_000_000, 1_500_000];

export function fvAnnuity(monthlyPmt, annualRate, years) {
  if (monthlyPmt === 0) return 0;
  const r = annualRate / 12;
  const n = years * 12;
  if (r === 0) return monthlyPmt * n;
  return monthlyPmt * ((Math.pow(1 + r, n) - 1) / r);
}

export function requiredPmt(targetFv, annualRate, years) {
  if (targetFv === 0) return 0;
  const r = annualRate / 12;
  const n = years * 12;
  if (r === 0) return targetFv / n;
  return targetFv * r / (Math.pow(1 + r, n) - 1);
}

export function buildCompoundingTable() {
  const rows = [];
  for (const rate of RATES) for (const years of YEARS) for (const pmt of PMTS) {
    rows.push({ rate, years, monthly_pmt: pmt, fv: Math.round(fvAnnuity(pmt, rate, years)) });
  }
  return {
    generated_at: new Date().toISOString(),
    assumption_source: ASSUMPTION_SOURCE,
    grid: { rates: RATES, years: YEARS, monthly_pmts: PMTS },
    rows,
  };
}

export function buildMonthlyContributionTable() {
  const rows = [];
  for (const target_fv of TARGET_FVS) for (const years of YEARS) for (const rate of RATES) {
    rows.push({ target_fv, years, rate, monthly_pmt: Math.round(requiredPmt(target_fv, rate, years)) });
  }
  return {
    generated_at: new Date().toISOString(),
    assumption_source: ASSUMPTION_SOURCE,
    grid: { target_fvs: TARGET_FVS, years: YEARS, rates: RATES },
    rows,
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const dataDir = path.join(REPO_ROOT, "corpus", "data", "datasets");
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, "compounding-table.json"), JSON.stringify(buildCompoundingTable(), null, 2));
  await fs.writeFile(path.join(dataDir, "monthly-contribution-required.json"), JSON.stringify(buildMonthlyContributionTable(), null, 2));
  console.log("wrote compounding-table.json + monthly-contribution-required.json");
}
