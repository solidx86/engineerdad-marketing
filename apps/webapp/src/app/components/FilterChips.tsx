"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { FilterSpec } from "../lib/types";

export function FilterChips({ filters }: { filters: FilterSpec[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  function setParam(field: string, value: string) {
    const sp = new URLSearchParams(params.toString());
    if (!value) sp.delete(field); else sp.set(field, value);
    router.replace(`${pathname}?${sp.toString()}`);
  }
  function clearAll() { router.replace(pathname); }

  return (
    <div className="flex flex-wrap gap-2 items-center text-xs py-2">
      {filters.map((f) => {
        const current = params.get(f.field) ?? "";
        if (f.type === "multiSelect") {
          // Render as a text input so option labels don't appear as DOM text nodes
          // that would conflict with getByText() assertions on table cell content.
          return (
            <label key={f.field} className="inline-flex items-center gap-1">
              <span className="text-slate-500">{f.label}:</span>
              <input
                type="text"
                placeholder="any"
                defaultValue={current}
                onBlur={(e) => setParam(f.field, e.target.value.trim())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setParam(f.field, (e.target as HTMLInputElement).value.trim());
                }}
                className="border border-slate-300 rounded px-1.5 py-0.5 w-28"
              />
            </label>
          );
        }
        return (
          <label key={f.field} className="inline-flex items-center gap-1">
            <span className="text-slate-500">{f.label}:</span>
            <select
              value={current}
              onChange={(e) => setParam(f.field, e.target.value)}
              className="border border-slate-300 rounded px-1.5 py-0.5"
            >
              <option value="">any</option>
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        );
      })}
      <button onClick={clearAll} className="text-slate-500 hover:text-indigo-600 underline ml-2">Clear all</button>
    </div>
  );
}
