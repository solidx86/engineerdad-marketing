import { and, eq, gte, gt, lte, lt, inArray, isNull, isNotNull, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

export type ScalarValue = string | number | boolean | null;
export type FilterOp =
  | { in: ScalarValue[] }
  | { gte: number }
  | { gt: number }
  | { lte: number }
  | { lt: number }
  | { isNull: true }
  | { isNotNull: true };
export type FilterValue = ScalarValue | FilterOp;
export type Filter = Record<string, FilterValue>;

/** Build a Drizzle WHERE clause from a flat filter object.
 *  AND is implicit across keys; no `or` at v1.
 *  Throws on unknown columns or unknown operators (loud failure beats silent miss). */
export function buildWhere(table: PgTable, filter: Filter | undefined): SQL | undefined {
  if (!filter || Object.keys(filter).length === 0) return undefined;
  const conds: SQL[] = [];
  for (const [key, raw] of Object.entries(filter)) {
    const col = (table as unknown as Record<string, unknown>)[key];
    if (col === undefined) throw new Error(`buildWhere: unknown column "${key}"`);
    conds.push(buildOne(col, raw));
  }
  return conds.length === 1 ? conds[0] : and(...conds);
}

function buildOne(col: unknown, raw: FilterValue): SQL {
  if (raw === null) return isNull(col as never);
  if (typeof raw !== "object") return eq(col as never, raw as never);
  const op = raw as FilterOp;
  if ("in" in op) return inArray(col as never, op.in as never[]);
  if ("gte" in op) return gte(col as never, op.gte as never);
  if ("gt" in op) return gt(col as never, op.gt as never);
  if ("lte" in op) return lte(col as never, op.lte as never);
  if ("lt" in op) return lt(col as never, op.lt as never);
  if ("isNull" in op) return isNull(col as never);
  if ("isNotNull" in op) return isNotNull(col as never);
  throw new Error(`buildWhere: unknown operator ${JSON.stringify(op)}`);
}
