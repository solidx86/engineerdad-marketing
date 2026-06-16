// B-005 — IG organic publishing is disabled at the MCP tool surface.
//
// Meta's IG Content Publishing API has no scheduled-post support: a
// `scheduled_publish_time` passed to `/media_publish` is silently ignored and
// the post goes live immediately. That violates the ADR-019 schedule-only
// doctrine (there is no server-side scheduled queue, so no cancel window).
//
// Until E-024 (always-on scheduler/executor) lands, IG organic posts are
// published manually from the webapp posting pack (/posting-pack/organic/<runId>).
// This guard fails
// closed at the MCP boundary — `/distribute` and any other tool caller get a
// loud refusal instead of a silent immediate publish. FB publishing is
// unaffected (FB Graph API supports native scheduling).
//
// The underlying `publishImagePost` / `publishCarouselPost` / `publishVideoPost`
// functions are intentionally NOT touched — they stay importable for E-024's
// future publish-worker, which will do an immediate publish at the scheduled
// minute. Only the MCP tool surface is gated. Delete this module + its three
// call sites in index.ts when E-024 re-enables IG.

export const IG_DISABLED_MSG =
  "ig_publish_disabled: IG organic publishing via this MCP is disabled (B-005). " +
  "Meta's IG Content Publishing API has no scheduled-post support — a scheduled " +
  "time is silently ignored and the post publishes immediately. Publish IG posts " +
  "manually from the webapp posting pack (/posting-pack/organic/<runId>). FB publishing is unaffected. " +
  "Re-enabled by E-024 (always-on scheduler).";

export function isIgPublishDisabled(platform: "ig" | "fb"): boolean {
  return platform === "ig";
}
