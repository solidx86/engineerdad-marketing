import type { RunRow, StepRow } from "../lib/orchestrator";
import { currentGate } from "../lib/orchestrator";

const STAGES = ["tracking", "analytics", "synthesize", "brief", "content", "produce", "schedule", "experiment", "distribute"] as const;
const GATE_AT: Record<string, string> = { brief: "HG1", content: "HG2", produce: "HG3", distribute: "HG4" };

function stateOf(stage: string, run: RunRow): "done" | "current" | "pending" | "failed" {
  const order = STAGES.indexOf(stage as typeof STAGES[number]);
  const cur = STAGES.indexOf(run.stage as typeof STAGES[number]);
  if (order < cur) return "done";
  if (order > cur) return "pending";
  if (run.status === "blocked") return "failed";
  return "current";
}

const ICON = { done: "●", current: "◐", pending: "○", failed: "✕" } as const;
const COLOR = { done: "text-emerald-600", current: "text-indigo-600", pending: "text-slate-300", failed: "text-rose-600" } as const;

export function RunStageTimeline({ run, steps: _steps }: { run: RunRow; steps: StepRow[] }) {
  const gate = currentGate(run);
  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white">
      <div className="flex flex-wrap gap-3 items-center text-sm">
        {STAGES.map((s) => {
          const st = stateOf(s, run);
          // Suppress current-stage gate label when the banner already shows it (avoids duplicate text for e2e selectors).
          const gateLabel = st === "done" && GATE_AT[s] ? ` ${GATE_AT[s]}✓` : st === "current" && GATE_AT[s] && !gate ? ` ${GATE_AT[s]}` : "";
          return (
            <span key={s} className={`flex items-center gap-1 ${COLOR[st]} ${st === "current" ? "font-semibold" : ""}`}>
              <span className="text-lg leading-none">{ICON[st]}</span>{s}{gateLabel}
            </span>
          );
        })}
      </div>
      {gate && (
        <div className="mt-3 bg-amber-50 border border-amber-300 rounded p-2 text-sm">
          ⚠ {gate} awaiting — approve in the relevant artifact section below.
        </div>
      )}
    </div>
  );
}
