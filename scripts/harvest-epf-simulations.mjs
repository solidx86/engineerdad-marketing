#!/usr/bin/env node
// harvest-epf-simulations — produces item G (corpus/data/datasets/epf-sustainability-simulations.json):
// a cached snapshot of the live EPF Sustainability Calculator across an input grid.
//
// Boundary discipline (ADR-016): the calculator lives in the engineerdad-site repo.
// This harvester drives it as a runtime artifact over HTTP via the Playwright MCP
// tools — it never imports the calculator's JS source. The in-browser harness
// (see HARVEST PROTOCOL below) executes the calculator's own `calculate()` function;
// it does not re-implement the math.
//
// MCP constraint: the Playwright tools are agent-invoked, not callable from a plain
// node process. So `pnpm harvest:epf` builds + prints the input grid and the harvest
// protocol; the browser drive + final JSON write are performed by the agent in a
// Claude Code session (acceptance criterion explicitly allows this route).
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
export const CALCULATOR_DIR =
  "/Users/solid/Code/engineerdad-site/tools/epf-sustainability-calculator";
export const PORT = 5174;
export const OUTPUT_PATH = path.join(REPO_ROOT, "corpus", "data", "datasets", "epf-sustainability-simulations.json");

// --- Grid definition (mirrors the design spec) -------------------------------
export const AGES = [25, 30, 35, 40, 45, 50, 55];
export const SALARIES = [3000, 5000, 7500, 10000, 15000, 20000];
export const BALANCE_BUCKETS = [0, 0.5, 1.0, 1.5]; // multiples of the RIA benchmark for that age
export const RETIRE_AGES = [55, 60, 65];
export const LIFESTYLES = ["Basic", "Adequate", "Enhanced"];

// The calculator has no Basic/Adequate/Enhanced tier input — it takes a lifestyle
// target as a percentage of current income. We map the three tiers onto that knob:
// Basic = a lean retirement, Adequate = the calculator's own default, Enhanced = full
// income replacement.
export const LIFESTYLE_TO_PCT = { Basic: 50, Adequate: 70, Enhanced: 100 };

// Calculator v1.3.2 form defaults left untouched by the harvest (see
// corpus/courses/epf-sustainability-model.md). The harvest sweeps only the grid axes.
export const CALCULATOR_DEFAULTS = {
  epfDiv: 5,
  salaryGrowth: 3,
  inflation: 4,
  lifeExp: 80,
  employeeContrib: 11,
  postRetireRate: 3,
};

export async function loadRiaBenchmarks() {
  const p = path.join(REPO_ROOT, "corpus", "data", "datasets", "kwsp-ria-benchmarks.json");
  const txt = await fsp.readFile(p, "utf8").catch(() => {
    throw new Error(
      "Item C (kwsp-ria-benchmarks.json) must be authored before running the harvester. See Phase 4.",
    );
  });
  const obj = JSON.parse(txt);
  const map = new Map(obj.tiers.map((t) => [t.age, t.ria_balance_rm]));
  return (age) => {
    const ages = [...map.keys()].sort((a, b) => a - b);
    const fit = ages.filter((a) => a <= age).pop() ?? ages[0];
    return map.get(fit) ?? 0;
  };
}

export function buildInputGrid(riaFor) {
  const tuples = [];
  for (const age of AGES) {
    const ria = riaFor(age);
    for (const salary of SALARIES)
      for (const bucket of BALANCE_BUCKETS)
        for (const retireAge of RETIRE_AGES)
          for (const lifestyle of LIFESTYLES) {
            if (retireAge <= age) continue;
            tuples.push({
              age,
              salary_rm: salary,
              current_epf_rm: Math.round(ria * bucket),
              retire_age: retireAge,
              lifestyle,
              lifestyle_pct: LIFESTYLE_TO_PCT[lifestyle],
            });
          }
  }
  return tuples;
}

export async function assembleOutput(simulations, { calculatorVersion } = {}) {
  return {
    calculator_version: calculatorVersion ?? "unknown",
    harvested_at: new Date().toISOString(),
    calculator_defaults: CALCULATOR_DEFAULTS,
    grid_definition: {
      ages: AGES,
      salaries: SALARIES,
      balance_buckets: BALANCE_BUCKETS,
      retire_ages: RETIRE_AGES,
      lifestyles: LIFESTYLES,
      lifestyle_to_pct: LIFESTYLE_TO_PCT,
    },
    simulations,
  };
}

export async function writeOutput(output) {
  await fsp.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fsp.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n");
  return OUTPUT_PATH;
}

// HARVEST PROTOCOL (performed by the agent via Playwright MCP tools)
// ------------------------------------------------------------------
// 1. Serve the calculator:  python3 -m http.server 5174  (cwd = CALCULATOR_DIR)
// 2. browser_navigate -> http://localhost:5174/index.html
// 3. One browser_evaluate runs the whole grid:
//      - read APP_VERSION for calculator_version
//      - slice window.calculate.toString() at "// --- Render ---" to obtain the
//        calculator's authentic math with the DOM-render tail removed, wrapped so
//        it returns its locals instead of writing HTML
//      - set #userName once, then for each tuple set the 5 swept inputs
//        (age, income, epfBalance, retireAge, lifestylePct), run the sliced
//        compute(), and collect: projected_balance_at_retire_rm (epfAtRetire),
//        monthly_drawdown_rm (epfMonthly), years_sustainable (depletion age - retire),
//        gap_to_tier_rm (max 0, needReal-epfMonthly), monthly_top_up_at_8pct_rm
//        (monthlyInvestNeeded)
// 4. assembleOutput(simulations, { calculatorVersion }) -> writeOutput(...)

if (import.meta.url === `file://${process.argv[1]}`) {
  loadRiaBenchmarks().then((riaFor) => {
    const grid = buildInputGrid(riaFor);
    if (process.argv[2] === "--print-grid") {
      process.stdout.write(JSON.stringify(grid));
      return;
    }
    console.log(`EPF simulation grid: ${grid.length} tuples`);
    console.log(`Calculator dir: ${CALCULATOR_DIR}`);
    console.log(`Output target:  ${path.relative(REPO_ROOT, OUTPUT_PATH)}`);
    console.log("Run the HARVEST PROTOCOL (see source) via the Playwright MCP tools.");
    if (!fs.existsSync(CALCULATOR_DIR)) {
      console.error(`WARNING: calculator dir not found at ${CALCULATOR_DIR}`);
    }
  });
}
