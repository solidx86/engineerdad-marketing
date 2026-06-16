import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  loadRunState,
  closeDb,
  type ExecDeps,
  type StageDefinition,
  type Step,
  type VerifyResult,
  type Crud,
} from "@engineerdad/orchestrator";
import { truncatePg, closeTruncatePg } from "@engineerdad/shared/test-helpers";
// `Crud` is re-exported by @engineerdad/orchestrator via its store dep boundary —
// we use the runtime `complianceScan` from shared as the deps' scanner sentinel.
// Stub scanner — we never assert on it in this file (its invocation count is
// covered by `packages/orchestrator/src/exec.integration.test.ts`).
const complianceScan = (async () => ({ ok: true, problems: [] })) as unknown as ExecDeps["compliance"];
import { runEagerLoop, isConductorRelevant, makeHalt, makeGateStop } from "./eager.js";

beforeEach(async () => {
  await truncatePg();
});

afterAll(async () => {
  await closeTruncatePg();
  await closeDb();
});

function makeMockDeps(): { deps: ExecDeps; spies: Record<string, ReturnType<typeof vi.fn>> } {
  const spies = {
    create: vi.fn().mockResolvedValue({ ok: true, id: "id-1" }),
    query: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue({ ok: true }),
    setStatus: vi.fn().mockResolvedValue({ ok: true }),
    count: vi.fn().mockResolvedValue(0),
  };
  return {
    deps: { store: spies as unknown as Crud, compliance: complianceScan },
    spies,
  };
}

// A registry shaped like the real loops: a write step, a spawn step, a gate
// with a check, a terminal gate. Each step lets us assert the eager loop's
// branching behaviour without standing up the live LIVE_REGISTRY.
function makeRegistry(opts: {
  writeKind?: "ok" | "fail" | "unsupported";
  gateCheckResult?: { cleared: boolean };
} = {}): StageDefinition[] {
  const writeStep: Step =
    opts.writeKind === "unsupported"
      ? {
          kind: "write",
          stepId: "W1",
          calls: [{ tool: "mcp__not-a-tool", args: {} }],
        }
      : {
          kind: "write",
          stepId: "W1",
          calls: [
            {
              tool: "mcp__store__create",
              args: { entity: "Briefs", props: { title: "x", runId: "r" } },
            },
          ],
        };

  return [
    {
      id: "fixture",
      steps: [
        {
          id: "W1",
          kind: "write",
          build: () => writeStep,
          verify: (_run, _result): VerifyResult =>
            opts.writeKind === "fail"
              ? { ok: false, problems: ["w1 said no"] }
              : { ok: true, problems: [] },
        },
        {
          id: "S1",
          kind: "spawn",
          build: () => ({
            kind: "spawn",
            stepId: "S1",
            agent: "general-purpose",
            spawnPrompt: "do work",
          }),
        },
        {
          id: "G1",
          kind: "gate",
          build: () => ({
            kind: "gate",
            stepId: "G1",
            gate: "HG1",
            message: "awaiting HG1",
            check: { tool: "mcp__store__query", args: { entity: "Briefs", filter: {} } },
          }),
          verify: (_run, _result): VerifyResult =>
            (opts.gateCheckResult ?? { cleared: false }).cleared
              ? { ok: true, problems: [] }
              : { ok: false, problems: ["HG1 not cleared"] },
        },
      ],
    },
  ];
}

describe("isConductorRelevant", () => {
  it("returns true for spawn, fanout, done, halt, and check-less gate", () => {
    const cases: Step[] = [
      { kind: "spawn", stepId: "s", agent: "a", spawnPrompt: "p" },
      { kind: "fanout", stepId: "f", worker: "w", units: [{ spawnPrompt: "p" }] },
      { kind: "done", message: "d" },
      { kind: "halt", stepId: "h", reason: "r" },
      { kind: "gate", stepId: "g", gate: "HG", message: "m" },
    ];
    for (const step of cases) expect(isConductorRelevant(step)).toBe(true);
  });
  it("returns false for write and gate-with-check", () => {
    expect(
      isConductorRelevant({ kind: "write", stepId: "w", calls: [] }),
    ).toBe(false);
    expect(
      isConductorRelevant({
        kind: "gate",
        stepId: "g",
        gate: "HG",
        message: "m",
        check: { tool: "t", args: {} },
      }),
    ).toBe(false);
  });
});

describe("makeHalt + makeGateStop", () => {
  it("makeHalt joins problems with ';' into the reason", () => {
    expect(makeHalt("W1", ["a", "b", "c"])).toEqual({
      kind: "halt",
      stepId: "W1",
      reason: "a; b; c",
    });
  });
  it("makeGateStop strips the check field", () => {
    const out = makeGateStop({
      kind: "gate",
      stepId: "G1",
      gate: "HG1",
      message: "msg",
      check: { tool: "t", args: {} },
    });
    expect(out).toEqual({ kind: "gate", stepId: "G1", gate: "HG1", message: "msg" });
    expect((out as { check?: unknown }).check).toBeUndefined();
  });
});

describe("runEagerLoop", () => {
  it("executes a write step eagerly and returns the next conductor-relevant step", async () => {
    const { deps, spies } = makeMockDeps();
    const result = await runEagerLoop({}, makeRegistry({ writeKind: "ok" }), deps);

    // The eager loop ran W1 and then returned S1 (the first conductor-
    // relevant step). The conductor never saw W1.
    expect(result.step.kind).toBe("spawn");
    expect((result.step as { stepId: string }).stepId).toBe("S1");
    expect(spies.create).toHaveBeenCalledOnce();

    // The engine advanced past W1 — its row is marked done.
    const run = (await loadRunState(result.runId))!;
    expect(run.steps.find((s) => s.stepId === "W1")?.status).toBe("done");
  });

  it("returns a halt step when the write-step verifier fails", async () => {
    const { deps } = makeMockDeps();
    const result = await runEagerLoop({}, makeRegistry({ writeKind: "fail" }), deps);

    expect(result.step).toEqual({
      kind: "halt",
      stepId: "W1",
      reason: "w1 said no",
    });
    // W1 is NOT advanced — verify failed.
    const run = (await loadRunState(result.runId))!;
    expect(run.steps.find((s) => s.stepId === "W1")?.status).not.toBe("done");
  });

  it("falls back to the inline step on UnsupportedToolError (legacy back-compat)", async () => {
    const { deps } = makeMockDeps();
    const result = await runEagerLoop({}, makeRegistry({ writeKind: "unsupported" }), deps);

    expect(result.step.kind).toBe("write");
    expect((result.step as { stepId: string }).stepId).toBe("W1");
  });

  it("returns a terminal gate (check stripped) when the check fails", async () => {
    const { deps, spies } = makeMockDeps();
    spies.query.mockResolvedValueOnce([]); // gate-check returns []
    const registry = makeRegistry({ writeKind: "ok", gateCheckResult: { cleared: false } });
    const result = await runEagerLoop({}, registry, deps);

    // W1 ran eagerly, then S1 returned (it's spawn = conductor-relevant).
    expect(result.step.kind).toBe("spawn");

    // Mark S1 done so we can re-plan and hit the gate.
    const { advance, verify } = await import("@engineerdad/orchestrator");
    expect((await verify(result.runId, "S1", { ok: true }, registry)).ok).toBe(true);
    await advance(result.runId, "S1", { ok: true }, registry);

    const second = await runEagerLoop({ runId: result.runId }, registry, deps);
    expect(second.step.kind).toBe("gate");
    expect((second.step as { check?: unknown }).check).toBeUndefined();
    expect((second.step as { message: string }).message).toBe("awaiting HG1");
  });

  it("loops past a check-passing gate to the next stage", async () => {
    const { deps, spies } = makeMockDeps();

    // Build a two-stage registry: stage 1 has W1 + a passing gate; stage 2
    // has a done step.
    const registry: StageDefinition[] = [
      {
        id: "fixture",
        steps: [
          {
            id: "G1",
            kind: "gate",
            build: () => ({
              kind: "gate",
              stepId: "G1",
              gate: "HG1",
              message: "m",
              check: { tool: "mcp__store__query", args: { entity: "Briefs", filter: {} } },
            }),
            verify: (_r, result): VerifyResult => {
              const rows = result as unknown[];
              return rows.length > 0
                ? { ok: true, problems: [] }
                : { ok: false, problems: ["empty"] };
            },
          },
        ],
      },
      {
        id: "tracking",
        steps: [
          {
            id: "S2",
            kind: "spawn",
            build: () => ({
              kind: "spawn",
              stepId: "S2",
              agent: "general-purpose",
              spawnPrompt: "p",
            }),
          },
        ],
      },
    ];

    spies.query.mockResolvedValueOnce([{ id: "x" }]); // gate-check passes

    const result = await runEagerLoop({}, registry, deps);
    expect(result.step.kind).toBe("spawn");
    expect((result.step as { stepId: string }).stepId).toBe("S2");
  });
});
