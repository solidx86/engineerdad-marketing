import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DB } from "./db.js";
import { ENTITIES, type EntityName } from "./schema.js";
import { buildWhere, type Filter } from "./filters.js";
import { validateProps } from "./validate-props.js";

export interface ComplianceResult {
  ok: boolean;
  problems: string[];
}
export interface CrudDeps {
  complianceScan: (entity: EntityName, props: Record<string, unknown>) => Promise<ComplianceResult>;
}

export interface CreateResult {
  ok: boolean;
  id?: string;
  problems?: string[];
}
export interface UpdateResult {
  ok: boolean;
  problems?: string[];
}
export interface QueryOptions {
  fields?: string[];
}

const ALWAYS_RETURNED = ["id", "title"] as const;

export function makeCrud(db: DB, deps: CrudDeps) {
  return {
    async query<E extends EntityName>(
      entity: E,
      filter?: Filter,
      opts?: QueryOptions,
    ): Promise<Array<Record<string, unknown>>> {
      const table = ENTITIES[entity];
      const where = buildWhere(table, filter);
      const cols = new Set<string>([...ALWAYS_RETURNED, ...(opts?.fields ?? [])]);
      const projection: Record<string, unknown> = {};
      for (const col of cols) {
        const c = (table as unknown as Record<string, unknown>)[col];
        if (c !== undefined) projection[col] = c;
      }
      // POSTGRES-JS: no .all() — awaiting the query builder returns the array directly.
      // Projection is built dynamically from drizzle columns; cast bypasses tsc's
      // structural check (runtime values are valid PgColumn instances).
      const sel = projection as Parameters<typeof db.select>[0];
      const rows = where
        ? await db.select(sel).from(table).where(where)
        : await db.select(sel).from(table);
      return rows as Array<Record<string, unknown>>;
    },

    async get<E extends EntityName>(
      entity: E,
      id: string,
    ): Promise<Record<string, unknown> | undefined> {
      const table = ENTITIES[entity];
      const idCol = (table as unknown as Record<string, unknown>)["id"];
      // POSTGRES-JS: no .get() — use .limit(1) and take [0]
      const rows = await db.select().from(table).where(eq(idCol as never, id as never)).limit(1);
      return rows[0] as Record<string, unknown> | undefined;
    },

    async create<E extends EntityName>(
      entity: E,
      props: Record<string, unknown>,
    ): Promise<CreateResult> {
      const invalid = validateProps(ENTITIES[entity], props);
      if (invalid.length > 0) return { ok: false, problems: invalid };

      const scan = await deps.complianceScan(entity, props);
      if (!scan.ok) return { ok: false, problems: scan.problems };

      const id = randomUUID();
      const table = ENTITIES[entity];
      const now = new Date();
      // Spread caller props first, then override with our authoritative fields
      // (id, base columns, timestamps) so a caller-supplied id is replaced by
      // the generated one and base-column defaults are guaranteed.
      const row = {
        ...props,
        id,
        title: (props.title as string | undefined) ?? "",
        approvalStatus: (props.approvalStatus as string | undefined) ?? "Draft",
        createdBy: (props.createdBy as string | undefined) ?? "Human",
        runId: (props.runId as string | undefined) ?? "",
        complianceCheck: scan.ok,
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(table).values(row as never);
      return { ok: true, id };
    },

    async update<E extends EntityName>(
      entity: E,
      id: string,
      props: Record<string, unknown>,
      opts?: { fillOnlyIfEmpty?: boolean },
    ): Promise<UpdateResult> {
      const invalid = validateProps(ENTITIES[entity], props);
      if (invalid.length > 0) return { ok: false, problems: invalid };

      const scan = await deps.complianceScan(entity, props);
      if (!scan.ok) return { ok: false, problems: scan.problems };

      const table = ENTITIES[entity];
      const idCol = (table as unknown as Record<string, unknown>)["id"];

      let patch: Record<string, unknown> = props;
      if (opts?.fillOnlyIfEmpty) {
        // POSTGRES-JS: no .get() — use .limit(1) and take [0]
        const currentRows = await db.select().from(table).where(eq(idCol as never, id as never)).limit(1);
        const current = currentRows[0] as Record<string, unknown> | undefined;
        patch = {};
        for (const [k, v] of Object.entries(props)) {
          const existing = current?.[k];
          if (existing === null || existing === undefined || existing === "") patch[k] = v;
        }
      }

      patch = { ...patch, updatedAt: new Date() };
      await db.update(table).set(patch as never).where(eq(idCol as never, id as never));
      return { ok: true };
    },

    async setStatus<E extends EntityName>(
      entity: E,
      id: string,
      status: string,
    ): Promise<UpdateResult> {
      const table = ENTITIES[entity];
      const idCol = (table as unknown as Record<string, unknown>)["id"];
      await db
        .update(table)
        .set({ approvalStatus: status, updatedAt: new Date() } as never)
        .where(eq(idCol as never, id as never));
      return { ok: true };
    },

    async count<E extends EntityName>(entity: E, filter?: Filter): Promise<number> {
      const list = await this.query(entity, filter);
      return list.length;
    },
  };
}

export type Crud = ReturnType<typeof makeCrud>;
