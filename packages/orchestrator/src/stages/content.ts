import type { RunState, StageDefinition, Step, StepSpec, VerifyResult } from "../types.js";
import { verifyContent, verifyClaimBindings, type ChartIndex } from "../verifiers/verify-content.js";
import { loadAllCharts } from "@engineerdad/corpus";
import { reviewUiUrl } from "../webapp-url.js";

/** Build the live chart index (id → traceNumbers) for the C1 figures-trace. */
async function chartIndex(): Promise<ChartIndex> {
  const charts = await loadAllCharts();
  return new Map(charts.map((c) => [c.id, c.traceNumbers]));
}

/**
 * The content stage — replaces the Phase-6 single content-writer spawn with a
 * per-Brief fanout (E-027). C0-briefs reads the run's approved Briefs;
 * C1-fanout dispatches one content-writer worker per Brief (Single-Brief
 * worker mode); C2-articles authors the cross-Brief AEO/GEO articles in a
 * single light spawn; C3-gate is HG2.
 */

/** Flatten one mcp__store__query call-result into a row array. */
function rowsOf(callResult: unknown): unknown[] {
  return Array.isArray(callResult) ? callResult : [];
}

function stepResult<T>(run: RunState, stepId: string): T | undefined {
  return run.steps.find((s) => s.stepId === stepId)?.result as T | undefined;
}

/** Extract the Briefs array from C0-briefs' write-step result (an array of call results). */
function briefsOf(run: RunState): unknown[] {
  const c0 = stepResult<unknown[]>(run, "C0-briefs");
  if (!Array.isArray(c0) || c0.length === 0) return [];
  return rowsOf(c0[0]);
}

function briefIdOf(brief: unknown): string {
  if (brief !== null && typeof brief === "object") {
    const id = (brief as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return "";
}

// ── C0-briefs ────────────────────────────────────────────────────────────

const c0Briefs: StepSpec = {
  id: "C0-briefs",
  kind: "write",
  build: (run): Step => ({
    kind: "write",
    stepId: "C0-briefs",
    calls: [
      {
        tool: "mcp__store__query",
        args: {
          entity: "Briefs",
          filter: { runId: run.runId, approvalStatus: "Approved" },
        },
      },
    ],
  }),
  verify: (_run, result): VerifyResult => {
    const arr = Array.isArray(result) ? result : [];
    return rowsOf(arr[0]).length > 0
      ? { ok: true, problems: [] }
      : { ok: false, problems: ["C0-briefs returned no approved Briefs for this run"] };
  },
};

// ── C1-fanout ────────────────────────────────────────────────────────────

const c1Fanout: StepSpec = {
  id: "C1-fanout",
  kind: "fanout",
  build: (run): Step => {
    const briefs = briefsOf(run);
    if (briefs.length === 0) {
      throw new Error(
        "C1-fanout: no approved Briefs in the C0-briefs result — cannot dispatch content-writer workers",
      );
    }
    return {
      kind: "fanout",
      stepId: "C1-fanout",
      worker: "content-writer",
      units: briefs.map((brief) => {
        const briefId = briefIdOf(brief);
        return {
          spawnPrompt: [
            `Run ${run.runId}: you are content-writer in Single-Brief worker mode.`,
            `Your FIRST action: call mcp__store__get({ entity: "Briefs", id: "${briefId}" }) to fetch your assigned Brief.`,
            "",
            "Then operate on EXACTLY ONE Brief. Produce ≥30 bilingual hooks",
            "across all six emotional registers (≥3 each), ≥3 scripts permuted",
            "from your hook bank × value bank, and write only the Scripts to the",
            "store (no hook-bank column). Enforce proofRatio ≥ 0.80 on YOUR scripts.",
            "Return your unit JSON { briefId, hooks, scripts, proofRefs?, notes? }.",
          ].join("\n"),
        };
      }),
    };
  },
  verify: async (_run, result): Promise<VerifyResult> => {
    const base = verifyContent(result);
    const cb = verifyClaimBindings(result, await chartIndex());
    const problems = [...base.problems, ...cb.problems];
    return { ok: problems.length === 0, problems, ...(cb.data ? { data: cb.data } : {}) };
  },
};

// ── C2-articles ──────────────────────────────────────────────────────────

const c2Articles: StepSpec = {
  id: "C2-articles",
  kind: "spawn",
  build: (run): Step => {
    const briefs = briefsOf(run);
    const briefIds = briefs.map(briefIdOf).filter((id) => id.length > 0);
    return {
      kind: "spawn",
      stepId: "C2-articles",
      agent: "content-writer",
      spawnPrompt: [
        `Run ${run.runId}: you are content-writer in Article mode.`,
        "Your FIRST action: for each Brief id below, call",
        `mcp__store__get({ entity: "Briefs", id }) to fetch the Brief.`,
        "Then identify 1–2 cross-Brief AEO/GEO themes and author one bilingual",
        "authority article per theme (800–1500 words, markdown body + FAQ block +",
        "citations). Write each to AuthorityArticles. Do NOT produce hooks or",
        "Scripts — those are owned by C1-fanout workers.",
        "Return { articles: [...], notes?: [...] }.",
        "",
        `BRIEF IDS: ${JSON.stringify(briefIds)}`,
      ].join("\n"),
    };
  },
};

// ── C3-gate ──────────────────────────────────────────────────────────────

const c3Gate: StepSpec = {
  id: "C3-gate",
  kind: "gate",
  build: (run): Step => ({
    kind: "gate",
    stepId: "C3-gate",
    gate: "HG2",
    message: `Scripts and articles authored. Awaiting HUMAN GATE 2 — review Scripts at ${reviewUiUrl()}/review/scripts and AuthorityArticles at ${reviewUiUrl()}/review/authority-articles, then approve to proceed to produce.`,
    check: {
      tool: "mcp__store__query",
      args: {
        entity: "Scripts",
        filter: { runId: run.runId, approvalStatus: "Approved" },
      },
    },
  }),
  verify: (_run, result): VerifyResult =>
    rowsOf(result).length > 0
      ? { ok: true, problems: [] }
      : { ok: false, problems: ["HG2 not cleared — no approved Scripts for this run"] },
};

export const contentStage: StageDefinition = {
  id: "content",
  steps: [c0Briefs, c1Fanout, c2Articles, c3Gate],
};
