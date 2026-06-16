# 006 — Meta Ads MCP

Status: Accepted
Date: 2026-05-06 (initial), 2026-05-08 (8.5 transform), 2026-05-09 (8.6 time_increment)
Source: TASKS.md Phase 3b/3c + Phase 7 decision-locks + Phase 8.5/8.6

## Context

The meta-ads MCP wraps two Meta APIs: the Marketing API (insights, campaigns, creatives, draft publish) and the Conversions API (CAPI). Both are sharp tools — wrong CAPI scoping spams production data; wrong insight-shape coercion silently drops conversion attribution. This ADR records the safety nets.

## Decision

### Core

- **Meta API version**: pinned to `v21.0` in one constant; bump in one place when Meta deprecates.
- **CAPI safety net**: `capi_send` accepts an optional `test_event_code`. If the agent omits it, the server injects `META_CAPI_TEST_EVENT_CODE` from env. If THAT is also unset, the call **throws loudly** rather than silently going to production. Production CAPI deferred (see backlog item E-003); `META_CAPI_TEST_EVENT_CODE` lives in `.env.example` with a comment pointing to Meta Events Manager → Test Events.
- **PII hashing**: SHA-256 of `value.trim().toLowerCase()` for `em` / `ph` arrays. Already-hashed values (64-char hex) are passed through, so callers can pre-hash if they prefer.
- **~~`publish_ad_draft` stub~~ — REMOVED in Phase B.1 (2026-05-17).** Replaced by the full write surface (`create_campaign`, `create_adset`, `update_adset`, `pause_adset`, `pause_campaign`, `upload_video`, `upload_image`, `create_ad_creative`, `create_ad`, `update_ad`, `pause_ad`, `get_entity_status`, `list_ads`). Safety doctrine codified in ADR-015 — every create_* hard-wires `status: 'PAUSED'`, no `activate_*` tool exists, `update_*` is guarded against live entities. `create_ad_creative` runs a sentinel-phrase compliance check before posting.
- **`act_` prefix is now idempotent** in `mcp-servers/meta-ads/src/insights.ts` — `adAccountPath()` accepts both `act_<id>` and bare `<id>` in `AD_ACCOUNT_ID`. Was hard-prepending `act_` regardless, producing `act_act_...` and a Meta GraphMethodException 100. Phase 7.3 first run hit this bug.

### CAPI schema fixes (Phase 7)

- **`event_source_url` is a first-class field** on `CapiEvent` (interface + Zod schema in `mcp-servers/meta-ads/src/{capi,index}.ts`). Meta returns HTTP 400 "Invalid parameter" when `action_source: "website"` events lack `event_source_url`, and Zod's default object schema strips unknown keys.
- **`event_time` is server-filled when omitted.** Was a hard-required `number`; the tracking agent kept guessing the wrong year (Meta rejects events older than 7 days). Now optional; `capiSend` injects `Math.floor(Date.now()/1000)` per event when missing. Tracking agent's procedure was updated to **omit** `event_time` rather than guess.
- **Test Events UI display requires domain allowlisting.** Meta's CAPI accepts events from any domain (and returns `events_received: 1`), but the Test Events live feed silently suppresses events whose `event_source_url` domain isn't acknowledged in Business Manager → Diagnostics → "Confirm domain that belong to you". **Full domain verification (DNS TXT or meta-tag) is a v1.5 prerequisite** before live conversion CAPI ships (see E-003).
- **`action_source: "system_generated"` events do not reliably surface in the Test Events UI** even when accepted by Meta. The visible canary is `action_source: "website"` with a verified-domain `event_source_url`. The MCP server's `capiTestEvent()` still uses `system_generated` — that path remains the lowest-overhead canary for proving the credential + token + pixel binding, but display-level confirmation requires a `website` event sent via `capi_send`.

### Server-side raw-Meta-row transform (8.5)

- **`MetaInsightRowSchema` accepts both canonical rows AND raw Meta API rows** (string-typed numbers, `date_start`/`date_stop`, nested `actions[]` / `action_values[]` / `video_avg_time_watched_actions[]`) via a lenient input shape + `.transform()` that canonicalises server-side.
- **Field mapping rules**: `date` ← `date_stop` ?? `date_start`; numeric strings → `Number()`; `leads` derived from `actions[]` where `action_type ∈ {lead, onsite_conversion.lead_grouped}`; `purchases` from `{purchase, offsite_conversion.fb_pixel_purchase, onsite_conversion.purchase}`; `value` from `action_values[]` matching purchase types; `avg_watch_sec` from `video_avg_time_watched_actions[0].value` divided by 1000 (Meta returns ms).
- **Explicit numeric fields override array-derived ones** (idempotent re-ingest). Integer fields truncated.
- Fix replaces a class of agent prompt drift (analytics agent kept inventing synthetic ad_ids like `aggregate_30d` because it tried to do field mapping client-side). Aligns with thin-MCP doctrine (see ADR-005).

### `time_increment` auto-injection (8.6)

- **`time_increment: "1" | "all_days" | "monthly"`** added to `InsightsInput` and the matching Zod schema. When `level === "ad"` and `time_increment` is unspecified, the query auto-injects `time_increment: "1"` so Meta returns one row per ad per day instead of one row per ad spanning the whole window.
- Other levels (`campaign`, `adset`) keep Meta's default behaviour (window-spanning) unless callers opt in.
- Daily rows are already canonicalised by the 8.5 server-side transform (`date ← date_stop ?? date_start`), so no downstream changes needed.
- Forward-compat insurance for run_2+: once there's >1 ad, decay curves silently degrade to one-row-per-ad without this.

## Consequences

- Production CAPI is gated behind both env-var check AND domain verification — three safety layers between an agent and a real conversion event.
- `act_` and `act_act_` no longer matter — env-var sloppiness can't break insights pulls.
- Server-side transform is the durable fix for "agents drop ad_id" — no prompt-engineering fragility.
- `time_increment` default per level matches what each level usually needs; opt-out exists via `"all_days"`.
