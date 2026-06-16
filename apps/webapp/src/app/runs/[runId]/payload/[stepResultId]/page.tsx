import { loadStepPayload } from "../../../../lib/orchestrator";
import Link from "next/link";

export default async function Payload({
  params,
}: { params: Promise<{ runId: string; stepResultId: string }> }) {
  const { runId, stepResultId } = await params;
  let payload: unknown;
  try { payload = await loadStepPayload(stepResultId); }
  catch (e) { payload = { error: e instanceof Error ? e.message : String(e) }; }
  return (
    <div>
      <Link href={`/runs/${runId}?view=debug`} className="text-sm text-slate-500 hover:underline">← Run {runId}</Link>
      <h1 className="text-xl font-bold mt-2 mb-3">Payload <code className="text-base">{stepResultId}</code></h1>
      <pre className="bg-slate-50 border border-slate-200 rounded p-4 text-xs overflow-auto">{JSON.stringify(payload, null, 2)}</pre>
    </div>
  );
}
