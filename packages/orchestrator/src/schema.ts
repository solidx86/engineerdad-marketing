// E-034 — orchestrator's PG-resident state. Single source of truth for
// the orchestrator schema; consumed by db.ts (runtime) and drizzle-kit
// (migrations).
import {
  pgSchema, text, integer, jsonb, timestamp, uniqueIndex, index, primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const orchestratorSchema = pgSchema("orchestrator");

/** Run header — created at run start, mutated by setRunStage. */
export const runs = orchestratorSchema.table("runs", {
  id: text("id").primaryKey(),
  stage: text("stage").notNull(),
  status: text("status").notNull(),
  params: jsonb("params"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Per-step state, keyed (runId, stepId). Upserted by the engine. */
export const runSteps = orchestratorSchema.table(
  "run_steps",
  {
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    stepId: text("step_id").notNull(),
    stage: text("stage").notNull(),
    status: text("status").notNull(),
    result: jsonb("result"),
    problems: jsonb("problems").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    attempts: integer("attempts").notNull().default(0),
    // createdAt preserves insertion order. Ordering loadRunState on
    // updatedAt regresses display order whenever a step is re-upserted —
    // the row jumps to the end.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.runId, t.stepId] }),
    runIdx: index("run_steps_run_idx").on(t.runId),
  }),
);

/** Claim-check store — ADR-022 (output) + ADR-024 (input). Schema unchanged
 *  from the raw SQL migrations; re-expressed in Drizzle so push owns it. */
export const stepResults = orchestratorSchema.table(
  "step_results",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    stepId: text("step_id").notNull(),
    unitIndex: integer("unit_index"),
    payload: jsonb("payload").notNull(),
    payloadKind: text("payload_kind"),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    runStepIdx: index("step_results_run_step_idx").on(t.runId, t.stepId),
    // Partial unique index for input idempotency (ADR-024). Drizzle's
    // .where() on uniqueIndex generates the partial predicate.
    inputIdempotency: uniqueIndex("step_results_input_idempotency_idx")
      .on(t.runId, t.stepId, t.unitIndex, t.payloadKind)
      .where(sql`${t.payloadKind} IS NOT NULL`),
  }),
);
