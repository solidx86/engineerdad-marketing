// Pure gate-mapping helper. No server-only marker; safe to import from
// client components and from vitest. Extracted from lib/orchestrator.ts
// so its tests can run without the server-only module barrier.

export type GateName = "HG1" | "HG2" | "HG3" | "HG4";

const GATE_BY_STAGE: Record<string, GateName> = {
  brief: "HG1",
  content: "HG2",
  produce: "HG3",
  distribute: "HG4",
};

export function currentGate(run: { stage: string; status: string }): GateName | null {
  if (run.status !== "awaiting_gate") return null;
  return GATE_BY_STAGE[run.stage] ?? null;
}
