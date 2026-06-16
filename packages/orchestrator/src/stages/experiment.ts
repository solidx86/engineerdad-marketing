import type { RunState, StageDefinition, Step, StepSpec, VerifyResult } from "../types.js";
import type { ExperimentParams, DecisionMemoV2 } from "@engineerdad/shared";
import { classifyExperimentStatus } from "@engineerdad/shared";
import {
  mapCellsToVariants,
  applyAllocation,
  type AllocatedCell,
} from "../experiment/allocation.js";
import { verifyExperiment } from "../verifiers/verify-experiment.js";

/**
 * The experiment stage — a pure 3-step chain that designs a factorial
 * experiment from the run's approved Variants. No gate of its own; the run
 * flows straight into `distribute`.
 *
 * Phase 3 ships this definition + verifier. Phase 5 adds it to the live
 * registry and finalizes the store-row → ExpVariantRow projection in X1.
 */

/** A variant projected to what the allocation overlay needs. */
interface ExpVariantRow {
  pageId: string;
  factorTags: Record<string, string>;
  budgetBucket: "70" | "20" | "10" | null;
}

interface DesignCell {
  cellId: string;
  factorLevels: Record<string, string>;
}

function stepResult<T>(run: RunState, stepId: string): T | undefined {
  return run.steps.find((s) => s.stepId === stepId)?.result as T | undefined;
}

/** Read experimentParams from the synthesize memo (S1-reason step result). */
function memoParams(run: RunState): ExperimentParams | undefined {
  const memo = stepResult<DecisionMemoV2>(run, "S1-reason");
  return memo?.experimentParams;
}

/**
 * Brain declined to design an experiment this cycle. Either the synthesize
 * memo is missing (legacy run) or experimentParams is absent / has empty
 * factors. The experiment stage no-ops; the run flows past into distribute.
 */
function experimentDeclined(run: RunState): boolean {
  const p = memoParams(run);
  return !p || !p.factors || p.factors.length === 0;
}

/** Flatten one mcp__store__query call-result into a row array. */
function rowsOf(callResult: unknown): unknown[] {
  return Array.isArray(callResult) ? callResult : [];
}

type RawVariantRow = { id: string; script?: string | null };
type RawScriptRow = { brief?: string | null };
type RawBriefRow = { angle?: string | null; budgetBucket?: string | null };

/**
 * Walk variant → script → brief in-memory to assemble the ExpVariantRow
 * the allocation overlay expects. Degrades to empty factorTags + null
 * budgetBucket when any link is missing, so a partial run state (deleted
 * brief, etc.) doesn't take the whole stage down — observable downstream
 * as a cell with empty variantPageIds.
 */
function projectExpVariant(
  variant: RawVariantRow,
  scriptsById: Map<string, RawScriptRow>,
  briefsById: Map<string, RawBriefRow>,
): ExpVariantRow {
  const script = variant.script ? scriptsById.get(variant.script) : undefined;
  const brief = script?.brief ? briefsById.get(script.brief) : undefined;
  const factorTags: Record<string, string> = {};
  if (brief?.angle) factorTags.angle = brief.angle;
  const raw = brief?.budgetBucket;
  const budgetBucket: "70" | "20" | "10" | null =
    raw === "70" || raw === "20" || raw === "10" ? raw : null;
  return { pageId: variant.id, factorTags, budgetBucket };
}

/** The cells out of an experiment.design MCP result.
 *  The MCP emits snake_case (`cell_id`, `factor_levels`) per its public schema;
 *  the orchestrator's downstream pure functions (mapCellsToVariants / applyAllocation)
 *  expect camelCase. Translate here so the shape mismatch can't bubble into the
 *  allocation overlay as a silent `undefined` access.
 */
function designCellsOf(callResult: unknown): DesignCell[] {
  if (callResult === null || typeof callResult !== "object") return [];
  const cells = (callResult as { cells?: unknown }).cells;
  if (!Array.isArray(cells)) return [];
  return cells
    .map((raw) => {
      if (raw === null || typeof raw !== "object") return null;
      const r = raw as {
        cell_id?: unknown;
        cellId?: unknown;
        factor_levels?: unknown;
        factorLevels?: unknown;
      };
      const cellId = typeof r.cellId === "string" ? r.cellId : typeof r.cell_id === "string" ? r.cell_id : null;
      const levels = (r.factorLevels ?? r.factor_levels) as unknown;
      if (cellId === null || levels === null || typeof levels !== "object") return null;
      return { cellId, factorLevels: levels as Record<string, string> };
    })
    .filter((c): c is DesignCell => c !== null);
}

/** Re-derive the allocated cells from the run's X1 + X2 step results. */
function allocatedCellsFor(run: RunState): AllocatedCell[] {
  const x1 = stepResult<unknown[]>(run, "X1-query") ?? [];
  const x2 = stepResult<unknown[]>(run, "X2-design") ?? [];
  const rawVariants = rowsOf(x1[0]) as RawVariantRow[];
  const rawScripts = rowsOf(x1[3]) as Array<RawScriptRow & { id: string }>;
  const rawBriefs = rowsOf(x1[4]) as Array<RawBriefRow & { id: string }>;
  const scriptsById = new Map<string, RawScriptRow>(rawScripts.map((s) => [s.id, s]));
  const briefsById = new Map<string, RawBriefRow>(rawBriefs.map((b) => [b.id, b]));
  const variants = rawVariants.map((v) => projectExpVariant(v, scriptsById, briefsById));
  const designCells = designCellsOf(x2[0]);
  return applyAllocation(mapCellsToVariants(designCells, variants));
}

/** True when X1's Experiments query already returned a row for this run. */
function experimentExists(run: RunState): boolean {
  const x1 = stepResult<unknown[]>(run, "X1-query") ?? [];
  return rowsOf(x1[2]).length > 0;
}

const x1Query: StepSpec = {
  id: "X1-query",
  kind: "write",
  build: (run): Step => ({
    kind: "write",
    stepId: "X1-query",
    calls: [
      {
        tool: "mcp__store__query",
        args: {
          entity: "CreativeVariants",
          filter: { runId: run.runId, approvalStatus: "Approved" },
          fields: ["script"],
        },
      },
      {
        tool: "mcp__store__query",
        args: { entity: "Hypotheses", filter: { runId: run.runId } },
      },
      {
        tool: "mcp__store__query",
        args: { entity: "Experiments", filter: { runId: run.runId } },
      },
      {
        tool: "mcp__store__query",
        args: {
          entity: "Scripts",
          filter: { runId: run.runId },
          fields: ["brief"],
        },
      },
      {
        tool: "mcp__store__query",
        args: {
          entity: "Briefs",
          filter: { runId: run.runId },
          fields: ["angle", "budgetBucket"],
        },
      },
    ],
  }),
};

const x2Design: StepSpec = {
  id: "X2-design",
  kind: "write",
  build: (run): Step => {
    if (experimentExists(run)) {
      return { kind: "write", stepId: "X2-design", calls: [] }; // idempotent no-op
    }
    if (experimentDeclined(run)) {
      return { kind: "write", stepId: "X2-design", calls: [] }; // legitimate-skip
    }
    const p = memoParams(run)!;
    return {
      kind: "write",
      stepId: "X2-design",
      calls: [
        {
          tool: "mcp__experiment__design",
          args: {
            hypothesis: p.hypothesis,
            factors: p.factors,
            hold_constant: p.holdConstant,
            primary_metric: p.primaryMetric,
            daily_budget_myr: p.dailyBudgetMyr,
            duration_days: p.durationDays,
          },
        },
      ],
    };
  },
};

const x3Write: StepSpec = {
  id: "X3-write",
  kind: "write",
  build: (run): Step => {
    if (experimentExists(run)) {
      return { kind: "write", stepId: "X3-write", calls: [] }; // idempotent no-op
    }
    if (experimentDeclined(run)) {
      return { kind: "write", stepId: "X3-write", calls: [] }; // legitimate-skip
    }
    const cells = allocatedCellsFor(run);
    const occupied = cells.filter((c) => c.variantPageIds.length > 0).length;
    const experimentStatus = classifyExperimentStatus({
      occupied,
      total: cells.length,
    });
    const x1 = stepResult<unknown[]>(run, "X1-query") ?? [];
    // Hypotheses rows come back with `id` from the store's ALWAYS_RETURNED
    // projection — there is no `pageId` column. The earlier `pageId` field
    // here was a Notion-era leftover that silently filtered every row out,
    // so the testExperiment back-link was never written (B-024).
    const hypotheses = rowsOf(x1[1]) as { id?: string }[];
    return {
      kind: "write",
      stepId: "X3-write",
      calls: [
        {
          tool: "mcp__store__create",
          label: "experiment",
          args: {
            entity: "Experiments",
            props: {
              runId: run.runId,
              cells: JSON.stringify(cells),
              experimentStatus,
            },
          },
        },
        ...hypotheses
          .filter((h): h is { id: string } => typeof h.id === "string")
          .map((h) => ({
            tool: "mcp__store__update",
            args: {
              entity: "Hypotheses",
              id: h.id,
              // `$experiment.id` unwraps the create result's id field
              // (mcp__store__create returns {ok, id}); the previous
              // `$experiment` value substituted the whole result object
              // into a string field by accident.
              props: { testExperiment: "$experiment.id" },
            },
          })),
      ],
    };
  },
  verify: (run, result): VerifyResult => {
    if (experimentExists(run)) return { ok: true, problems: [] }; // idempotent
    if (experimentDeclined(run)) return { ok: true, problems: [] }; // legitimate-skip
    const calls = Array.isArray(result) ? result : [];
    const rowCreated = calls.length > 0 && calls[0] !== null && calls[0] !== undefined;
    return verifyExperiment(allocatedCellsFor(run), rowCreated);
  },
};

export const experimentStage: StageDefinition = {
  id: "experiment",
  steps: [x1Query, x2Design, x3Write],
};

/** Test-only export. Do not depend on this from production code. */
export const __projectExpVariantForTests = projectExpVariant;
