import type { StageDefinition } from "./types.js";
import { fixtureStage } from "./stages/fixture.js";
import { trackingStage } from "./stages/tracking.js";
import { analyticsStage } from "./stages/analytics.js";
import { synthesizeStage } from "./stages/synthesize.js";
import { briefStage } from "./stages/brief.js";
import { contentStage } from "./stages/content.js";
import { produceStage } from "./stages/produce.js";
import { experimentStage } from "./stages/experiment.js";
import { distributeStage } from "./stages/distribute.js";
import { scheduleStage } from "./stages/schedule.js";

/**
 * FIXTURE_REGISTRY — the fixture stage alone. Kept for the engine unit tests,
 * which exercise plan/verify/advance against a deterministic stage.
 */
export const FIXTURE_REGISTRY: StageDefinition[] = [fixtureStage];

/**
 * LIVE_REGISTRY — the ordered design-§8 loop the orchestrator MCP drives:
 *
 *   tracking → analytics → synthesize → brief → content → produce →
 *   schedule → experiment → distribute
 *
 * `schedule` precedes `experiment` + `distribute` (Phase 4 review). The human
 * gates are carried inside the stages (HG1 brief, HG2 content, HG3 produce)
 * as `gate` steps — the conductor STOPs there. `distribute` is terminal with
 * no gate: under the default META_PAID_MODE=manual the Meta-paid ads are
 * created by hand from the webapp posting pack (ADR-015 amendment).
 */
export const LIVE_REGISTRY: StageDefinition[] = [
  trackingStage,
  analyticsStage,
  synthesizeStage,
  briefStage,
  contentStage,
  produceStage,
  scheduleStage,
  experimentStage,
  distributeStage,
];

/** Stage definitions re-exported here for the public barrel. */
export {
  fixtureStage,
  trackingStage,
  analyticsStage,
  synthesizeStage,
  briefStage,
  contentStage,
  produceStage,
  experimentStage,
  distributeStage,
  scheduleStage,
};
