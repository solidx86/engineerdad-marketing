// Public surface of @engineerdad/analytics — consumed by the analytics MCP
// adapter and by the orchestrator's eager-execute dispatch (ADR-023).

export {
  costPerAngle,
  decayCurve,
  engagementPerAngle,
  ingestMetaInsights,
  logEvent,
  topCreatives,
  upsertCreative,
  isoDaysAgo,
} from "./tools.js";

export { banditAllocate, banditUpdate, betaSample } from "./bandit.js";

export {
  ArmTagSchema,
  CreativeSchema,
  IngestMetaInsightsInputSchema,
} from "./types.js";
export type { ArmTag, Creative } from "./types.js";

export { ingestMetaOrganicInsights } from "./ingest-meta-organic.js";
export type {
  VariantSpec,
  IngestArgs,
  IngestResult,
} from "./ingest-meta-organic.js";

export { getDb, getSql, resetDbCache, closeDb } from "./db.js";
