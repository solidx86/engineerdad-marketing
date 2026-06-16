/**
 * detectFatigue — the §12.5 creative-sunset heuristic. Pure. The analytics
 * stage only *gathers* decay curves; this function is applied at consumption
 * time (Brain's reasoning step, Phase 6) to derive the `fatiguing` artifact.
 */

export interface DecayCurve {
  adId: string;
  points: { date: string; cpa: number }[];
}

export interface FatigueRow {
  adId: string;
  baselineCpaMyr: number;
  recentCpaMyr: number;
  deltaPct: number;
}

const FATIGUE_THRESHOLD_PCT = 25;
const RECENT_WINDOW = 3;
const BASELINE_WINDOW = 7;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * An ad is fatiguing when the mean CPA over its last 3 points runs >25% above
 * baseline — the median of the first 7 points, or the first half of the curve
 * when it is shorter. Returns only the fatiguing ads; a flat or improving curve
 * yields no row, and a curve with a non-positive baseline is skipped.
 */
export function detectFatigue(curves: DecayCurve[]): FatigueRow[] {
  const rows: FatigueRow[] = [];
  for (const curve of curves) {
    const cpas = [...curve.points]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => p.cpa);
    if (cpas.length === 0) continue;

    const baselineSlice =
      cpas.length >= BASELINE_WINDOW
        ? cpas.slice(0, BASELINE_WINDOW)
        : cpas.slice(0, Math.max(1, Math.ceil(cpas.length / 2)));
    const baseline = median(baselineSlice);
    if (baseline <= 0) continue;

    const recent = mean(cpas.slice(-Math.min(RECENT_WINDOW, cpas.length)));
    const deltaPct = ((recent - baseline) / baseline) * 100;

    if (deltaPct > FATIGUE_THRESHOLD_PCT) {
      rows.push({
        adId: curve.adId,
        baselineCpaMyr: baseline,
        recentCpaMyr: recent,
        deltaPct,
      });
    }
  }
  return rows;
}
