import {
  assignSchedule,
  type ScheduleInput,
  type ScheduleResult,
} from "@engineerdad/shared/derive";
import type { RunState, StageDefinition, Step, StepSpec, VerifyResult } from "../types.js";
import { verifySchedule } from "../verifiers/verify-schedule.js";

/**
 * The schedule stage — runs after HG3, stamps each approved variant's publish
 * datetime. A pure 2-step write chain: S1-query reads the run's approved
 * CreativeVariants, S2-stamp runs assignSchedule and writes the organic slots
 * back to the store. Paid flights are computed and verified here too, but
 * carry no row field — distribute applies them to Meta adsets (Phase 5).
 *
 * Phase 4 ships this definition + verifier. Phase 5 wires it into the live
 * registry as the loop's last stage and finalizes the store-row → SchedRow
 * projection in S1.
 */

/** A CreativeVariants row projected to what assignSchedule needs. The row's
 *  `id` is the variant identifier — there is no separate `variantId` column
 *  on CreativeVariants. */
interface SchedRow {
  id: string;
  format: string;
  channels: string[];
}

const ORGANIC = "Meta-organic";

function stepResult<T>(run: RunState, stepId: string): T | undefined {
  return run.steps.find((s) => s.stepId === stepId)?.result as T | undefined;
}

/** Flatten one mcp__store__query call-result into a row array. */
function rowsOf(callResult: unknown): unknown[] {
  return Array.isArray(callResult) ? callResult : [];
}

/** The run's start instant — the engine mints `run_<epoch-seconds>`, so the
 *  schedule anchor is deterministic and `plan` stays pure (resumable). */
function runStart(runId: string): Date {
  const m = /^run_(\d+)$/.exec(runId);
  return m ? new Date(Number(m[1]) * 1000) : new Date(0);
}

/** The approved CreativeVariants rows out of the S1-query result. */
function schedRows(run: RunState): SchedRow[] {
  const s1 = stepResult<unknown[]>(run, "S1-query") ?? [];
  return rowsOf(s1[0]) as SchedRow[];
}

/** Re-derive the schedule from the S1-query rows — used by S2 build + verify. */
function scheduleFor(run: RunState): { rows: SchedRow[]; result: ScheduleResult } {
  const rows = schedRows(run);
  const inputs: ScheduleInput[] = rows.map((r) => ({
    variantId: r.id,
    format: r.format,
    channels: r.channels,
  }));
  return { rows, result: assignSchedule(inputs, { now: runStart(run.runId) }) };
}

const s1Query: StepSpec = {
  id: "S1-query",
  kind: "write",
  build: (run): Step => ({
    kind: "write",
    stepId: "S1-query",
    calls: [
      {
        tool: "mcp__store__query",
        args: {
          entity: "CreativeVariants",
          filter: { runId: run.runId, approvalStatus: "Approved" },
          fields: ["format", "channels"],
        },
      },
    ],
  }),
};

const s2Stamp: StepSpec = {
  id: "S2-stamp",
  kind: "write",
  build: (run): Step => {
    const { rows, result } = scheduleFor(run);
    const slotByVariant = new Map(result.organic.map((s) => [s.variantId, s.scheduledForUtc]));
    return {
      kind: "write",
      stepId: "S2-stamp",
      calls: rows
        .filter((r) => r.channels.includes(ORGANIC))
        .map((r) => {
          // Drizzle's timestamp column (mode "date") serializes via
          // value.toISOString(), so we hand it a Date — never an ISO string.
          const iso = slotByVariant.get(r.id);
          return {
            tool: "mcp__store__update",
            args: {
              entity: "CreativeVariants",
              id: r.id,
              props: { organicScheduledFor: iso ? new Date(iso) : null },
            },
          };
        }),
    };
  },
  verify: (run): VerifyResult => {
    const { rows, result } = scheduleFor(run);
    return verifySchedule(
      rows.map((r) => ({ variantId: r.id, channels: r.channels })),
      result,
    );
  },
};

export const scheduleStage: StageDefinition = {
  id: "schedule",
  steps: [s1Query, s2Stamp],
};
