import type postgres from "postgres";
import { getSql, closeDb } from "./db.js";
import { newStepResultId } from "./ulid.js";

type Sql = ReturnType<typeof postgres>;

/** Backward-compatible alias — postgres.ts callers continue to use this name.
 *  The underlying client is now shared with src/db.ts (one pool per process). */
function client(): Sql {
  return getSql();
}

export interface WriteStepResultArgs {
  runId: string;
  stepId: string;
  unitIndex?: number;
  payload: unknown;
  /** When set, the row is tagged with this discriminator and persisted
   *  with deterministic idempotency on `(runId, stepId, unitIndex, payloadKind)`.
   *  Re-calls with the same key return the existing row's id and do NOT
   *  overwrite the payload (ADR-024 idempotency contract: re-plans must not
   *  mutate committed state). When omitted, behaviour is unchanged from
   *  ADR-022: a fresh ULID per call, no uniqueness, payload_kind = NULL. */
  payloadKind?: string;
}

/** Defensive unwrap: a string that parses to an object/array was pre-stringified
 *  by the caller; treat the parsed value as the intent. Anything else passes
 *  through. See E-032. */
function normalizePayload(payload: unknown): unknown {
  if (typeof payload !== "string") return payload;
  const trimmed = payload.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return payload;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed !== null && (typeof parsed === "object" || Array.isArray(parsed))) {
      return parsed;
    }
    return payload;
  } catch {
    return payload;
  }
}

/** Persist one worker output row. Returns the generated `sr_`-prefixed id.
 *
 *  Called by `mcp__orchestrator__write_step_result`. The worker emits
 *  `{stepResultId: <returned id>}` as its final message; the conductor
 *  carries the ref verbatim to verify/advance.
 *
 *  Defensive against pre-stringified payloads (E-032): worker prompts have
 *  historically been ambiguous — "payload: <the Decision Memo JSON>" reads as
 *  "stringify it first" to some agents. Re-stringifying that gives a JSONB
 *  scalar string the verifier can't read. If `payload` is a string that
 *  parses cleanly into an object or array, store the parsed value instead.
 *  Scalar string / number / boolean / null payloads pass through unchanged.
 */
export async function writeStepResult(args: WriteStepResultArgs): Promise<string> {
  const id = newStepResultId();
  const normalized = normalizePayload(args.payload) ?? null;
  const payloadText = JSON.stringify(normalized);
  const sizeBytes = Buffer.byteLength(payloadText, "utf8");
  const sql = client();
  const unitIndex = args.unitIndex ?? null;
  const kind = args.payloadKind ?? null;

  if (kind === null) {
    // ADR-022 worker-output path: fresh ULID per call, no uniqueness.
    // postgres.js auto-JSON-encodes any JS value bound directly to a `::jsonb`
    // cast site (including a JS string like `'{"a":1}'`, which it wraps to
    // `'"{\\"a\\":1}"'` and stores as a JSONB scalar string). Route the JSON
    // text through a subquery as `::text` first so postgres.js binds it as a
    // plain text parameter; the column-side `::jsonb` cast then parses the
    // JSON properly — objects→object, arrays→array, scalars→scalar, null→null.
    await sql`
      INSERT INTO orchestrator.step_results
        (id, run_id, step_id, unit_index, payload, size_bytes)
      SELECT ${id}, ${args.runId}, ${args.stepId},
             ${unitIndex}, x::jsonb, ${sizeBytes}
      FROM (SELECT ${payloadText}::text AS x) sub
    `;
    return id;
  }

  // ADR-024 idempotent input path: deterministic on the partial unique
  // index `(run_id, step_id, unit_index, payload_kind)` where
  // `payload_kind IS NOT NULL`. ON CONFLICT DO NOTHING + RETURNING gives
  // us the inserted row's id on first call; a follow-up SELECT covers the
  // already-existing case (RETURNING returns no rows when DO NOTHING fires).
  // The existing row's payload is preserved — re-plans never mutate state.
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO orchestrator.step_results
      (id, run_id, step_id, unit_index, payload, size_bytes, payload_kind)
    SELECT ${id}, ${args.runId}, ${args.stepId},
           ${unitIndex}, x::jsonb, ${sizeBytes}, ${kind}
    FROM (SELECT ${payloadText}::text AS x) sub
    ON CONFLICT (run_id, step_id, unit_index, payload_kind)
      WHERE payload_kind IS NOT NULL
      DO NOTHING
    RETURNING id
  `;
  if (inserted.length > 0) return inserted[0]!.id;

  const existing = await sql<{ id: string }[]>`
    SELECT id FROM orchestrator.step_results
    WHERE run_id = ${args.runId}
      AND step_id = ${args.stepId}
      AND unit_index IS NOT DISTINCT FROM ${unitIndex}
      AND payload_kind = ${kind}
  `;
  if (existing.length === 0) {
    // Should not happen: either INSERT returned id, or a row exists matching the key.
    throw new Error(
      `writeStepResult idempotency lookup miss for (${args.runId}, ${args.stepId}, ${unitIndex}, ${kind})`,
    );
  }
  return existing[0]!.id;
}

/** Load one payload by id. Throws `StepResultNotFoundError` if absent.
 *
 *  Called by the MCP verify/advance handlers via `resolveRefs` and by
 *  the standalone `mcp__orchestrator__read_step_result` tool.
 *
 *  postgres.js auto-parses JSONB columns into the matching JS value for
 *  every JSONB type — object→object, array→array, string→string,
 *  number→number, boolean→boolean, null→null. The write path stores the
 *  payload in its parsed JSONB form (not a JSONB scalar string) so this
 *  read path is a straight pass-through.
 */
export async function loadPayload(stepResultId: string): Promise<unknown> {
  const sql = client();
  const rows = await sql<{ payload: unknown }[]>`
    SELECT payload FROM orchestrator.step_results WHERE id = ${stepResultId}
  `;
  if (rows.length === 0) {
    throw new StepResultNotFoundError(stepResultId);
  }
  return rows[0]!.payload;
}

/** Thrown when `loadPayload` is given an id that doesn't exist.
 *  The MCP layer catches this and surfaces it as a verify problem
 *  (`{ok: false, problems: ["stepResultId not found: ..."]}`).
 */
export class StepResultNotFoundError extends Error {
  readonly stepResultId: string;
  constructor(stepResultId: string) {
    super(`step_result not found: ${stepResultId}`);
    this.name = "StepResultNotFoundError";
    this.stepResultId = stepResultId;
  }
}

/** Close the cached connection. Test helpers only.
 *  Backward-compatible alias for closeDb() — same shared pool. */
export async function closePostgres(): Promise<void> {
  await closeDb();
}

/** Public accessor for the singleton sql client. Used by the webapp's
 *  lib/orchestrator.ts to query runs / run_steps / step_results without
 *  opening a second pool. Throws when DATABASE_URL is unset. */
export function getOrchestratorSql(): Sql {
  return client();
}
