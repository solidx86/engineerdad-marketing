// Public surface of @engineerdad/experiment — consumed by the experiment MCP
// adapter and by the orchestrator's eager-execute dispatch (ADR-023 Phase G).

export { design } from "./design.js";
export type {
  Factor,
  DesignInput,
  DesignCell,
  DesignOutput,
} from "./design.js";

export { readout } from "./readout.js";
export type {
  ReadoutCell,
  ReadoutInput,
  ReadoutOutput,
} from "./readout.js";

export {
  getDb,
  getSql,
  closeDb,
  resetExperimentDbCache,
} from "./db.js";
