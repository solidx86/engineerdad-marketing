import type { RunState, StageDefinition, Step, StepSpec, VerifyResult } from "../types.js";

/**
 * The analytics stage — turns raw Meta signals into the data Brain reasons
 * over. A pure 3-step write chain: A1-ingest pulls + persists insights,
 * A2-rank ranks creatives + costs angles, A3-decay pulls a decay curve for
 * each of A2's top-3 ads and writes an audit breadcrumb. It only *gathers* —
 * the fatigue artifact is derived later by `detectFatigue` at consumption time
 * (Brain's reasoning step, Phase 6). Cold start (empty results) is not a
 * failure.
 *
 * Phase 4 ships this definition + verifiers. Phase 5 wires it into the live
 * registry after `tracking`.
 */

interface AnalyticsParams {
  windowDays?: number;
}

const INSIGHT_FIELDS = [
  "ad_id",
  "ad_name",
  "adset_id",
  "campaign_id",
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpm",
  "actions",
  "action_values",
  "video_avg_time_watched_actions",
];

function stepResult<T>(run: RunState, stepId: string): T | undefined {
  return run.steps.find((s) => s.stepId === stepId)?.result as T | undefined;
}

/** Rows out of a tool response — array or {results:[]}. */
function rowsOf(callResult: unknown): unknown[] {
  if (Array.isArray(callResult)) return callResult;
  if (callResult !== null && typeof callResult === "object" && "results" in callResult) {
    const r = (callResult as { results: unknown }).results;
    return Array.isArray(r) ? r : [];
  }
  return [];
}

function windowDays(run: RunState): number {
  const w = (run.params as AnalyticsParams).windowDays;
  return typeof w === "number" && w > 0 ? w : 7;
}

/** A call result is an error when it is missing or carries an error marker. */
function isError(callResult: unknown): boolean {
  if (callResult === null || callResult === undefined) return true;
  if (typeof callResult === "object") {
    const o = callResult as Record<string, unknown>;
    if (o["isError"] === true) return true;
    if (typeof o["error"] === "string") return true;
  }
  return false;
}

/** Every MCP call in a write step's result returned non-error. Cold-start
 *  empty results pass — an empty array is not an error. */
function verifyNoErrors(result: unknown): VerifyResult {
  if (!Array.isArray(result)) {
    return { ok: false, problems: ["write step result was not an array of call results"] };
  }
  const problems = result
    .map((r, i) => (isError(r) ? `call ${i} returned an error` : null))
    .filter((p): p is string => p !== null);
  return { ok: problems.length === 0, problems };
}

const a1Ingest: StepSpec = {
  id: "A1-ingest",
  kind: "write",
  build: (run): Step => ({
    kind: "write",
    stepId: "A1-ingest",
    calls: [
      {
        tool: "mcp__meta-ads__get_insights",
        label: "insights",
        args: {
          level: "ad",
          date_preset: `last_${windowDays(run)}d`,
          fields: INSIGHT_FIELDS,
          breakdowns: [],
        },
      },
      {
        // `$insights.rows` = the get_insights result's `rows` field — the
        // intra-step capture convention (cf. experiment X3's `$experiment.id`).
        // getInsights returns `{rows: [...]}`; ingest expects an array under
        // its own `rows` field, so unwrap one level via the dot-path.
        tool: "mcp__analytics__ingest_meta_insights",
        args: { rows: "$insights.rows" },
      },
    ],
  }),
  verify: (_run, result): VerifyResult => verifyNoErrors(result),
};

const a2Rank: StepSpec = {
  id: "A2-rank",
  kind: "write",
  build: (run): Step => ({
    kind: "write",
    stepId: "A2-rank",
    calls: [
      { tool: "mcp__analytics__top_creatives", args: { window_days: windowDays(run), n: 10 } },
      { tool: "mcp__analytics__cost_per_angle", args: { window_days: windowDays(run) } },
    ],
  }),
  verify: (_run, result): VerifyResult => verifyNoErrors(result),
};

const a3Decay: StepSpec = {
  id: "A3-decay",
  kind: "write",
  build: (run): Step => {
    const a2 = stepResult<unknown[]>(run, "A2-rank") ?? [];
    const top3 = (rowsOf(a2[0]) as { ad_id?: unknown }[])
      .slice(0, 3)
      .map((c) => c.ad_id)
      .filter((id): id is string => typeof id === "string");
    return {
      kind: "write",
      stepId: "A3-decay",
      calls: [
        ...top3.map((adId) => ({
          tool: "mcp__analytics__decay_curve",
          args: { ad_id: adId, metric: "cpa" },
        })),
        {
          tool: "mcp__analytics__log_event",
          args: {
            event_name: "analytics:run",
            payload: { runId: run.runId, windowDays: windowDays(run), topN: top3.length },
          },
        },
      ],
    };
  },
  verify: (_run, result): VerifyResult => verifyNoErrors(result),
};

export const analyticsStage: StageDefinition = {
  id: "analytics",
  steps: [a1Ingest, a2Rank, a3Decay],
};
