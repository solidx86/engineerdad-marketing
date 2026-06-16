import { listRuns } from "../lib/orchestrator";
import { runsList } from "../lib/listConfigs/runs";
import { EntityListView } from "../components/EntityListView";

type SP = { stage?: string; status?: string };
type Row = Record<string, unknown>;

export default async function RunsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  let rows = await listRuns({ limit: 200 });
  if (sp.stage)  rows = rows.filter((r) => r.stage === sp.stage);
  if (sp.status) rows = rows.filter((r) => r.status === sp.status);
  return (
    <EntityListView
      title="Runs"
      config={runsList}
      rows={rows as unknown as Row[]}
      rowHref={(r) => `/runs/${(r as { runId: string }).runId}`}
    />
  );
}
