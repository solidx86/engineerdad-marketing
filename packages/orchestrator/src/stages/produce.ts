import {
  deriveSpecs,
  deriveArticlePackaging,
  variantId,
  type CreativePlan,
  type CreativeUnit,
  type RenderResult,
  type VariantSpec,
} from "@engineerdad/shared/derive";
import type { RunState, StageDefinition, Step, StepSpec, VerifyResult } from "../types.js";
import { reviewUiUrl } from "../webapp-url.js";
import {
  verifyProduce,
  verifyChartBindings,
  type ProduceScript,
  type ProduceVariant,
} from "../verifiers/verify-produce.js";
import {
  reelWorkerInput,
  reelSkeletonProps,
  type ReelUnitWithId,
} from "../produce/reel-worker-input.js";
import { ReelShotlistSchema } from "@engineerdad/shared/zod";

/**
 * The produce stage — decomposes human-approved Scripts into the Creative
 * Variant matrix, renders static assets, persists, enriches AuthorityArticles,
 * confirms against ground truth, and stops at HG3.
 *
 *   P0-scripts   write   query approved Scripts for this run
 *   P1-fanout    fanout  one creative-director worker per Script → CreativeUnit[]
 *   P2-render    fanout  render-workers → RenderResult[] per static creative
 *   P3-persist   write   deriveSpecs → store.create per variant; + a trailing
 *                        AuthorityArticles query for P4
 *   P4-enrich    write   deriveArticlePackaging → fill-only-if-empty
 *                        store.update on the approved AuthorityArticles
 *   P5-confirm   write   re-query Scripts + CreativeVariants; verify delegates
 *                        to verifyProduce — ground truth, not P1's self-report
 *   P6-gate      gate    HG3
 *
 * E-027 — P1 was a single creative-director spawn that exhausted the subagent
 * context window. It is now a per-Script fanout with each worker handed only
 * its Script + its parent Brief's hook bank.
 */

function stepResult<T>(run: RunState, stepId: string): T | undefined {
  return run.steps.find((s) => s.stepId === stepId)?.result as T | undefined;
}

/** Flatten one mcp__store__query call-result into a row array. */
function rowsOf(callResult: unknown): unknown[] {
  return Array.isArray(callResult) ? callResult : [];
}

/**
 * Fold a P1-fanout's per-Script unit array into a flat CreativePlan.
 *
 * Defensive: a subagent occasionally persists its result as a JSON-encoded
 * scalar string instead of as a parsed object (one CD worker did this on
 * 2026-05-26 for run_1779779169 and silently orphaned its script). When that
 * happens, the unit's payload is a string that looks like '{"creatives":[…]}'
 * — JSON.parse it before reading `.creatives` so the orphan is recovered.
 */
function foldCreativePlan(runId: string, units: unknown): CreativePlan {
  const creatives: CreativeUnit[] = [];
  if (!Array.isArray(units)) return { runId, creatives };
  for (const raw of units) {
    let u: unknown = raw;
    if (typeof u === "string" && u.trimStart().startsWith("{")) {
      try {
        u = JSON.parse(u);
      } catch {
        continue;
      }
    }
    if (u === null || typeof u !== "object") continue;
    const c = (u as { creatives?: unknown }).creatives;
    if (Array.isArray(c)) creatives.push(...(c as CreativeUnit[]));
  }
  return { runId, creatives };
}

const STATIC_FORMATS = new Set<CreativeUnit["format"]>(["Feed", "Carousel"]);

/**
 * Reel pipeline opt-in switch (per 2026-05-28-heygen-reel-pipeline §9).
 *
 * Default OFF (PR 6 corrected the inverted semantic from PR 4). The Reel
 * pipeline calls a paid HeyGen API per Reel CreativeUnit — defaulting to
 * on meant anyone running `/produce` on the integration branch could burn
 * credits without realising. Now: only `EDOS_REEL_PIPELINE=on` enables it.
 *
 * When disabled, P1a-reels-prepare emits no rows and P2-render emits no
 * Reel spawns — the loop behaves as it did before activation, leaving Reel
 * CreativeUnits without an asset (HG3 reviewer sees `assetFiles=[]`).
 */
function reelPipelineEnabled(): boolean {
  return process.env.EDOS_REEL_PIPELINE === "on";
}

function scriptIdOf(script: unknown): string {
  if (script !== null && typeof script === "object") {
    const id = (script as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return "";
}

/** The Brief id linked to a Script row — flat `brief` column on Scripts. */
function briefIdForScript(script: unknown): string {
  if (script === null || typeof script !== "object") return "";
  const b = (script as { brief?: unknown }).brief;
  return typeof b === "string" ? b : "";
}

// ── P0-scripts ───────────────────────────────────────────────────────────

const p0Scripts: StepSpec = {
  id: "P0-scripts",
  kind: "write",
  build: (run): Step => ({
    kind: "write",
    stepId: "P0-scripts",
    calls: [
      {
        tool: "mcp__store__query",
        args: {
          entity: "Scripts",
          filter: { runId: run.runId, approvalStatus: "Approved" },
          fields: [
            "scriptEn",
            "scriptBm",
            "ctaEn",
            "ctaBm",
            "durationSec",
            "funnelStage",
            "hookEn",
            "hookBm",
            "brief",
          ],
        },
      },
    ],
  }),
  verify: (_run, result): VerifyResult => {
    const arr = Array.isArray(result) ? result : [];
    return rowsOf(arr[0]).length > 0
      ? { ok: true, problems: [] }
      : { ok: false, problems: ["P0-scripts returned no approved Scripts for this run"] };
  },
};

// ── P1-fanout ────────────────────────────────────────────────────────────

interface HookBankEntry {
  briefId: string;
  hooks: unknown;
}

function hookBanksFromC1(run: RunState): HookBankEntry[] {
  const c1 = stepResult<unknown>(run, "C1-fanout");
  if (!Array.isArray(c1)) return [];
  return c1
    .filter((u): u is { briefId: unknown; hooks: unknown } => u !== null && typeof u === "object")
    .map((u) => ({
      briefId: typeof u.briefId === "string" ? u.briefId : "",
      hooks: u.hooks,
    }))
    .filter((b) => b.briefId.length > 0);
}

const p1Fanout: StepSpec = {
  id: "P1-fanout",
  kind: "fanout",
  // ADR-024: build is async because it stages per-unit worker-input
  // (scriptId, briefId, hookBank) via ctx.stageInput. The hook bank was
  // historically inlined into every spawnPrompt (4 KB × 12 units → 83 KB
  // plan() envelope, blowing the conductor's harness cap). Now each
  // spawnPrompt carries only an sr_ ref (~50 bytes); the worker fetches
  // its staged input on entry via mcp__orchestrator__read_step_result.
  build: async (run, ctx): Promise<Step> => {
    const banks = hookBanksFromC1(run);
    if (banks.length === 0) {
      throw new Error(
        "P1-fanout: C1-fanout produced no hook banks — cannot dispatch creative-director workers",
      );
    }

    const p0 = stepResult<unknown[]>(run, "P0-scripts");
    const scripts = Array.isArray(p0) ? rowsOf(p0[0]) : [];
    if (scripts.length === 0) {
      throw new Error(
        "P1-fanout: P0-scripts returned no approved Scripts — cannot dispatch creative-director workers",
      );
    }

    const bankFor = (briefId: string): unknown =>
      banks.find((b) => b.briefId === briefId)?.hooks ?? [];

    const units = await Promise.all(
      scripts.map(async (script, i) => {
        const sid = scriptIdOf(script);
        const bid = briefIdForScript(script);
        const inputRef = await ctx.stageInput(i, {
          scriptId: sid,
          briefId: bid,
          hookBank: bankFor(bid),
        });
        return {
          spawnPrompt: [
            `Run ${run.runId}: you are creative-director in Single-Script worker mode.`,
            "",
            "Your FIRST action: call",
            `  mcp__orchestrator__read_step_result({ stepResultId: "${inputRef}" })`,
            "to fetch your staged input { scriptId, briefId, hookBank }.",
            "",
            "Then call mcp__store__get for the Script and Brief to read full content.",
            "Operate on EXACTLY ONE Script. Produce exactly 4 distinct CreativeUnits",
            "(Reel, Feed, YT-Long, Carousel), rotating 4 distinct hooks across emotional",
            "registers from the staged hook bank. Return",
            "{ scriptId, creatives: [4 units] } as your final JSON.",
          ].join("\n"),
        };
      }),
    );

    return {
      kind: "fanout",
      stepId: "P1-fanout",
      worker: "creative-director",
      units,
    };
  },
  /**
   * Schema-validate every Reel CreativeUnit at the P1-fanout boundary per
   * spec §5.1. Static-format units are left to their existing downstream
   * checks (deriveSpecs / verifyProduce); only Reels have the extra fields
   * (sceneType, estimatedSeconds, targetSeconds, faceFirstHook) that the
   * reel-render-worker depends on, so they need the strict gate here.
   *
   * The fanout result is `unknown[]` — array of per-Script worker outputs.
   * Each output shape: `{ scriptId, creatives: [...] }` where one creative
   * is the Reel.
   */
  verify: (_run, result): VerifyResult => {
    if (!reelPipelineEnabled()) return { ok: true, problems: [] };
    const units = Array.isArray(result) ? result : [];
    const problems: string[] = [];
    for (let u = 0; u < units.length; u++) {
      let raw: unknown = units[u];
      if (typeof raw === "string" && raw.trimStart().startsWith("{")) {
        try {
          raw = JSON.parse(raw);
        } catch {
          continue;
        }
      }
      if (raw === null || typeof raw !== "object") continue;
      const creatives = (raw as { creatives?: unknown }).creatives;
      if (!Array.isArray(creatives)) continue;
      for (let c = 0; c < creatives.length; c++) {
        const cu = creatives[c] as { format?: unknown } | null;
        if (!cu || cu.format !== "Reel") continue;
        const parsed = ReelShotlistSchema.safeParse(cu);
        if (!parsed.success) {
          const sid = (raw as { scriptId?: unknown }).scriptId;
          problems.push(
            `Reel CreativeUnit (script=${typeof sid === "string" ? sid : "?"}, unit-${u}.creative-${c}) fails ReelShotlistSchema: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
          );
        }
      }
    }
    return problems.length > 0 ? { ok: false, problems } : { ok: true, problems: [] };
  },
};

// ── P1a-reels-prepare ────────────────────────────────────────────────────
//
// Creates skeleton CreativeVariant rows for Reel units BEFORE P2-render
// dispatches the workers. Without these rows existing, the worker's
// orphan-recovery write at Step 3a (per spec §6 Phase 2) has nothing to
// update — the row's UUID is the handle the worker uses for resume detection.
//
// Idempotent within a run: the orchestrator's "done" marker on this step
// means re-plans return the existing rows' IDs via stepResult lookup.
// Static-format CreativeVariants are still created by P3-persist; only
// Reels need the pre-create.

function reelUnitsFromP1(run: RunState): CreativeUnit[] {
  const plan = foldCreativePlan(run.runId, stepResult<unknown>(run, "P1-fanout"));
  return plan.creatives.filter((c) => c.format === "Reel");
}

const p1aReelsPrepare: StepSpec = {
  id: "P1a-reels-prepare",
  kind: "write",
  build: (run): Step => {
    if (!reelPipelineEnabled()) {
      // Kill switch on: emit a no-op write step. The orchestrator treats it
      // as completed and moves on; P2-render's Reel branch sees no rows.
      return { kind: "write", stepId: "P1a-reels-prepare", calls: [] };
    }
    const reels = reelUnitsFromP1(run);
    return {
      kind: "write",
      stepId: "P1a-reels-prepare",
      calls: reels.map((unit) => ({
        tool: "mcp__store__create",
        args: {
          entity: "CreativeVariants",
          props: reelSkeletonProps(unit, run.runId),
        },
      })),
    };
  },
};

// ── P2-render ────────────────────────────────────────────────────────────

/** The render-worker scene list — Feed renders its hero frame only. */
function renderScenes(unit: CreativeUnit): Record<string, unknown>[] {
  const cards = unit.format === "Feed" ? unit.shotlistEn.slice(0, 1) : unit.shotlistEn;
  return cards.map((sc, i) => ({
    scene: sc.scene,
    headline: i === 0 ? unit.hook.en : sc.onScreenText,
    headline_source: i === 0 ? "hook" : "onScreenText",
    body: sc.voiceover,
    shotNotes: sc.shotNotes,
    chartRef: sc.chartRef,
  }));
}

/** The spawn-time inputs JSON a render-worker expects (see render-worker.md). */
function renderUnitSpec(unit: CreativeUnit, runId: string): Record<string, unknown> {
  const base = {
    runId,
    scriptId: unit.scriptId,
    language: "en",
    scenes: renderScenes(unit),
    thumbnailBrief: unit.thumbnailBrief,
  };
  if (unit.format === "Carousel") {
    return {
      ...base,
      format: "Carousel",
      aspects: [
        { aspect: "4:5", width: 1080, height: 1350, variantId: variantId(unit.scriptId, "Carousel", "4:5") },
        { aspect: "1:1", width: 1080, height: 1080, variantId: variantId(unit.scriptId, "Carousel", "1:1") },
      ],
    };
  }
  return {
    ...base,
    format: "Feed",
    aspect: "4:5",
    width: 1080,
    height: 1350,
    variantId: variantId(unit.scriptId, "Feed", "4:5"),
  };
}

/**
 * Pair Reel CreativeUnits with the row IDs returned by P1a-reels-prepare.
 * Both arrays are in P1-fanout's Reel-filter order, so we just zip by index.
 * If P1a returned no rows (kill switch off or no Reels in plan), this
 * returns an empty array and P2-render emits no Reel spawns.
 */
function reelUnitsWithIds(run: RunState): ReelUnitWithId[] {
  const reels = reelUnitsFromP1(run);
  if (reels.length === 0) return [];
  const p1a = stepResult<unknown[]>(run, "P1a-reels-prepare") ?? [];
  const out: ReelUnitWithId[] = [];
  for (let i = 0; i < reels.length; i++) {
    const created = p1a[i] as { ok?: boolean; id?: string } | undefined;
    if (created?.ok && typeof created.id === "string") {
      out.push({ unit: reels[i]!, id: created.id });
    }
  }
  return out;
}

const p2Render: StepSpec = {
  id: "P2-render",
  kind: "fanout",
  // ADR-024: build is async because it stages per-unit render-worker input
  // (full renderUnitSpec — runId, scriptId, format, scenes[], aspects, …)
  // via ctx.stageInput. Pretty-printed JSON of a Carousel renderUnitSpec
  // can exceed 4 KB per unit; an 8-Script run pushed the P2 plan envelope
  // toward 40 KB. Each spawnPrompt now carries only an sr_ ref; the worker
  // fetches its input on entry via mcp__orchestrator__read_step_result.
  //
  // Reel branch (per 2026-05-28-heygen-reel-pipeline §6): dispatches a
  // separate reel-render-worker for each Reel unit, gated by the
  // EDOS_REEL_PIPELINE env var. Static + Reel spawns share the fanout step;
  // foldRender / verifyProduce don't care which branch emitted a result.
  build: async (run, ctx): Promise<Step> => {
    const plan = foldCreativePlan(run.runId, stepResult<unknown>(run, "P1-fanout"));
    const statics = plan.creatives.filter((c) => STATIC_FORMATS.has(c.format));

    const staticUnits = await Promise.all(
      statics.map(async (unit, i) => {
        const inputRef = await ctx.stageInput(i, renderUnitSpec(unit, run.runId));
        return {
          spawnPrompt: [
            `Run ${run.runId}: you are a render worker.`,
            "",
            "Your FIRST action: call",
            `  mcp__orchestrator__read_step_result({ stepResultId: "${inputRef}" })`,
            "to fetch your render-unit spec (runId, scriptId, format, scenes, …).",
            "",
            "Then read corpus/templates/worker-prompts/render-worker.md and follow it",
            "exactly to render this unit. The staged input matches the schema in",
            "that file's 'Inputs you'll receive in the spawn prompt' section.",
          ].join("\n"),
        };
      }),
    );

    const reelPairs = reelPipelineEnabled() ? reelUnitsWithIds(run) : [];
    const reelUnits = await Promise.all(
      reelPairs.map(async (pair, i) => {
        // Continue the staged-input numbering after the static units so
        // each call to stageInput has a unique unitIndex within P2-render.
        const inputRef = await ctx.stageInput(
          statics.length + i,
          reelWorkerInput(pair, run.runId),
        );
        return {
          spawnPrompt: [
            `Run ${run.runId}: you are a Reel render worker.`,
            "",
            "Your FIRST action: call",
            `  mcp__orchestrator__read_step_result({ stepResultId: "${inputRef}" })`,
            "to fetch your ReelWorkerInput (runId, scriptId, id, variantId, scenes, heygen, …).",
            "",
            "Then read corpus/templates/worker-prompts/reel-render-worker.md and follow",
            "its 8-step procedure exactly. The persisted CreativeVariants row at",
            "the staged input's `id` field is your handle for the orphan-recovery",
            "write at Step 3a — do that BEFORE polling HeyGen.",
          ].join("\n"),
        };
      }),
    );

    return {
      kind: "fanout",
      stepId: "P2-render",
      worker: "render-worker",
      units: [...staticUnits, ...reelUnits],
    };
  },
};

// ── P3-persist ───────────────────────────────────────────────────────────

/** Flatten the render-worker outputs of the P2 fanout into RenderResult[].
 *  Prefers `scenes[]` (all slides per variant — required for Carousel multi-
 *  slide asset_files) and falls back to per-scene-defaulting from the worker's
 *  top-level `rendered[]` when scenes omit `variantId`. Per render-worker.md,
 *  Feed scenes intentionally omit `variantId` (it's only at the top level),
 *  so without the fallback Feed variants would never accumulate any renders.
 */
function renderResultsOf(run: RunState): RenderResult[] {
  const p2 = stepResult<unknown[]>(run, "P2-render") ?? [];
  const out: RenderResult[] = [];
  for (const worker of p2) {
    const w = worker as {
      scenes?: unknown;
      rendered?: { variantId?: string; url?: string; sha256?: string }[];
    };
    const rendered = Array.isArray(w.rendered) ? w.rendered : [];
    const scenes = Array.isArray(w.scenes) ? w.scenes : [];
    const seen = new Set<string>();
    for (const scene of scenes) {
      const s = scene as { variantId?: string; url?: string; sha256?: string };
      if (s.url && s.sha256) {
        // For Feed (single-aspect) the scene omits variantId by spec — fall
        // back to the only entry on rendered[]. For Carousel each scene
        // carries the aspect's variantId.
        const vid = s.variantId ?? (rendered.length === 1 ? rendered[0]?.variantId : undefined);
        if (vid) {
          out.push({ variantId: vid, url: s.url, sha256: s.sha256 });
          seen.add(`${vid}|${s.sha256}`);
        }
      }
    }
    // Safety net: if a worker emitted only `rendered[]` and no scenes (older
    // contract), still include those entries.
    for (const r of rendered) {
      if (r.variantId && r.url && r.sha256 && !seen.has(`${r.variantId}|${r.sha256}`)) {
        out.push({ variantId: r.variantId, url: r.url, sha256: r.sha256 });
      }
    }
  }
  return out;
}

/**
 * Drop `shotNotes` from each scene before persistence. shotNotes is internal
 * producer direction (camera framing, "do not use 'guaranteed returns'"-style
 * safety warnings) that often literally contains the banned phrases it warns
 * against. The compliance scanner runs on the stringified shotlist as a single
 * blob and can't distinguish audience-facing voiceover/onScreenText from these
 * producer-only notes — so the notes have to be stripped before scanning.
 */
function stripShotNotes(scenes: unknown): unknown {
  if (!Array.isArray(scenes)) return scenes;
  return scenes.map((s) => {
    if (s === null || typeof s !== "object") return s;
    const { shotNotes: _drop, ...rest } = s as Record<string, unknown>;
    return rest;
  });
}

/** A VariantSpec → the CreativeVariants store properties (camelCase columns). */
function variantProperties(v: VariantSpec, runId: string): Record<string, unknown> {
  const props: Record<string, unknown> = {
    title: `${v.format} · ${v.aspect}`,
    runId,
    script: v.scriptId,
    createdBy: "MediaProd",
    approvalStatus: "Awaiting Approval",
    format: v.format,
    aspect: v.aspect,
    channels: v.channels,
    estimatedCostMyr: v.estCostMyr,
    shotlistEn: JSON.stringify(stripShotNotes(v.shotlistEn)),
    shotlistBm: JSON.stringify(stripShotNotes(v.shotlistBm)),
    thumbnailBrief: v.thumbnailBrief,
    assetFiles: v.assetFiles,
  };
  if (v.meta) {
    props.metaPrimaryTextEn = v.meta.primaryTextEn;
    props.metaPrimaryTextBm = v.meta.primaryTextMs;
    props.metaHeadlineEn = v.meta.headlineEn;
    props.metaHeadlineBm = v.meta.headlineMs;
    props.metaDescriptionEn = v.meta.descriptionEn;
    props.metaDescriptionBm = v.meta.descriptionMs;
    props.metaCtaType = v.meta.ctaType;
    props.metaTargetingJson = v.meta.targetingJson;
  }
  if (v.yt) {
    props.ytTitle = v.yt.title;
    props.ytDescription = v.yt.description;
    props.ytTags = v.yt.tags;
    props.ytCategory = v.yt.category;
  }
  if (v.organic) {
    props.organicLanguage = v.organic.language;
    props.organicCaptionEn = v.organic.captionEn;
    props.organicCaptionBm = v.organic.captionMs;
    props.organicHashtagsIg = v.organic.hashtagsIg;
    props.organicHashtagsFb = v.organic.hashtagsFb;
  }
  return props;
}

/**
 * Look up the Reel row id pre-created by P1a-reels-prepare, keyed by
 * variantId hash (deterministic via shared::variantId). The Reel worker
 * has already written reelHeygenJobId + renderState + assetFiles into
 * that row; P3-persist now fills the packaging fields with the same
 * fillOnlyIfEmpty semantics used for AuthorityArticles in P4-enrich —
 * never overwrites a field the worker (or a human HG3 edit) populated.
 */
function reelRowIdByVariantId(run: RunState): Map<string, string> {
  const reels = reelUnitsFromP1(run);
  const p1a = stepResult<unknown[]>(run, "P1a-reels-prepare") ?? [];
  const out = new Map<string, string>();
  for (let i = 0; i < reels.length; i++) {
    const created = p1a[i] as { ok?: boolean; id?: string } | undefined;
    if (!created?.ok || typeof created.id !== "string") continue;
    const unit = reels[i]!;
    out.set(variantId(unit.scriptId, "Reel", "9:16"), created.id);
  }
  return out;
}

/**
 * Extract per-reel asset results from the P2-render payloads, keyed by the
 * deterministic variantId hash. The orchestrator persists these authoritatively
 * (B-037 L1) rather than relying on the worker's own row write. Reel payloads
 * carry a top-level `assetFiles` + `renderState`; statics carry `scenes`/
 * `rendered` and are skipped (their hash never matches a reel unit).
 */
export function reelRenderResultsOf(
  run: RunState,
): Map<string, { assetFiles: { url: string; sha256: string }[]; renderState: string | null }> {
  const reelHashes = new Set(
    reelUnitsFromP1(run).map((u) => variantId(u.scriptId, "Reel", "9:16")),
  );
  const p2 = stepResult<unknown[]>(run, "P2-render") ?? [];
  const out = new Map<
    string,
    { assetFiles: { url: string; sha256: string }[]; renderState: string | null }
  >();
  for (const raw of p2) {
    let payload: unknown = raw;
    if (typeof payload === "string" && payload.trimStart().startsWith("{")) {
      try {
        payload = JSON.parse(payload);
      } catch {
        continue;
      }
    }
    if (payload === null || typeof payload !== "object") continue;
    const vid = (payload as { variantId?: unknown }).variantId;
    if (typeof vid !== "string" || !reelHashes.has(vid)) continue;
    const af = (payload as { assetFiles?: unknown }).assetFiles;
    const rs = (payload as { renderState?: unknown }).renderState;
    out.set(vid, {
      assetFiles: Array.isArray(af) ? (af as { url: string; sha256: string }[]) : [],
      renderState: typeof rs === "string" ? rs : null,
    });
  }
  return out;
}

/**
 * Build the P3-persist write calls. Exported as a pure seam so the reel
 * persistence split (B-037 L1b) can be unit-tested without the engine.
 *
 * Statics: one `create` each. Reels (with a pre-created P1a row): a fill-only
 * packaging update (so a re-walk preserves human HG3 edits) PLUS a *definitive*
 * `{assetFiles, renderState}` update read from the worker's P2 payload via
 * `reelRenderResultsOf`. The definitive write is what makes the orchestrator —
 * not the worker's own row write — authoritative for reel assets; it must not
 * be fill-only, or a re-render could never refresh a non-empty value.
 */
export function p3PersistCalls(run: RunState): { tool: string; args: Record<string, unknown> }[] {
  const plan = foldCreativePlan(run.runId, stepResult<unknown>(run, "P1-fanout"));
  const specs = deriveSpecs(plan, renderResultsOf(run));
  const reelRowIds = reelRowIdByVariantId(run);
  const reelResults = reelRenderResultsOf(run);
  return [
    ...specs.flatMap((v) => {
      if (v.format === "Reel") {
        const id = reelRowIds.get(v.variantId);
        if (!id) {
          // No pre-created row (pipeline off / no reels) — fall back to create.
          return [
            {
              tool: "mcp__store__create",
              args: { entity: "CreativeVariants", props: variantProperties(v, run.runId) },
            },
          ];
        }
        // Packaging fill-only (preserve human HG3 edits on a re-walk); strip
        // assetFiles so it never rides the fill-only path (where an existing
        // null/[] would be ambiguous against the worker's real assets).
        const { assetFiles: _omitAssets, ...packaging } = variantProperties(v, run.runId);
        const calls: { tool: string; args: Record<string, unknown> }[] = [
          {
            tool: "mcp__store__update",
            args: { entity: "CreativeVariants", id, props: packaging, opts: { fillOnlyIfEmpty: true } },
          },
        ];
        // Definitive asset write from the worker payload (the L1 fix).
        const rr = reelResults.get(v.variantId);
        if (rr) {
          const assetProps: Record<string, unknown> = {};
          if (rr.renderState) assetProps.renderState = rr.renderState;
          if (rr.assetFiles.length > 0) assetProps.assetFiles = rr.assetFiles;
          if (Object.keys(assetProps).length > 0) {
            calls.push({
              tool: "mcp__store__update",
              args: { entity: "CreativeVariants", id, props: assetProps },
            });
          }
        }
        return calls;
      }
      return [
        {
          tool: "mcp__store__create",
          args: { entity: "CreativeVariants", props: variantProperties(v, run.runId) },
        },
      ];
    }),
    // Trailing call: the approved AuthorityArticles for P4's article pass.
    {
      tool: "mcp__store__query",
      args: {
        entity: "AuthorityArticles",
        filter: { runId: run.runId, approvalStatus: "Approved" },
        fields: [
          "titleEn",
          "topic",
          "targetQuery",
          "bodyEn",
          "slug",
          "description",
          "readingTime",
          "keywords",
          "topicTag",
          "ogImageUrl",
        ],
      },
    },
  ];
}

const p3Persist: StepSpec = {
  id: "P3-persist",
  kind: "write",
  build: (run): Step => ({ kind: "write", stepId: "P3-persist", calls: p3PersistCalls(run) }),
};

// ── P4-enrich (Articles pass) ────────────────────────────────────────────

interface ArticleRow {
  id: string;
  titleEn: string;
  topic: string;
  targetQuery: string;
  bodyEn: string;
  slug: string;
  description: string;
  readingTime: string;
  keywords: string[];
  topicTag: string;
  ogImageUrl: string;
}

function articleRowOf(raw: unknown): ArticleRow {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (k: string): string => (typeof r[k] === "string" ? (r[k] as string) : "");
  const arr = (k: string): string[] => (Array.isArray(r[k]) ? (r[k] as string[]) : []);
  return {
    id: str("id") || str("rowId"),
    titleEn: str("titleEn") || str("title"),
    topic: str("topic"),
    targetQuery: str("targetQuery"),
    bodyEn: str("bodyEn"),
    slug: str("slug"),
    description: str("description"),
    readingTime: str("readingTime"),
    keywords: arr("keywords"),
    topicTag: str("topicTag"),
    ogImageUrl: str("ogImageUrl"),
  };
}

/** Fill-only-if-empty packaging update — never overwrites a human HG3 edit. */
function articleEnrichProps(a: ArticleRow): Record<string, unknown> {
  const pkg = deriveArticlePackaging({
    titleEn: a.titleEn,
    topic: a.topic,
    targetQuery: a.targetQuery,
    bodyEn: a.bodyEn,
  });
  const props: Record<string, unknown> = {};
  if (!a.slug) props.slug = pkg.slug;
  if (!a.description) props.description = pkg.description;
  if (!a.readingTime) props.readingTime = pkg.readingTime;
  if (a.keywords.length === 0) props.keywords = pkg.keywords;
  if (!a.topicTag) props.topicTag = pkg.topicTag;
  if (!a.ogImageUrl) props.ogImageUrl = pkg.ogImageUrl;
  return props;
}

const p4Enrich: StepSpec = {
  id: "P4-enrich",
  kind: "write",
  build: (run): Step => {
    const p3 = stepResult<unknown[]>(run, "P3-persist") ?? [];
    const rawRows = rowsOf(p3[p3.length - 1]);
    const articleRows = rawRows.map(articleRowOf);
    return {
      kind: "write",
      stepId: "P4-enrich",
      calls: articleRows
        .map((a) => ({ id: a.id, props: articleEnrichProps(a) }))
        .filter((x) => Object.keys(x.props).length > 0)
        .map((x) => ({
          tool: "mcp__store__update",
          args: {
            entity: "AuthorityArticles",
            id: x.id,
            props: x.props,
            fillOnlyIfEmpty: true,
          },
        })),
    };
  },
};

// ── P5-confirm ───────────────────────────────────────────────────────────

/** A CreativeVariants store row → ProduceVariant (camelCase store columns). */
function projectVariant(row: Record<string, unknown>): ProduceVariant {
  const str = (k: string): string => (typeof row[k] === "string" ? (row[k] as string) : "");
  const num = (k: string): number => (typeof row[k] === "number" ? (row[k] as number) : 0);
  const arr = (k: string): unknown[] => (Array.isArray(row[k]) ? (row[k] as unknown[]) : []);
  return {
    id: str("id"),
    scriptId: str("script"),
    format: str("format"),
    aspect: str("aspect"),
    channels: arr("channels") as string[],
    assetFiles: arr("assetFiles") as { url: string; sha256: string }[],
    renderState: str("renderState"),
    metaSpecComplete: str("metaPrimaryTextEn").length > 0,
    organicSpecComplete: str("organicCaptionEn").length > 0,
    complianceCheck: row["complianceCheck"] === true,
    estCostMyr: num("estimatedCostMyr"),
    organicCaptionEn: str("organicCaptionEn"),
    organicCaptionBm: str("organicCaptionBm"),
  };
}

const p5Confirm: StepSpec = {
  id: "P5-confirm",
  kind: "write",
  build: (run): Step => ({
    kind: "write",
    stepId: "P5-confirm",
    calls: [
      {
        tool: "mcp__store__query",
        args: {
          entity: "Scripts",
          filter: { runId: run.runId, approvalStatus: "Approved" },
          fields: ["claimBindings"],
        },
      },
      {
        tool: "mcp__store__query",
        args: {
          entity: "CreativeVariants",
          filter: { runId: run.runId },
          fields: [
            "script",
            "format",
            "aspect",
            "channels",
            "assetFiles",
            "metaPrimaryTextEn",
            "organicCaptionEn",
            "organicCaptionBm",
            "complianceCheck",
            "estimatedCostMyr",
            "renderState",
          ],
        },
      },
    ],
  }),
  verify: (run, result): VerifyResult => {
    const arr = Array.isArray(result) ? result : [];
    const scripts = rowsOf(arr[0]).map((r): ProduceScript => {
      const row = r as { id?: unknown; claimBindings?: unknown };
      return {
        id: typeof row.id === "string" ? row.id : "",
        claimBindings: Array.isArray(row.claimBindings)
          ? (row.claimBindings as ProduceScript["claimBindings"])
          : [],
      };
    });
    const variants = rowsOf(arr[1]).map((r) => projectVariant(r as Record<string, unknown>));
    const plan = foldCreativePlan(run.runId, stepResult<unknown>(run, "P1-fanout"));
    const reportedTotal = plan.creatives.reduce((a, c) => a + c.estCostMyr, 0);
    const p2 = stepResult<unknown[]>(run, "P2-render");
    const renderWorkersRan = Array.isArray(p2) ? p2.length : 0;
    const base = verifyProduce(scripts, variants, reportedTotal, renderWorkersRan, reelPipelineEnabled());
    // ADR-030: chart bindings — chartRef ∈ Script data bindings, concept
    // visuals digit-free (B-038 + B-036), over the CD's CreativePlan scenes.
    const cb = verifyChartBindings(scripts, plan.creatives);
    const problems = [...base.problems, ...cb.problems];
    const flags = [
      ...((base.data?.flags as string[] | undefined) ?? []),
      ...((cb.data?.flags as string[] | undefined) ?? []),
    ];
    return { ok: problems.length === 0, problems, ...(flags.length > 0 ? { data: { flags } } : {}) };
  },
};

// ── P6-gate ──────────────────────────────────────────────────────────────

/** Count approved-variant rows in a store query result. */
function approvedCount(result: unknown): number {
  return rowsOf(result).length;
}

const p6Gate: StepSpec = {
  id: "P6-gate",
  kind: "gate",
  build: (run): Step => ({
    kind: "gate",
    stepId: "P6-gate",
    gate: "HG3",
    message: `Creative Variants produced and verified. Awaiting HUMAN GATE 3 — review the variant specs and rendered assets in the webapp at ${reviewUiUrl()}/review/creative-variants, then approve to proceed.`,
    check: {
      tool: "mcp__store__query",
      args: {
        entity: "CreativeVariants",
        filter: { runId: run.runId, approvalStatus: "Approved" },
      },
    },
  }),
  verify: (_run, result): VerifyResult =>
    approvedCount(result) > 0
      ? { ok: true, problems: [] }
      : {
          ok: false,
          problems: ["HG3 not cleared — no approved CreativeVariants for this run"],
        },
};

export const produceStage: StageDefinition = {
  id: "produce",
  steps: [p0Scripts, p1Fanout, p1aReelsPrepare, p2Render, p3Persist, p4Enrich, p5Confirm, p6Gate],
};
