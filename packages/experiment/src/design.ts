export interface Factor {
  name: string;
  levels: string[];
}

export interface DesignInput {
  hypothesis: string;
  factors: Factor[];
  hold_constant: string[];
  primary_metric: "cpa" | "hook_rate" | "thumbstop" | "ctr";
  daily_budget_myr: number;
  duration_days: number;
}

export interface DesignCell {
  cell_id: string;
  factor_levels: Record<string, string>;
  allocation_pct: number;
  bucket_label: "70" | "20" | "10";
}

export interface DesignOutput {
  hypothesis: string;
  primary_metric: string;
  cells: DesignCell[];
  total_budget_myr: number;
  min_creatives_needed: number;
  notes: string[];
}

const MIN_CREATIVES_PER_CELL = 3;

export function design(input: DesignInput): DesignOutput {
  if (input.factors.length === 0) throw new Error("factors must be non-empty");
  for (const f of input.factors) {
    if (f.levels.length === 0) throw new Error(`factor '${f.name}' has no levels`);
  }
  const cells = expandFactorial(input.factors);
  const total = input.daily_budget_myr * input.duration_days;
  const labeled = label70_20_10(cells);
  const minCreatives = labeled.length * MIN_CREATIVES_PER_CELL;
  const notes = [
    `factorial expansion: ${labeled.length} cell(s) across ${input.factors.length} factor(s)`,
    `70/20/10 split: ${labeled.filter((c) => c.bucket_label === "70").length}/${labeled.filter((c) => c.bucket_label === "20").length}/${labeled.filter((c) => c.bucket_label === "10").length}`,
    `min creatives needed = cells × ${MIN_CREATIVES_PER_CELL} = ${minCreatives}`,
    `hold constant: ${input.hold_constant.length > 0 ? input.hold_constant.join(", ") : "(none)"}`,
  ];
  return {
    hypothesis: input.hypothesis,
    primary_metric: input.primary_metric,
    cells: labeled,
    total_budget_myr: round2(total),
    min_creatives_needed: minCreatives,
    notes,
  };
}

function expandFactorial(factors: Factor[]): Array<{
  cell_id: string;
  factor_levels: Record<string, string>;
}> {
  let acc: Array<Record<string, string>> = [{}];
  for (const f of factors) {
    const next: Array<Record<string, string>> = [];
    for (const a of acc) {
      for (const lv of f.levels) next.push({ ...a, [f.name]: lv });
    }
    acc = next;
  }
  return acc.map((levels, i) => ({
    cell_id: `cell_${String(i + 1).padStart(2, "0")}`,
    factor_levels: levels,
  }));
}

function label70_20_10(cells: Array<{ cell_id: string; factor_levels: Record<string, string> }>): DesignCell[] {
  const n = cells.length;
  const q1 = Math.max(1, Math.ceil(n / 4));
  const q3 = Math.max(q1 + 1, Math.ceil((n * 3) / 4));
  const tier1 = q1;
  const tier2 = Math.max(1, q3 - q1);
  const tier3 = Math.max(0, n - tier1 - tier2);
  const tier1Each = tier1 > 0 ? 70 / tier1 : 0;
  const tier2Each = tier2 > 0 ? 20 / tier2 : 0;
  const tier3Each = tier3 > 0 ? 10 / tier3 : 0;

  return cells.map((c, idx) => {
    let bucket: "70" | "20" | "10";
    let pct: number;
    if (idx < tier1) {
      bucket = "70";
      pct = tier1Each;
    } else if (idx < tier1 + tier2) {
      bucket = "20";
      pct = tier2Each;
    } else {
      bucket = "10";
      pct = tier3Each;
    }
    return { ...c, bucket_label: bucket, allocation_pct: round2(pct) };
  });
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
