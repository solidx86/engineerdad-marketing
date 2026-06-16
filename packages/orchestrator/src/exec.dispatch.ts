import type { ExecDeps } from "./exec.types.js";
import { UnsupportedToolError } from "./exec.types.js";

/**
 * Dispatch table: MCP tool name → handler that pulls structured args from
 * `args` and invokes the right method on `deps.*`.
 *
 * Phase A populates only the `mcp__store__*` rows. Later phases (D / E / F /
 * G per ADR-023's plan) add analytics, corpus, meta-ads, experiment rows
 * once those servers are extracted to sibling `packages/<name>/` libraries.
 *
 * Each handler returns the raw call result. The caller (`executeWriteStep`)
 * accumulates these into the `unknown[]` array the engine's verify/advance
 * path already understands.
 */
export type DispatchHandler = (args: unknown, deps: ExecDeps) => Promise<unknown>;

function asObject(args: unknown, tool: string): Record<string, unknown> {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new TypeError(`Dispatch ${tool}: args must be an object, got ${typeof args}`);
  }
  return args as Record<string, unknown>;
}

export const DISPATCH_TABLE: Record<string, DispatchHandler> = {
  "mcp__store__create": async (args, deps) => {
    const a = asObject(args, "mcp__store__create");
    return deps.store.create(a.entity as never, a.props as Record<string, unknown>);
  },

  "mcp__store__query": async (args, deps) => {
    const a = asObject(args, "mcp__store__query");
    const opts = a.fields !== undefined ? { fields: a.fields as string[] } : undefined;
    return deps.store.query(a.entity as never, a.filter as never, opts);
  },

  "mcp__store__get": async (args, deps) => {
    const a = asObject(args, "mcp__store__get");
    return deps.store.get(a.entity as never, a.id as string);
  },

  "mcp__store__update": async (args, deps) => {
    const a = asObject(args, "mcp__store__update");
    const opts =
      a.fillOnlyIfEmpty !== undefined
        ? { fillOnlyIfEmpty: a.fillOnlyIfEmpty as boolean }
        : undefined;
    return deps.store.update(
      a.entity as never,
      a.id as string,
      a.props as Record<string, unknown>,
      opts,
    );
  },

  "mcp__store__set_status": async (args, deps) => {
    const a = asObject(args, "mcp__store__set_status");
    return deps.store.setStatus(a.entity as never, a.id as string, a.status as string);
  },

  // -- analytics (Phase D) --
  // Each row requires `deps.analytics` to be wired; if absent, the handler
  // throws UnsupportedToolError so the MCP server falls back to the legacy
  // stdio path. Same shape used for the other graduations in Phase E–G.

  "mcp__analytics__ingest_meta_insights": async (args, deps) => {
    if (!deps.analytics) throw new UnsupportedToolError("mcp__analytics__ingest_meta_insights");
    const a = asObject(args, "mcp__analytics__ingest_meta_insights");
    return deps.analytics.ingestMetaInsights(a as never);
  },

  "mcp__analytics__upsert_creative": async (args, deps) => {
    if (!deps.analytics) throw new UnsupportedToolError("mcp__analytics__upsert_creative");
    const a = asObject(args, "mcp__analytics__upsert_creative");
    return deps.analytics.upsertCreative(a as never);
  },

  "mcp__analytics__decay_curve": async (args, deps) => {
    if (!deps.analytics) throw new UnsupportedToolError("mcp__analytics__decay_curve");
    const a = asObject(args, "mcp__analytics__decay_curve");
    return deps.analytics.decayCurve({
      ad_id: a.ad_id as string,
      metric: a.metric as "ctr" | "cpm" | "cpa",
      channel: a.channel as string | undefined,
    });
  },

  "mcp__analytics__cost_per_angle": async (args, deps) => {
    if (!deps.analytics) throw new UnsupportedToolError("mcp__analytics__cost_per_angle");
    const a = asObject(args, "mcp__analytics__cost_per_angle");
    return deps.analytics.costPerAngle({
      window_days: a.window_days as number,
      channel: a.channel as string | undefined,
    });
  },

  "mcp__analytics__top_creatives": async (args, deps) => {
    if (!deps.analytics) throw new UnsupportedToolError("mcp__analytics__top_creatives");
    const a = asObject(args, "mcp__analytics__top_creatives");
    return deps.analytics.topCreatives({
      window_days: a.window_days as number,
      n: a.n as number,
      channel: a.channel as string | undefined,
    });
  },

  "mcp__analytics__log_event": async (args, deps) => {
    if (!deps.analytics) throw new UnsupportedToolError("mcp__analytics__log_event");
    const a = asObject(args, "mcp__analytics__log_event");
    return deps.analytics.logEvent({
      event_name: a.event_name as string,
      payload: a.payload,
    });
  },

  "mcp__analytics__bandit_allocate": async (args, deps) => {
    if (!deps.analytics) throw new UnsupportedToolError("mcp__analytics__bandit_allocate");
    const a = asObject(args, "mcp__analytics__bandit_allocate");
    return deps.analytics.banditAllocate(a as never);
  },

  "mcp__analytics__bandit_update": async (args, deps) => {
    if (!deps.analytics) throw new UnsupportedToolError("mcp__analytics__bandit_update");
    const a = asObject(args, "mcp__analytics__bandit_update");
    return deps.analytics.banditUpdate(a as never);
  },

  "mcp__analytics__engagement_per_angle": async (args, deps) => {
    if (!deps.analytics) throw new UnsupportedToolError("mcp__analytics__engagement_per_angle");
    const a = asObject(args, "mcp__analytics__engagement_per_angle");
    return deps.analytics.engagementPerAngle({
      channel: a.channel as string,
      sinceTs: a.sinceTs as number,
      angleByVariant: a.angleByVariant as Record<string, string>,
    });
  },

  // -- corpus (Phase E) --
  // No current LIVE_REGISTRY write step calls corpus tools (corpus is read
  // exclusively by Brain at reasoning time, not by orchestrator stages),
  // but the rows are wired so future stages can opt in without plumbing.

  "mcp__corpus__search": async (args, deps) => {
    if (!deps.corpus) throw new UnsupportedToolError("mcp__corpus__search");
    const a = asObject(args, "mcp__corpus__search");
    return deps.corpus.search(a as never);
  },

  "mcp__corpus__get_compliance_block": async (args, deps) => {
    if (!deps.corpus) throw new UnsupportedToolError("mcp__corpus__get_compliance_block");
    const a = asObject(args, "mcp__corpus__get_compliance_block");
    return deps.corpus.getComplianceBlock(a as never);
  },

  "mcp__corpus__list_proof": async (args, deps) => {
    if (!deps.corpus) throw new UnsupportedToolError("mcp__corpus__list_proof");
    const a = asObject(args, "mcp__corpus__list_proof");
    return deps.corpus.listProof(a as never);
  },

  // -- meta-ads (Phase F) --
  // Rows for the tools the LIVE_REGISTRY actually calls today: capi_test_event
  // (T1-tracking), capi_send (T2-events), get_insights (A1-ingest), list_ads
  // (distribute gate-check). ADR-015 invariants live inside the library — the
  // dispatch table is a pure forwarder.

  "mcp__meta-ads__capi_test_event": async (_args, deps) => {
    if (!deps.metaAds) throw new UnsupportedToolError("mcp__meta-ads__capi_test_event");
    return deps.metaAds.capiTestEvent();
  },

  "mcp__meta-ads__capi_send": async (args, deps) => {
    if (!deps.metaAds) throw new UnsupportedToolError("mcp__meta-ads__capi_send");
    const a = asObject(args, "mcp__meta-ads__capi_send");
    return deps.metaAds.capiSend(a as never);
  },

  "mcp__meta-ads__get_insights": async (args, deps) => {
    if (!deps.metaAds) throw new UnsupportedToolError("mcp__meta-ads__get_insights");
    const a = asObject(args, "mcp__meta-ads__get_insights");
    return deps.metaAds.getInsights(a as never);
  },

  "mcp__meta-ads__list_ads": async (args, deps) => {
    if (!deps.metaAds) throw new UnsupportedToolError("mcp__meta-ads__list_ads");
    const a = asObject(args, "mcp__meta-ads__list_ads");
    return deps.metaAds.listAds(a as never);
  },

  // -- experiment (Phase G) --
  // Pure logic — design generates the factorial cell expansion + 70/20/10
  // allocation. readout reads the analytics Postgres schema. Called from X2-design and
  // (via /reflect) for post-cycle Hypothesis grading.

  "mcp__experiment__design": async (args, deps) => {
    if (!deps.experiment) throw new UnsupportedToolError("mcp__experiment__design");
    const a = asObject(args, "mcp__experiment__design");
    return deps.experiment.design(a as never);
  },

  "mcp__experiment__readout": async (args, deps) => {
    if (!deps.experiment) throw new UnsupportedToolError("mcp__experiment__readout");
    const a = asObject(args, "mcp__experiment__readout");
    return deps.experiment.readout(a as never);
  },
};

/** Look up a handler, throwing `UnsupportedToolError` if absent. */
export function getHandler(tool: string): DispatchHandler {
  const handler = DISPATCH_TABLE[tool];
  if (!handler) throw new UnsupportedToolError(tool);
  return handler;
}
