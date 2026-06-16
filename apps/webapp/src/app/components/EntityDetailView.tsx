import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EntityLayout, FieldSpec, Lang, Section } from "../lib/types";
import type { EntityName } from "@engineerdad/store";
import { RawFieldsSection } from "./RawFieldsSection";

type Row = Record<string, unknown>;

// If a string is a JSON object/array (e.g. the Reel shotlist), return it
// pretty-printed; otherwise null so the caller falls back to markdown.
function prettyJson(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return null;
  try {
    const parsed = JSON.parse(t);
    if (parsed && typeof parsed === "object") return JSON.stringify(parsed, null, 2);
  } catch {
    // not valid JSON — fall through to markdown
  }
  return null;
}

// ADR-030 claim bindings: one row per quantitative/conceptual claim, showing
// its data backing (chart + figures), a gap badge (held), or concept tag.
interface ClaimBindingView {
  claim?: unknown;
  kind?: unknown;
  chartRef?: unknown;
  figures?: unknown;
  takeaway?: unknown;
  gapNote?: unknown;
}
function readBindings(v: unknown): ClaimBindingView[] {
  return Array.isArray(v) ? (v as ClaimBindingView[]) : [];
}
export function hasGapBinding(v: unknown): boolean {
  return readBindings(v).some((b) => b.kind === "gap");
}

function BindingsField({ value, label }: { value: unknown; label: string }) {
  const bindings = readBindings(value);
  if (bindings.length === 0) {
    return <div className="mb-2 text-sm text-slate-400">{label}: none</div>;
  }
  return (
    <div className="mb-3">
      <h4 className="text-xs font-semibold text-slate-500 mb-1">{label}</h4>
      <ul className="space-y-2 list-none p-0 m-0">
        {bindings.map((b, i) => {
          const kind = String(b.kind ?? "");
          const figures = Array.isArray(b.figures) ? (b.figures as unknown[]).map(String) : [];
          return (
            <li key={i} className="border border-slate-200 rounded p-2 text-sm">
              <div className="flex items-center gap-2 mb-1">
                {kind === "data" && <span className="inline-block bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded text-xs font-semibold">✓ data</span>}
                {kind === "gap" && <span className="inline-block bg-rose-100 text-rose-800 px-1.5 py-0.5 rounded text-xs font-semibold">⛔ gap — held</span>}
                {kind === "qualitative" && <span className="inline-block bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-xs font-semibold">concept</span>}
                <span className="text-slate-800">{String(b.claim ?? "")}</span>
              </div>
              {kind === "data" && (
                <div className="text-xs text-slate-600 ml-1">
                  chart <code className="bg-slate-100 px-1 rounded">{String(b.chartRef ?? "")}</code>
                  {figures.length > 0 && <> · figures {figures.map((f) => <span key={f} className="inline-block bg-slate-100 px-1 rounded mr-1">{f}</span>)}</>}
                  {b.takeaway ? <div className="italic text-slate-500 mt-0.5">“{String(b.takeaway)}”</div> : null}
                </div>
              )}
              {kind === "gap" && b.gapNote ? (
                <div className="text-xs text-rose-700 ml-1">missing: {String(b.gapNote)} — fill via <code>/chart-gap</code></div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FieldRow({ spec, row, lang, slugOf }: { spec: FieldSpec; row: Row; lang: Lang; slugOf: (e: EntityName) => string }) {
  const label = "label" in spec && spec.label ? spec.label : ("field" in spec ? spec.field : `${spec.en}/${spec.bm}`);
  if (spec.role === "bilingual") {
    const v = (lang === "ms" ? row[spec.bm] : row[spec.en]) as string | undefined;
    const json = prettyJson(v);
    return (
      <div className="mb-3">
        <h4 className="text-xs font-semibold text-slate-500 mb-1">{label}</h4>
        {json ? (
          <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto whitespace-pre font-mono">{json}</pre>
        ) : (
          <article className="prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{v ?? "(empty)"}</ReactMarkdown>
          </article>
        )}
      </div>
    );
  }
  const val = row[spec.field];
  switch (spec.role) {
    case "bindings":
      return <BindingsField value={val} label={label} />;
    case "primary":
      return <div className="mb-3">
        <h4 className="text-xs font-semibold text-slate-500 mb-1">{label}</h4>
        <article className="prose prose-sm max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{String(val ?? "(empty)")}</ReactMarkdown></article>
      </div>;
    case "list":
      return <div className="mb-2 text-sm"><span className="text-slate-500 mr-2">{label}:</span>
        {Array.isArray(val) ? val.map((x) => <span key={String(x)} className="inline-block bg-slate-100 px-1.5 py-0.5 rounded mr-1 text-xs">{String(x)}</span>) : "—"}
      </div>;
    case "status":
      return <div className="mb-2 text-sm"><span className="text-slate-500 mr-2">{label}:</span>
        <span className="inline-block bg-slate-100 px-2 py-0.5 rounded text-xs">{String(val ?? "—")}</span></div>;
    case "badge":
      return <div className="mb-2 text-sm"><span className="text-slate-500 mr-2">{label}:</span>
        <span className="inline-block border border-slate-200 px-1.5 py-0.5 rounded text-xs">{String(val ?? "—")}</span></div>;
    case "link":
      return val ? <div className="mb-2 text-sm"><a href={String(val)} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{label} →</a></div> : null;
    case "fk":
      return val ? <div className="mb-2 text-sm"><span className="text-slate-500 mr-2">{label}:</span>
        <Link href={`/review/${slugOf(spec.fk)}/${val}`} className="text-indigo-600 hover:underline">{String(val)}</Link></div> : null;
    case "timestamp":
      return <div className="mb-2 text-sm"><span className="text-slate-500 mr-2">{label}:</span>
        {val ? new Date(val as string | Date).toLocaleString("en-MY") : "—"}</div>;
    case "meta":
    default:
      return <div className="mb-2 text-sm"><span className="text-slate-500 mr-2">{label}:</span>{String(val ?? "—")}</div>;
  }
}

function SectionView({ section, row, lang, slugOf }: { section: Section; row: Row; lang: Lang; slugOf: (e: EntityName) => string }) {
  return (
    <section className="mb-6">
      <h3 className="text-sm font-semibold border-b border-slate-200 pb-1 mb-2">{section.title}</h3>
      {section.fields.map((f, i) => <FieldRow key={i} spec={f} row={row} lang={lang} slugOf={slugOf} />)}
    </section>
  );
}

export function EntityDetailView({ layout, row, lang, slugOf, headerSlot, afterHeader }: {
  layout: EntityLayout; row: Row; lang: Lang;
  slugOf: (e: EntityName) => string;
  headerSlot?: React.ReactNode;
  afterHeader?: React.ReactNode;
}) {
  const usedFields = new Set<string>();
  for (const sec of [...layout.primary, ...layout.secondary]) {
    for (const f of sec.fields) {
      if (f.role === "bilingual") { usedFields.add(f.en); usedFields.add(f.bm); }
      else { usedFields.add(f.field); }
    }
  }
  usedFields.add("id"); usedFields.add("title"); usedFields.add(layout.header.status);
  if (layout.header.subtitle) usedFields.add(layout.header.subtitle);
  if (layout.header.secondaryStatus) usedFields.add(layout.header.secondaryStatus);

  return (
    <div>
      <header className="mb-6 pb-4 border-b border-slate-200">
        <h1 className="text-2xl font-bold m-0">{String(row[layout.header.title] ?? "(untitled)")}</h1>
        {layout.header.subtitle && <p className="text-sm text-slate-500 m-0">{String(row[layout.header.subtitle] ?? "")}</p>}
        {hasGapBinding(row["claimBindings"]) && (
          <p className="mt-1 m-0">
            <span className="inline-block bg-rose-100 text-rose-800 px-2 py-0.5 rounded text-xs font-semibold">
              ⛔ HELD — unfilled data gap (ADR-030). Fill via /chart-gap before approving; siblings can still flow.
            </span>
          </p>
        )}
        {headerSlot}
      </header>
      {afterHeader}
      <div className="grid grid-cols-3 gap-8">
        <div className="col-span-2">
          {layout.primary.map((sec) => <SectionView key={sec.title} section={sec} row={row} lang={lang} slugOf={slugOf} />)}
        </div>
        <div>
          {layout.secondary.map((sec) => <SectionView key={sec.title} section={sec} row={row} lang={lang} slugOf={slugOf} />)}
          <RawFieldsSection row={row} usedFields={usedFields} />
        </div>
      </div>
    </div>
  );
}
