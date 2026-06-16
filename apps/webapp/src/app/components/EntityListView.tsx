import Link from "next/link";
import type { ColumnSpec, ListConfig } from "../lib/types";
import { FilterChips } from "./FilterChips";

type Row = Record<string, unknown>;

function cell(col: ColumnSpec, val: unknown): React.ReactNode {
  switch (col.type) {
    case "text":   return String(val ?? "(untitled)");
    case "status": return <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-xs">{String(val ?? "")}</span>;
    case "badge":  return <span className="inline-block px-1.5 py-0.5 rounded border border-slate-200 text-xs text-slate-600">{String(val ?? "")}</span>;
    case "runId":  return val
      ? <Link href={`/runs/${val}`} className="text-indigo-600 hover:underline font-mono text-xs">{String(val)}</Link>
      : <span className="text-slate-400">—</span>;
    case "chips":
      return Array.isArray(val)
        ? <span className="flex flex-wrap gap-1">{val.map((c) => <span key={String(c)} className="bg-slate-100 text-xs px-1.5 py-0.5 rounded">{String(c)}</span>)}</span>
        : null;
    case "timestamp":
      return val ? new Date(val as string | Date).toLocaleString("en-MY") : "—";
  }
}

function sortHref(
  col: ColumnSpec,
  activeSort: string | undefined,
  activeDir: "asc" | "desc",
  sp: Record<string, string>,
): string {
  const nextDir = col.field === activeSort && activeDir === "asc" ? "desc" : "asc";
  const params = new URLSearchParams(sp);
  params.set("sort", col.field);
  params.set("dir", nextDir);
  return `?${params.toString()}`;
}

function SortIcon({ field, activeSort, activeDir }: { field: string; activeSort?: string; activeDir: "asc" | "desc" }) {
  const isActive = field === activeSort;
  return (
    <span className="inline-flex flex-col gap-px ml-1 align-middle">
      <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor"
           className={isActive && activeDir === "asc" ? "text-indigo-600" : "text-slate-300"}>
        <path d="M4 0L8 5H0L4 0Z" />
      </svg>
      <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor"
           className={isActive && activeDir === "desc" ? "text-indigo-600" : "text-slate-300"}>
        <path d="M4 5L0 0H8L4 5Z" />
      </svg>
    </span>
  );
}

export interface EntityListViewProps {
  title: string;
  config: ListConfig;
  rows: Row[];
  rowHref: (row: Row) => string;
  sort?: string;
  dir?: "asc" | "desc";
  searchParams?: Record<string, string>;
}

export function EntityListView({ title, config, rows, rowHref, sort, dir = "asc", searchParams = {} }: EntityListViewProps) {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">{title} <span className="text-slate-400 text-base font-normal">({rows.length})</span></h1>
      <FilterChips filters={config.filters} />
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500">
          <tr>
            {config.columns.map((c) => (
              <th key={c.field} className="py-2 font-medium">
                {c.sortable ? (
                  <Link href={sortHref(c, sort, dir, searchParams)} className="inline-flex items-center hover:text-slate-800">
                    {c.label}
                    <SortIcon field={c.field} activeSort={sort} activeDir={dir} />
                  </Link>
                ) : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.id ?? r.runId)} className="border-t border-slate-200">
              {config.columns.map((c, i) => (
                <td key={c.field} className="py-2 pr-3 align-top">
                  {i === 0
                    ? <Link href={rowHref(r)} className="text-indigo-600 hover:underline">{cell(c, r[c.field])}</Link>
                    : cell(c, r[c.field])}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={config.columns.length} className="py-8 text-center text-slate-500">no rows</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
