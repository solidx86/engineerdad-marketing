// Server component — surfaces Brain's recommendedAngles for a run alongside
// the count of Briefs minted for each angle. Reads the S1-reason memo out of
// orchestrator run_steps (via listSteps), and the per-angle Brief counts via
// the existing store query API. Falls back to a cold-start hint if Brain
// emitted no recommendedAngles (single-angle path).
//
// Spec §3.4.1. Plan Task 22.
import "server-only";
import { store } from "@engineerdad/store";
import { listSteps } from "../lib/orchestrator";

interface Memo {
  recommendedAngles?: unknown;
  angleRationales?: unknown;
}

async function fetchS1Memo(runId: string): Promise<Memo | null> {
  const steps = await listSteps(runId);
  const s1 = steps.find((s) => s.stepId === "S1-reason");
  if (!s1 || !s1.result || typeof s1.result !== "object") return null;
  return s1.result as Memo;
}

async function fetchBriefCountsByAngle(runId: string): Promise<Map<string, number>> {
  const rows = await store.query("Briefs", { runId }, { fields: ["angle"] });
  const counts = new Map<string, number>();
  for (const row of rows) {
    const angle = (row as { angle?: unknown }).angle;
    if (typeof angle !== "string" || angle.length === 0) continue;
    counts.set(angle, (counts.get(angle) ?? 0) + 1);
  }
  return counts;
}

export async function RunAngleChips({ runId }: { runId: string }) {
  const memo = await fetchS1Memo(runId);
  const angles: string[] = Array.isArray(memo?.recommendedAngles)
    ? (memo!.recommendedAngles as unknown[]).filter((a): a is string => typeof a === "string")
    : [];
  const rationaleByAngle: Record<string, string> =
    memo?.angleRationales && typeof memo.angleRationales === "object" && !Array.isArray(memo.angleRationales)
      ? (memo.angleRationales as Record<string, string>)
      : {};

  if (angles.length === 0) {
    return (
      <div className="text-xs text-slate-500 italic my-2">
        No recommendedAngles emitted for this run (cold-start path).
      </div>
    );
  }

  const countByAngle = await fetchBriefCountsByAngle(runId);

  return (
    <div className="flex gap-2 flex-wrap my-2">
      {angles.map((a) => (
        <div
          key={a}
          title={rationaleByAngle[a] ?? ""}
          className="bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2.5 py-0.5 text-xs font-mono"
        >
          {a} <span className="text-indigo-400">· {countByAngle.get(a) ?? 0}</span>
        </div>
      ))}
    </div>
  );
}
