import { sql } from "drizzle-orm";
import { getDb } from "./db.js";

export interface ReadoutCell {
  cell_id: string;
  spend: number;
  leads: number;
  impressions: number;
  cpa: number;
  lift_vs_control: number;
  significance_note: string;
}

export interface ReadoutOutput {
  experiment_id: string;
  cells: ReadoutCell[];
  recommendation: string;
}

interface CellMembership {
  experiment_id: string;
  cell_id: string;
  ad_ids: string[];
  is_control?: boolean;
}

export interface ReadoutInput {
  experiment_id: string;
  cells: CellMembership[];
}

export async function readout(input: ReadoutInput): Promise<ReadoutOutput> {
  if (input.cells.length === 0) {
    return {
      experiment_id: input.experiment_id,
      cells: [],
      recommendation: "no cells supplied — nothing to read out",
    };
  }

  const db = getDb();

  const cellAgg: Array<CellMembership & { spend: number; leads: number; impressions: number; cpa: number }> = [];
  for (const cell of input.cells) {
    let spend = 0;
    let leads = 0;
    let impressions = 0;
    for (const adId of cell.ad_ids) {
      // bigint SUM aggregates come back as STRINGS from postgres.js — Number()-coerce.
      const rows = (await db.execute(sql`
        SELECT SUM(spend) AS spend,
               SUM(leads) AS leads,
               SUM(impressions) AS impressions
        FROM analytics.meta_insights
        WHERE ad_id = ${adId}
      `)) as unknown as Array<{
        spend: number | string | null;
        leads: number | string | null;
        impressions: number | string | null;
      }>;
      const r = rows[0];
      if (!r) continue;
      spend += r.spend != null ? Number(r.spend) : 0;
      leads += r.leads != null ? Number(r.leads) : 0;
      impressions += r.impressions != null ? Number(r.impressions) : 0;
    }
    const cpa = leads > 0 ? spend / leads : 0;
    cellAgg.push({ ...cell, spend, leads, impressions, cpa });
  }

  const control = cellAgg.find((c) => c.is_control) ?? cellAgg[0];
  if (!control) throw new Error("no control cell");

  const results: ReadoutCell[] = cellAgg.map((c) => {
    const lift =
      control.cpa > 0 && c.cpa > 0 ? (control.cpa - c.cpa) / control.cpa : 0;
    const significance = significanceNote(c.leads, control.leads);
    return {
      cell_id: c.cell_id,
      spend: round2(c.spend),
      leads: c.leads,
      impressions: c.impressions,
      cpa: round2(c.cpa),
      lift_vs_control: round4(lift),
      significance_note: significance,
    };
  });

  const winner = [...results]
    .filter((r) => r.cpa > 0 && r.cell_id !== control.cell_id)
    .sort((a, b) => b.lift_vs_control - a.lift_vs_control)[0];

  let recommendation: string;
  if (!winner) {
    recommendation = "Inconclusive — no non-control cell has lead data yet. Hold and re-read in 3–5d.";
  } else if (winner.lift_vs_control > 0.2 && winner.leads >= 30) {
    recommendation = `Promote ${winner.cell_id}: ${(winner.lift_vs_control * 100).toFixed(1)}% CPA improvement over control on ${winner.leads} leads. Move into Iterate.`;
  } else if (winner.lift_vs_control > 0) {
    recommendation = `Lean toward ${winner.cell_id} (${(winner.lift_vs_control * 100).toFixed(1)}% lift) but extend the experiment — sample too small for confidence.`;
  } else {
    recommendation = "Control still leads — Sunset the experiment cells and re-design.";
  }

  return { experiment_id: input.experiment_id, cells: results, recommendation };
}

function significanceNote(cellLeads: number, controlLeads: number): string {
  const totalLeads = cellLeads + controlLeads;
  if (totalLeads < 30) return `low-power (n=${totalLeads}, target ≥30)`;
  if (totalLeads < 100) return `moderate-power (n=${totalLeads})`;
  return `acceptable-power (n=${totalLeads})`;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
