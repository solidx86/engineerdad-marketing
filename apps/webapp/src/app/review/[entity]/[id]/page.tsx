import { store } from "@engineerdad/store";
import { notFound } from "next/navigation";
import Link from "next/link";
import { entityFromSlug, slugOf } from "../../../lib/entities";
import { layoutFor } from "../../../lib/layouts/index";
import { EntityDetailView } from "../../../components/EntityDetailView";
import { EntityEditForm } from "../../../components/EntityEditForm";
import { LanguageToggle } from "../../../components/LanguageToggle";
import type { Lang } from "../../../lib/types";
import { langFromSearchParams } from "../../../lib/lang";
import { AllScenesViewer } from "../../../components/AllScenesViewer";
import { DecisionMemo, type PerformanceReportRow } from "../../../components/DecisionMemo";
import { setStatus } from "../../../lib/actions";

type SP = { lang?: string; mode?: string };

export default async function ReviewDetail({
  params, searchParams,
}: { params: Promise<{ entity: string; id: string }>; searchParams: Promise<SP> }) {
  const { entity: slug, id } = await params;
  const sp = await searchParams;
  const entity = entityFromSlug(slug);
  if (!entity) notFound();
  const row = await store.get(entity, id);
  if (!row) notFound();
  const layout = layoutFor(entity);
  const lang: Lang = langFromSearchParams(sp);
  const editing = sp.mode === "edit";

  const statusValue = String((row as Record<string, unknown>)[layout.header.status] ?? "");
  const isAwaiting = statusValue === "Awaiting Approval";

  const headerSlot = (
    <div className="flex items-center gap-3 mt-3 flex-wrap">
      <span className="bg-slate-100 px-2 py-0.5 rounded text-xs">{statusValue}</span>
      {layout.header.secondaryStatus && (
        <span className="bg-slate-100 px-2 py-0.5 rounded text-xs">
          {String((row as Record<string, unknown>)[layout.header.secondaryStatus] ?? "")}
        </span>
      )}
      <LanguageToggle lang={lang} />
      <div className="ml-auto flex gap-2 text-sm">
        {isAwaiting && !editing && (
          <form action={setStatus.bind(null, entity, id, "Approved")}>
            <button type="submit" className="bg-emerald-600 text-white rounded px-3 py-1 hover:bg-emerald-700">Approve</button>
          </form>
        )}
        {!editing
          ? <Link href={`?mode=edit${lang === "ms" ? "&lang=ms" : ""}`} className="border border-slate-300 rounded px-3 py-1 hover:bg-slate-100">Edit</Link>
          : <Link href={lang === "ms" ? "?lang=ms" : "."} className="border border-slate-300 rounded px-3 py-1 hover:bg-slate-100">Cancel</Link>}
      </div>
    </div>
  );

  if (editing) {
    return (
      <div>
        <header className="mb-6 pb-4 border-b border-slate-200">
          <h1 className="text-2xl font-bold m-0">{String((row as Record<string, unknown>).title ?? "(untitled)")}</h1>
          {headerSlot}
        </header>
        <EntityEditForm entity={entity} id={id} layout={layout} row={row} backHref={`/review/${slug}/${id}`} />
      </div>
    );
  }

  const afterHeader = (() => {
    if (entity === "CreativeVariants") {
      const files = (row as Record<string, unknown>).assetFiles as { url: string }[] | null;
      const aspect = (row as Record<string, unknown>).aspect as "4:5" | "1:1" | "9:16" | "16:9" | undefined;
      return (
        <div className="mb-8">
          <h3 className="text-sm font-semibold border-b border-slate-200 pb-1 mb-3">
            Assets {files?.length ? <span className="text-slate-400 font-normal">({files.length})</span> : null}
          </h3>
          {files?.length && aspect
            ? <AllScenesViewer assets={files} aspect={aspect} tall />
            : <div className="flex items-center justify-center h-32 rounded-lg border border-dashed border-slate-300 text-sm text-slate-400">No assets generated yet</div>}
        </div>
      );
    }
    return null;
  })();

  const afterContent = entity === "PerformanceReports"
    ? <div className="mt-6"><DecisionMemo row={row as PerformanceReportRow} lang={lang} /></div>
    : null;

  return (
    <div>
      <div className="mb-4"><Link href={`/review/${slug}`} className="text-sm text-slate-500 hover:underline">← {entity}</Link></div>
      <EntityDetailView layout={layout} row={row} lang={lang} slugOf={slugOf} headerSlot={headerSlot} afterHeader={afterHeader} />
      {afterContent}
    </div>
  );
}
