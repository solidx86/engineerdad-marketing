import type { EntityLayout } from "../lib/types";
import type { EntityName } from "@engineerdad/store";
import { APPROVAL_STATUS } from "@engineerdad/store";
import { Field } from "./Field";
import { saveRow } from "../lib/actions";

type Row = Record<string, unknown>;

export function EntityEditForm({
  entity,
  id,
  layout,
  row,
  backHref,
}: {
  entity: EntityName;
  id: string;
  layout: EntityLayout;
  row: Row;
  backHref: string;
}) {
  const SKIP = new Set(["id", "createdAt", "updatedAt", "complianceCheck"]);
  const fields = Object.keys(row).filter((k) => !SKIP.has(k));

  return (
    <form action={saveRow.bind(null, entity, id)} className="space-y-4">
      {fields.map((field) => (
        <div key={field}>
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            {field}
          </label>
          <Field name={field} value={row[field]} />
        </div>
      ))}
      <div className="border-t border-slate-200 pt-4 flex items-center gap-3">
        <select
          name="_status"
          defaultValue={(row[layout.header.status] as string) ?? "Draft"}
          className="border border-slate-300 rounded px-3 py-2 text-sm"
        >
          {APPROVAL_STATUS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="bg-indigo-600 text-white rounded px-4 py-2 text-sm font-semibold hover:bg-indigo-700"
        >
          Save
        </button>
        <a
          href={backHref}
          className="text-sm text-slate-500 hover:underline"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
