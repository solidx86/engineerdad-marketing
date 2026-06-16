import { sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { isoDaysAgo } from "./tools.js";
import type { ArmTag } from "./types.js";

export interface Allocation {
  arm: Record<string, string>;
  n_pulls: number;
  posterior_mean_cpa: number;
  posterior_uncertainty: number;
  budget_share: number;
  bucket_label: "70" | "20" | "10";
}

export interface BanditAllocateInput {
  arm_tags: ArmTag[];
  window_days?: number;
  budget_total_myr: number;
  exploration_weight?: number;
  cold_start_strategy?: "uniform" | "proof_led";
}

export interface BanditAllocateOutput {
  allocations: Allocation[];
  cold_start_arms: number;
  notes: string[];
}

interface ArmAggregate {
  arm: Record<string, string>;
  arm_key: string;
  spend: number;
  leads: number;
  impressions: number;
  ad_ids: Set<string>;
}

const COLD_START_THRESHOLD = 3;
const PRIOR_ALPHA = 1;
const PRIOR_BETA = 50;
const SAMPLES = 200;

function gammaSample(shape: number): number {
  if (shape < 1) {
    const u = Math.random();
    return gammaSample(shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      const u1 = Math.random();
      const u2 = Math.random();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * Math.pow(x, 4)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function betaSample(alpha: number, beta: number): number {
  const x = gammaSample(alpha);
  const y = gammaSample(beta);
  return x / (x + y);
}

async function aggregateArms(armTags: ArmTag[], windowDays: number): Promise<ArmAggregate[]> {
  const db = getDb();
  const since = isoDaysAgo(windowDays);
  const tagKinds = new Set<string>(armTags);

  // 1) Per-ad tag map: which (kind,value) pairs apply to which ad. Coming
  //    from angle_tags directly avoids the LEFT-JOIN row multiplication that
  //    would inflate sums when an ad carries N tags.
  const tagRows = (await db.execute(sql`
    SELECT t.ad_id, t.tag_kind, t.tag_value
    FROM analytics.angle_tags t
    WHERE EXISTS (
      SELECT 1 FROM analytics.meta_insights mi
      WHERE mi.ad_id = t.ad_id AND mi.date >= ${since}
    )
  `)) as unknown as Array<{ ad_id: string; tag_kind: string; tag_value: string }>;

  const adArms = new Map<string, Record<string, string>>();
  for (const r of tagRows) {
    if (!tagKinds.has(r.tag_kind as ArmTag)) continue;
    const cur = adArms.get(r.ad_id) ?? {};
    cur[r.tag_kind] = r.tag_value;
    adArms.set(r.ad_id, cur);
  }

  // 2) Per-ad totals across the window — single GROUP BY to avoid tag-join
  //    fanout.
  const totalsRows = (await db.execute(sql`
    SELECT ad_id,
           SUM(spend) AS spend,
           SUM(leads) AS leads,
           SUM(impressions) AS impressions
    FROM analytics.meta_insights
    WHERE date >= ${since}
    GROUP BY ad_id
  `)) as unknown as Array<{
    ad_id: string;
    spend: number | string | null;
    leads: number | string | null;
    impressions: number | string | null;
  }>;
  const adTotalsClean = new Map<string, { spend: number; leads: number; impressions: number }>();
  for (const r of totalsRows) {
    adTotalsClean.set(r.ad_id, {
      spend: r.spend != null ? Number(r.spend) : 0,
      leads: r.leads != null ? Number(r.leads) : 0,
      impressions: r.impressions != null ? Number(r.impressions) : 0,
    });
  }

  const armMap = new Map<string, ArmAggregate>();
  for (const [adId, arm] of adArms) {
    if (Object.keys(arm).length !== armTags.length) continue;
    const armKey = armTags.map((t) => `${t}=${arm[t]}`).join("|");
    const totals = adTotalsClean.get(adId);
    if (!totals) continue;
    const agg = armMap.get(armKey) ?? {
      arm,
      arm_key: armKey,
      spend: 0,
      leads: 0,
      impressions: 0,
      ad_ids: new Set<string>(),
    };
    agg.spend += totals.spend;
    agg.leads += totals.leads;
    agg.impressions += totals.impressions;
    agg.ad_ids.add(adId);
    armMap.set(armKey, agg);
  }
  // Stable, source-order-independent arm ordering. The underlying tag query has no
  // ORDER BY, so Postgres may return rows in different physical orders across instances;
  // without a deterministic sort the Thompson-sampling draw assignment (and thus a close
  // arm race) could vary between runs/environments. Sort by arm_key for reproducibility.
  return [...armMap.values()].sort((a, b) => a.arm_key.localeCompare(b.arm_key));
}

export async function banditAllocate(input: BanditAllocateInput): Promise<BanditAllocateOutput> {
  const windowDays = input.window_days ?? 30;
  const exploration = clamp(input.exploration_weight ?? 0.2, 0, 1);
  const arms = await aggregateArms(input.arm_tags, windowDays);
  const notes: string[] = [];

  if (arms.length === 0) {
    notes.push(
      `no creatives have all required tags ${JSON.stringify(input.arm_tags)} within ${windowDays}d — returning empty allocation`,
    );
    return { allocations: [], cold_start_arms: 0, notes };
  }

  let coldStart = 0;
  const stats = arms.map((arm) => {
    const isCold = arm.ad_ids.size < COLD_START_THRESHOLD || arm.impressions < 1000;
    if (isCold) coldStart++;
    const alpha = arm.leads + PRIOR_ALPHA;
    const beta = Math.max(arm.impressions - arm.leads, 0) + PRIOR_BETA;
    const cpmEst = arm.impressions > 0 ? (arm.spend / arm.impressions) * 1000 : 50;

    const cpaSamples: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const conv = betaSample(alpha, beta);
      const cpa = conv > 0 ? cpmEst / 1000 / conv : 1e6;
      cpaSamples.push(cpa);
    }
    cpaSamples.sort((a, b) => a - b);
    const mean = cpaSamples.reduce((s, v) => s + v, 0) / cpaSamples.length;
    const lo = cpaSamples[Math.floor(cpaSamples.length * 0.1)] ?? mean;
    const hi = cpaSamples[Math.floor(cpaSamples.length * 0.9)] ?? mean;
    const uncertainty = hi - lo;
    const sampledCpa = cpaSamples[Math.floor(Math.random() * cpaSamples.length)] ?? mean;
    return { arm, mean, uncertainty, sampledCpa, isCold };
  });

  const inverseScores = stats.map((s) => 1 / Math.max(s.sampledCpa, 1e-3));
  const totalInverse = inverseScores.reduce((a, b) => a + b, 0);
  const greedyShares = inverseScores.map((v) => v / totalInverse);
  const uniformShare = 1 / stats.length;
  const shares = greedyShares.map((g) => (1 - exploration) * g + exploration * uniformShare);

  const sortedByShare = [...shares]
    .map((share, idx) => ({ share, idx }))
    .sort((a, b) => b.share - a.share);
  const buckets: Record<number, "70" | "20" | "10"> = {};
  const q1 = Math.max(1, Math.ceil(sortedByShare.length / 4));
  const q3 = Math.max(q1 + 1, Math.ceil((sortedByShare.length * 3) / 4));
  sortedByShare.forEach((entry, rank) => {
    if (rank < q1) buckets[entry.idx] = "70";
    else if (rank < q3) buckets[entry.idx] = "20";
    else buckets[entry.idx] = "10";
  });

  const allocations: Allocation[] = stats.map((s, idx) => ({
    arm: s.arm.arm,
    n_pulls: s.arm.ad_ids.size,
    posterior_mean_cpa: round2(s.mean),
    posterior_uncertainty: round2(s.uncertainty),
    budget_share: round4(shares[idx] ?? 0),
    bucket_label: buckets[idx] ?? "10",
  }));

  if (coldStart > 0) {
    notes.push(
      `${coldStart} cold-start arm(s) (n_pulls < ${COLD_START_THRESHOLD} or <1k impressions) — strategy: ${input.cold_start_strategy ?? "proof_led"}`,
    );
  }
  if ((input.cold_start_strategy ?? "proof_led") === "proof_led") {
    notes.push(
      "cold_start: proof_led prior is a v1 placeholder — wires to corpus.list_proof in 3d (currently uses uniform Beta prior)",
    );
  }
  notes.push(
    `bucket labels (70/20/10) derived from posterior allocation quartiles, not pre-decided`,
  );

  return {
    allocations: allocations.sort((a, b) => b.budget_share - a.budget_share),
    cold_start_arms: coldStart,
    notes,
  };
}

export interface BanditUpdateOutput {
  arms_updated: number;
  posteriors: Array<{
    arm: Record<string, string>;
    n_pulls: number;
    alpha: number;
    beta: number;
    posterior_mean_cpa: number;
  }>;
}

export async function banditUpdate(input: { window_days: number; arm_tags?: ArmTag[] }): Promise<BanditUpdateOutput> {
  const armTags = input.arm_tags ?? (["hook", "angle"] as ArmTag[]);
  const arms = await aggregateArms(armTags, input.window_days);
  const posteriors = arms.map((arm) => {
    const alpha = arm.leads + PRIOR_ALPHA;
    const beta = Math.max(arm.impressions - arm.leads, 0) + PRIOR_BETA;
    const cpm = arm.impressions > 0 ? (arm.spend / arm.impressions) * 1000 : 50;
    const meanRate = alpha / (alpha + beta);
    const meanCpa = meanRate > 0 ? cpm / 1000 / meanRate : 0;
    return {
      arm: arm.arm,
      n_pulls: arm.ad_ids.size,
      alpha,
      beta,
      posterior_mean_cpa: round2(meanCpa),
    };
  });
  return { arms_updated: arms.length, posteriors };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
