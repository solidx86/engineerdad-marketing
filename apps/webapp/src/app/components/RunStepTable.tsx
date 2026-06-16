import Link from "next/link";
import type { RunRow, StepRow } from "../lib/orchestrator";

export function RunStepTable({ run, steps }: { run: RunRow; steps: StepRow[] }) {
  const failed = steps.filter((s) => s.status === "failed" || s.problems?.length);
  return (
    <div>
      {failed.length > 0 && (
        <div className="mb-3 bg-rose-50 border border-rose-300 rounded p-3 text-sm">
          {failed.length} step{failed.length === 1 ? "" : "s"} failed or carry problems. Inspect below.
        </div>
      )}
      <table className="w-full text-xs font-mono">
        <thead><tr className="text-left text-slate-500">
          <th className="py-1">step_id</th><th>stage</th><th>status</th><th>attempts</th><th>problems</th><th>payload</th>
        </tr></thead>
        <tbody>
        {steps.map((s) => {
          const resultObj = s.result as Record<string, unknown> | null;
          const ref = resultObj && typeof resultObj.stepResultId === "string" ? resultObj.stepResultId : null;
          return (
            <tr key={s.stepId} className={`border-t border-slate-200 ${s.status === "failed" ? "bg-rose-50" : ""}`}>
              <td className="py-1">{s.stepId}</td>
              <td>{s.stage}</td>
              <td>{s.status}</td>
              <td>{s.attempts}</td>
              <td className="text-rose-700">{s.problems?.join("; ")}</td>
              <td>{ref ? <Link href={`/runs/${run.runId}/payload/${ref}`} className="text-indigo-600 hover:underline">view</Link> : "—"}</td>
            </tr>
          );
        })}
        </tbody>
      </table>
    </div>
  );
}
