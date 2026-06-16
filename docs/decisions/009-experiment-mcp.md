# 009 — Experiment MCP

Status: Accepted
Date: 2026-05-06
Source: TASKS.md Phase 3a/3e + Phase 7.10

## Context

The experiment MCP (XOS) designs factorial cell expansions and reads them out post-run. It sits between Brain (which decides factors) and Notion (which records the experiment row). Two design questions: should it write to Notion directly? Should it call analytics? Both answered "no" to keep MCPs as thin adapters.

## Decision

- **`experiment.design` is return-only**: it does NOT write to the Notion Experiments DB. The experiment-os subagent takes the design output and calls `notion.create_page` separately. Keeps the MCP testable without Notion.
- **`experiment.readout` reads the analytics SQLite directly** (`data/engineerdad.sqlite`, opened with `readOnly: true`) rather than calling analytics-as-MCP. Reason: MCP servers don't call each other in this architecture; agents orchestrate. Same pattern as notion MCP reading `data/notion-ids.json`. Tighter schema coupling, but both servers live in this repo so it's manageable. `readout` accepts an optional `db_path` override for tests.
- **`experiment.readout` cell-membership shape**: caller (agent) supplies `cells: [{cell_id, ad_ids[], is_control?}]` — i.e. resolves CreativeVariant page → ad_id mapping in the agent layer, then passes the explicit grouping. The MCP doesn't infer cell membership.
- **Factorial cell expansion**: `design` produces the cross-product of factor levels, applies the 70/20/10 budget overlay, and runs a min-creatives sanity check. Returns the cell list with allocation tags.
- **HUMAN GATE 4**: v1 stops at the experiment design — humans launch in Meta Ads Manager and back-fill ad_id into each Variant. XOS does not auto-launch.

## Consequences

- Brain orchestrates the dispatch order: `experiment.design` → `notion.create_page` → human launch → (7d wait) → `experiment.readout`.
- The cell↔ad_id mapping is a known fragile join (the only thing tying CreativeVariant rows in Notion to Meta ad_ids). v1 mitigates with a hard naming convention (Campaign: `EDOS_<runId>`; Ad Sets: `cell_NN__<angle>__<format>`; Ads: `var_<short-id>`); v1.5 may automate via `publish_ad_draft` returning the ad_id.
- Read-only SQLite path means readout cannot be racing an in-flight ingest — reads always reflect committed insights.
