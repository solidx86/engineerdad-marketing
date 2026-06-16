import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { plan, verify, advance } from "./engine.js";
import { fixtureStage } from "./stages/fixture.js";
import type { StageDefinition, Step } from "./types.js";
import postgres from "postgres";
import { loadPayload } from "./postgres.js";
import { closeDb } from "./db.js";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";

beforeEach(async () => {
  await truncatePg();
});

afterAll(async () => {
  await closeTruncatePg();
  await closeDb();
});

const registry = [fixtureStage];

/** Stand in for the general-purpose worker the conductor spawns for a spawn Step. */
function simulateWorker(step: Step): unknown {
  if (step.kind !== "spawn") throw new Error(`unexpected step kind: ${step.kind}`);
  return { ok: true, step: step.stepId };
}

describe("engine integration over the fixture stage", () => {
  it("drives plan -> verify -> advance to completion", async () => {
    const minted = await plan({ args: "" }, registry);
    const runId = minted.runId;
    let step: Step = minted.step;
    const seen: string[] = [];

    let guard = 0;
    while (step.kind !== "done") {
      if (++guard > 10) throw new Error("loop did not terminate");
      if (step.kind !== "spawn") throw new Error(`unexpected step kind: ${step.kind}`);
      seen.push(step.stepId);
      const result = simulateWorker(step);
      expect((await verify(runId, step.stepId, result, registry)).ok).toBe(true);
      await advance(runId, step.stepId, result, registry);
      step = (await plan({ runId }, registry)).step;
    }

    expect(seen).toEqual(["fixture-1", "fixture-2"]);
    expect(step.kind).toBe("done");
  });

  it("is resumable — plan after step 1 returns step 2", async () => {
    const first = await plan({}, registry);
    const runId = first.runId;
    expect(first.step).toMatchObject({ stepId: "fixture-1" });
    await advance(runId, "fixture-1", simulateWorker(first.step), registry);

    const resumed = await plan({ runId }, registry);
    expect(resumed.step).toMatchObject({ stepId: "fixture-2" });
  });
});

/** ADR-024 Phase C: async build + BuildContext.stageInput integration.
 *
 *  Exercises the engine's new contract: a stage spec whose `build` is async
 *  and uses `ctx.stageInput` to persist per-unit worker-input rows. Verifies
 *  (a) the input rows land with payload_kind='input', (b) the returned step's
 *  spawnPrompts embed the sr_ refs, (c) re-plan returns the same refs
 *  (deterministic idempotency under the partial unique index from Phase A). */
describe("engine integration — ADR-024 ctx.stageInput", () => {
  const admin = postgres(
    process.env.DATABASE_URL ??
      "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test",
    { max: 2 },
  );

  function stagingRegistry(): StageDefinition[] {
    return [
      {
        id: "fixture",
        steps: [
          {
            id: "stage-fanout",
            kind: "fanout",
            build: async (_run, ctx): Promise<Step> => {
              const units = await Promise.all(
                [0, 1, 2].map(async (i) => {
                  const ref = await ctx.stageInput(i, { unit: i, payload: `hello-${i}` });
                  return { spawnPrompt: `read ${ref}` };
                }),
              );
              return { kind: "fanout", stepId: "stage-fanout", worker: "general-purpose", units };
            },
          },
        ],
      },
    ];
  }

  it("async build with ctx.stageInput persists per-unit input rows and embeds refs", async () => {
    const reg = stagingRegistry();
    const { runId, step } = await plan({}, reg);

    if (step.kind !== "fanout") throw new Error(`expected fanout, got ${step.kind}`);
    expect(step.units).toHaveLength(3);

    // (a) each unit's spawnPrompt embeds a sr_ ref
    const refs = step.units.map((u) => {
      const m = u.spawnPrompt.match(/sr_[A-Z0-9]+/);
      if (!m) throw new Error(`no sr_ ref in spawnPrompt: ${u.spawnPrompt}`);
      return m[0];
    });
    expect(new Set(refs).size).toBe(3); // distinct refs across units

    // (b) input rows exist in step_results with payload_kind='input'
    const rows = await admin<{ id: string; payload_kind: string | null }[]>`
      SELECT id, payload_kind FROM orchestrator.step_results WHERE run_id = ${runId}
    `;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.payload_kind === "input")).toBe(true);

    // (c) the staged payloads round-trip
    for (let i = 0; i < 3; i++) {
      const payload = await loadPayload(refs[i]!);
      expect(payload).toEqual({ unit: i, payload: `hello-${i}` });
    }
  });

  it("re-plan returns the same refs (idempotency via partial unique index)", async () => {
    const reg = stagingRegistry();
    const { runId, step: step1 } = await plan({}, reg);
    if (step1.kind !== "fanout") throw new Error(`expected fanout`);
    const refs1 = step1.units.map((u) => u.spawnPrompt.match(/sr_[A-Z0-9]+/)![0]);

    const { step: step2 } = await plan({ runId }, reg);
    if (step2.kind !== "fanout") throw new Error(`expected fanout`);
    const refs2 = step2.units.map((u) => u.spawnPrompt.match(/sr_[A-Z0-9]+/)![0]);

    expect(refs2).toEqual(refs1);

    // Exactly 3 rows — no duplicates from the re-plan.
    const rows = await admin<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM orchestrator.step_results WHERE run_id = ${runId}
    `;
    expect(rows[0]!.count).toBe("3");
  });

  afterAll(async () => {
    await admin.end({ timeout: 5 });
  });
});
