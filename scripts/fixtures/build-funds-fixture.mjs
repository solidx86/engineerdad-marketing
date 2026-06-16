// Generates funds-fixture.xlsx — a 3-fund stand-in for the real Public Mutual
// FundMaster xlsx used by scripts/refresh-funds-corpus.test.mjs.
//
// The real Master sheet is 73 columns wide with a title row, a section-group
// row, then column headers (row 3), then data. Each data row is built here from
// named sections with a hard width assertion so the fixture can never drift out
// of column alignment.
import ExcelJS from "exceljs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HEADERS = [
  "Fund Name", "Abbr", "Shariah-compliant", "Fund Type", "Objective", "Risk Level",
  "Distribution", "Size (RM M)", "Launch", "Status", "Beat (%)", "Periods", "Rationale",
  "Wtd Alpha (%)", "YTD Fund (%)", "YTD Bench (%)", "YTD Alpha (%)",
  "1Y Fund (%)", "1Y Bench (%)", "1Y Alpha (%)",
  "3Y Fund (%)", "3Y Bench (%)", "3Y Alpha (%)",
  "5Y Fund (%)", "5Y Bench (%)", "5Y Alpha (%)",
  "10Y Fund (%)", "10Y Bench (%)", "10Y Alpha (%)",
  "AE YTD", "AE 1Y", "AE 3Y", "AE 5Y", "AE 10Y",
  "Dom. Equity (%)", "For. Equity (%)", "FI / Sukuk (%)", "Money Mkt (%)", "Deposits (%)", "Alloc Other (%)",
  "USA (%)", "Taiwan (%)", "Korea (%)", "Japan (%)", "France (%)", "Germany (%)", "China (%)", "Singapore (%)", "Netherlands (%)", "Indonesia (%)", "Australia (%)", "Geo Other (%)",
  "Industrial (%)", "Technology (%)", "Financial (%)", "Comms (%)", "Cons. Disc. (%)", "Cons. Staples (%)", "Utilities (%)", "Energy (%)", "Materials (%)", "Real Estate (%)", "Sector Other (%)",
  "Top 5 Holdings", "VF", "VC", "Lipper Class", "Benchmark", "ATH NAV", "ATH Date", "Cur NAV", "Drawdown (%)", "Days from ATH",
];

// section widths: details 10, screening 3, wtd 1, returns 15, ae 5,
// allocation 6, geo 12, sector 11, holdings 1, vfvc 2, meta 2, ath 5 = 73
function makeRow(s) {
  const row = [
    ...s.details, ...s.screening, ...s.wtd, ...s.returns, ...s.ae,
    ...s.allocation, ...s.geo, ...s.sector, ...s.holdings, ...s.vfvc, ...s.meta, ...s.ath,
  ];
  if (row.length !== HEADERS.length) {
    throw new Error(`fixture row "${s.details[0]}" has ${row.length} cells, expected ${HEADERS.length}`);
  }
  return row;
}

// FIXTURE EQUITY A — conventional equity, qualified, weighted alpha +10
const feqa = makeRow({
  details: ["FIXTURE EQUITY A", "FEQA", "Conventional", "Equity", "Capital Growth", 5, "Incidental", 100.0, "01.01.2020", "Qualified"],
  screening: [100, "3/3", "Qualified (WA: +10%) — YTD✔ 1Y✔ 3Y✔"],
  wtd: [10],
  returns: [5, 3, 2, /*1y*/ 20, 15, 5, /*3y*/ 12, 10, 2, /*5y*/ null, null, null, /*10y*/ null, null, null],
  ae: [1.2, 1.5, 1.3, null, null],
  allocation: [80, 15, 0, 0, 0, 5],
  geo: [30, 10, 5, 0, 0, 0, 20, 5, 0, 0, 0, 30],
  sector: [20, 15, 10, 5, 5, 5, 5, 5, 5, 15, 5],
  holdings: ["Top1 | Top2"],
  vfvc: [0.1, 0.05],
  meta: ["Equity Asia", "MSCI AC Asia"],
  ath: [1.5, "2024-12-31", 1.2, -20, 365],
});

// FIXTURE FI B — Shariah fixed income, qualified, weighted alpha +1.5
const ffib = makeRow({
  details: ["FIXTURE FI B", "FFIB", "Shariah", "Fixed Income", "Income", 2, "Annual", 50.0, "01.06.2018", "Qualified"],
  screening: [80, "4/5", "Qualified (WA: +1.5%) — YTD✔ 1Y✔ 3Y✔ 5Y✔"],
  wtd: [1.5],
  returns: [0.5, 0.3, 0.2, /*1y*/ 2, 1.7, 0.3, /*3y*/ 3, 2.5, 0.5, /*5y*/ 2.8, 2.5, 0.3, /*10y*/ null, null, null],
  ae: [1.0, 1.1, 1.2, 1.0, null],
  allocation: [0, 0, 90, 5, 5, 0],
  geo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100],
  sector: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 95],
  holdings: ["Top1 | Top2"],
  vfvc: [0.02, 0.01],
  meta: ["Bond MYR", "Maybank Sukuk"],
  ath: [1.1, "2025-09-15", 1.08, -2, 60],
});

// FIXTURE EQUITY C — conventional equity, disqualified, weighted alpha -3
const feqc = makeRow({
  details: ["FIXTURE EQUITY C", "FEQC", "Conventional", "Equity", "Capital Growth", 5, "Incidental", 30.0, "01.01.2022", "Disqualified"],
  screening: [33, "1/3", "Failed (WA: -3%) — YTD✘ 1Y✘ 3Y✘"],
  wtd: [-3],
  returns: [-2, -1, -1, /*1y*/ -5, -3, -2, /*3y*/ -4, -2, -2, /*5y*/ null, null, null, /*10y*/ null, null, null],
  ae: [-0.8, -0.6, -0.5, null, null],
  allocation: [70, 20, 0, 0, 0, 10],
  geo: [40, 5, 0, 0, 0, 0, 15, 5, 5, 0, 0, 25],
  sector: [15, 10, 20, 10, 5, 5, 5, 5, 5, 10, 5],
  holdings: ["Top3 | Top4"],
  vfvc: [0.1, 0.05],
  meta: ["Equity Asia", "MSCI AC Asia"],
  ath: [1.8, "2023-12-31", 1.2, -33, 500],
});

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Master");
ws.addRow(["PUBLIC MUTUAL — FUND MASTER"]); // r1 title banner
ws.addRow(HEADERS.map(() => "SECTION"));     // r2 section-group row
ws.addRow(HEADERS);                           // r3 column headers
ws.addRow(feqa);
ws.addRow(ffib);
ws.addRow(feqc);

await wb.xlsx.writeFile(path.join(__dirname, "funds-fixture.xlsx"));
console.log("wrote", path.join(__dirname, "funds-fixture.xlsx"));
