import Link from "next/link";
import { notFound } from "next/navigation";
import { store } from "@engineerdad/store";
import { getRun, listSteps } from "../../lib/orchestrator";
import { langFromSearchParams } from "../../lib/lang";
import { RunStageTimeline } from "../../components/RunStageTimeline";
import { RunStepTable } from "../../components/RunStepTable";
import { DecisionMemo, type PerformanceReportRow } from "../../components/DecisionMemo";
import { FormatCard } from "../../components/FormatCard";
import { LanguageToggle } from "../../components/LanguageToggle";
import { RunAngleChips } from "../../components/RunAngleChips";

type SP = { lang?: string; view?: string };
type Row = Record<string, unknown>;

export default async function RunDetail({
  params, searchParams,
}: { params: Promise<{ runId: string }>; searchParams: Promise<SP> }) {
  const { runId } = await params;
  const sp = await searchParams;
  const lang = langFromSearchParams(sp);
  const [run, steps, scripts, variants, perfRows, articles, hypotheses, experiments] = await Promise.all([
    getRun(runId),
    listSteps(runId),
    store.query("Scripts", { runId }, { fields: ["title", "approvalStatus"] }),
    store.query("CreativeVariants", { runId }, { fields: ["script", "format", "aspect", "approvalStatus", "organicStatus", "assetFiles"] }),
    store.query("PerformanceReports", { runId }, { fields: ["decisionMemoEn", "decisionMemoBm", "selfCritique", "banditAllocation"] }),
    store.query("AuthorityArticles", { runId }),
    store.query("Hypotheses", { runId }),
    store.query("Experiments", { runId }),
  ]);
  if (!run) notFound();

  const byScript = new Map<string, { script: Row; byFormat: Map<string, Row[]> }>();
  for (const s of scripts) {
    byScript.set(s.id as string, { script: s, byFormat: new Map() });
  }
  for (const v of variants) {
    const scriptId = (v as Row).script as string;
    const fmt = (v as Row).format as string;
    const slot = byScript.get(scriptId);
    if (!slot) continue;
    const arr = slot.byFormat.get(fmt) ?? [];
    arr.push(v);
    slot.byFormat.set(fmt, arr);
  }

  const memoRow = (perfRows[0] ?? null) as PerformanceReportRow;
  const startedAt = run.createdAt.toLocaleString("en-MY");

  return (
    <div className="space-y-6">
      <header className="pb-4 border-b border-slate-200">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <Link href="/runs" className="text-sm text-slate-500 hover:underline">← Runs</Link>
            <h1 className="text-2xl font-mono font-bold m-0">{run.runId}</h1>
            <p className="text-sm text-slate-500 m-0">Started {startedAt}</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href={`/posting-pack/${runId}`}
                  className="text-xs border border-slate-300 rounded px-2 py-1 hover:bg-slate-100">
              Meta-paid pack
            </Link>
            <Link href={`/posting-pack/organic/${runId}`}
                  className="text-xs border border-slate-300 rounded px-2 py-1 hover:bg-slate-100">
              IG organic pack
            </Link>
            <Link href={`?view=${sp.view === "debug" ? "" : "debug"}${lang === "ms" ? "&lang=ms" : ""}`}
                  className="text-xs border border-slate-300 rounded px-2 py-1 hover:bg-slate-100">
              {sp.view === "debug" ? "Timeline" : "Debug"}
            </Link>
            <LanguageToggle lang={lang} />
          </div>
        </div>
        <RunAngleChips runId={runId} />
      </header>

      {sp.view === "debug"
        ? <RunStepTable run={run} steps={steps} />
        : <RunStageTimeline run={run} steps={steps} />}

      <section className="border border-slate-200 rounded-lg p-5 bg-white">
        <DecisionMemo row={memoRow} lang={lang} />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Artifacts</h2>
        {[...byScript.values()].map(({ script, byFormat }) => (
          <div key={script.id as string} className="mb-6 rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="bg-slate-800 text-white px-4 py-3 flex items-center gap-3 flex-wrap">
              <span className="text-sm font-semibold">{String(script.title ?? "(untitled)")}</span>
              <span className="text-xs bg-white/20 px-2 py-0.5 rounded">{String(script.approvalStatus ?? "")}</span>
              <Link href={`/review/scripts/${script.id}`} className="ml-auto text-xs text-indigo-300 hover:text-white">Open →</Link>
            </div>
            <div className="bg-slate-50 p-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              {[...byFormat.entries()].map(([fmt, vs]) => (
                <FormatCard key={fmt} format={fmt} variants={vs as unknown as { id: string; format: string; aspect: "4:5" | "1:1" | "9:16" | "16:9"; assetFiles?: { url: string }[] | null; approvalStatus?: string; organicStatus?: string }[]} />
              ))}
            </div>
          </div>
        ))}
        {byScript.size === 0 && <p className="text-slate-500 text-sm">No scripts produced yet for this run.</p>}
      </section>

      <section className="text-sm border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold mb-2">Other artifacts in this run</h3>
        <ul className="space-y-1">
          <li>Authority Articles ({articles.length}): {articles.map((a) =>
            <Link key={a.id as string} href={`/review/authority-articles/${a.id}`} className="text-indigo-600 hover:underline mr-2">{String(a.title)}</Link>)}</li>
          <li>Hypotheses ({hypotheses.length}): {hypotheses.map((h) =>
            <Link key={h.id as string} href={`/review/hypotheses/${h.id}`} className="text-indigo-600 hover:underline mr-2">{String(h.title)}</Link>)}</li>
          <li>Experiments ({experiments.length}): {experiments.map((e) =>
            <Link key={e.id as string} href={`/review/experiments/${e.id}`} className="text-indigo-600 hover:underline mr-2">{String(e.title)}</Link>)}</li>
          <li>Distributions: <Link href={`/review/distributions?runId=${runId}`} className="text-indigo-600 hover:underline">View log →</Link></li>
          <li>Posting packs: <Link href={`/posting-pack/${runId}`} className="text-indigo-600 hover:underline mr-3">Meta-paid →</Link><Link href={`/posting-pack/organic/${runId}`} className="text-indigo-600 hover:underline">IG organic →</Link></li>
        </ul>
      </section>
    </div>
  );
}
