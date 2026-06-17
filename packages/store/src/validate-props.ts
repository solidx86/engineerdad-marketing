import { getTableColumns, type Table } from "drizzle-orm";

/**
 * Validate caller props against a drizzle table's real columns before a write.
 * Catches the B-037 class: unknown columns (silently dropped by drizzle) and
 * strings written to timestamp columns (which throw mid-write, corrupting the
 * row partially). Pure — table + props in, problem strings out.
 */
export function validateProps(table: Table, props: Record<string, unknown>): string[] {
  const columns = getTableColumns(table) as Record<string, { dataType?: string } | undefined>;
  const problems: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    const col = columns[key];
    if (!col) {
      problems.push(`unknown column "${key}"`);
      continue;
    }
    if (col.dataType === "date" && typeof value === "string") {
      problems.push(`column "${key}" expects a Date, got string`);
    }
  }
  return problems;
}
