// E-034 — thin shim over @engineerdad/analytics's Drizzle client.
// The experiment readout queries analytics tables read-only; we share
// the same connection pool rather than opening our own.
import { getDb, getSql, closeDb } from "@engineerdad/analytics";

export { getDb, getSql, closeDb };

/** Backward-compat — historical alias used by readout.test.ts. */
export function resetExperimentDbCache(): void {
  // No-op: callers should use truncatePg() / closeDb() now.
}
