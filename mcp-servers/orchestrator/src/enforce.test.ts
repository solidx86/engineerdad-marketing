import { describe, it, expect } from "vitest";
import { LIVE_REGISTRY, type StageDefinition } from "@engineerdad/orchestrator";
import { enforceKind, ContractError } from "./enforce.js";

// Real-step ids from LIVE_REGISTRY (registry.ts):
//   spawn:  S1-reason (synthesize), B1-write (brief),
//           C2-articles (content), P1-spec (produce, replaced by P1-fanout)
//   fanout: A1-* (analytics), C1-fanout (content), P1-fanout (produce),
//           P2-render (produce)
//   write:  T1-canary (tracking), C0-briefs (content), P0-scripts (produce), etc.
//   gate:   B2-gate (brief), C3-gate (content), P6-gate (produce), etc.

const SPAWN_STEP = "S1-reason"; // synthesize: brain spawn
const FANOUT_STEP = "C1-fanout"; // content: per-Brief fanout
const WRITE_STEP = "C0-briefs"; // content: query approved Briefs
const GATE_STEP = "B2-gate"; // brief: HG1

function expectStepKind(registry: StageDefinition[], stepId: string, kind: string): void {
  for (const stage of registry) {
    const spec = stage.steps.find((s) => s.id === stepId);
    if (spec) {
      expect(spec.kind).toBe(kind);
      return;
    }
  }
  throw new Error(`stepId ${stepId} not in registry`);
}

describe("enforceKind — registry sanity (fail loudly if step names move)", () => {
  it("S1-reason exists and is spawn", () => expectStepKind(LIVE_REGISTRY, SPAWN_STEP, "spawn"));
  it("C1-fanout exists and is fanout", () => expectStepKind(LIVE_REGISTRY, FANOUT_STEP, "fanout"));
  it("C0-briefs exists and is write", () => expectStepKind(LIVE_REGISTRY, WRITE_STEP, "write"));
  it("B2-gate exists and is gate", () => expectStepKind(LIVE_REGISTRY, GATE_STEP, "gate"));
});

describe("enforceKind — spawn", () => {
  it("accepts a {stepResultId} ref", () => {
    expect(() =>
      enforceKind(SPAWN_STEP, { stepResultId: "sr_01ABCDEFGHIJKLMNOPQRSTUVWX" }, LIVE_REGISTRY),
    ).not.toThrow();
  });

  it("rejects an inline payload", () => {
    expect(() => enforceKind(SPAWN_STEP, { memo: "data" }, LIVE_REGISTRY)).toThrow(
      ContractError,
    );
  });

  it("rejects a ref-array (must be single, not array)", () => {
    expect(() =>
      enforceKind(
        SPAWN_STEP,
        [{ stepResultId: "sr_01ABCDEFGHIJKLMNOPQRSTUVWX" }],
        LIVE_REGISTRY,
      ),
    ).toThrow(ContractError);
  });
});

describe("enforceKind — fanout", () => {
  it("accepts an array of refs", () => {
    expect(() =>
      enforceKind(
        FANOUT_STEP,
        [
          { stepResultId: "sr_01ABCDEFGHIJKLMNOPQRSTUVWX" },
          { stepResultId: "sr_02ABCDEFGHIJKLMNOPQRSTUVWX" },
        ],
        LIVE_REGISTRY,
      ),
    ).not.toThrow();
  });

  it("rejects an inline array of payloads", () => {
    expect(() =>
      enforceKind(FANOUT_STEP, [{ briefId: "b1" }, { briefId: "b2" }], LIVE_REGISTRY),
    ).toThrow(ContractError);
  });

  it("rejects a single ref (must be array, not single)", () => {
    expect(() =>
      enforceKind(
        FANOUT_STEP,
        { stepResultId: "sr_01ABCDEFGHIJKLMNOPQRSTUVWX" },
        LIVE_REGISTRY,
      ),
    ).toThrow(ContractError);
  });

  it("rejects an empty array", () => {
    expect(() => enforceKind(FANOUT_STEP, [], LIVE_REGISTRY)).toThrow(ContractError);
  });

  it("rejects a mixed array", () => {
    expect(() =>
      enforceKind(
        FANOUT_STEP,
        [{ stepResultId: "sr_01ABCDEFGHIJKLMNOPQRSTUVWX" }, { foo: 1 }],
        LIVE_REGISTRY,
      ),
    ).toThrow(ContractError);
  });
});

describe("enforceKind — write + gate (inline tolerated)", () => {
  it("write step tolerates an inline array of MCP results", () => {
    expect(() =>
      enforceKind(
        WRITE_STEP,
        [{ rows: [{ id: "b1", title: "Brief A" }] }],
        LIVE_REGISTRY,
      ),
    ).not.toThrow();
  });

  it("gate step tolerates an inline read result", () => {
    expect(() =>
      enforceKind(GATE_STEP, [{ id: "b1", approvalStatus: "Approved" }], LIVE_REGISTRY),
    ).not.toThrow();
  });

  it("write step tolerates null / empty", () => {
    expect(() => enforceKind(WRITE_STEP, null, LIVE_REGISTRY)).not.toThrow();
    expect(() => enforceKind(GATE_STEP, [], LIVE_REGISTRY)).not.toThrow();
  });
});

describe("enforceKind — unknown step", () => {
  it("throws ContractError for a stepId not in the registry", () => {
    expect(() => enforceKind("X9-bogus", { foo: 1 }, LIVE_REGISTRY)).toThrow(ContractError);
  });
});
