# 017 — Distribution layer as Option C (single orchestrator agent + thin per-platform adapter MCPs)

Status: Partially superseded by [ADR-018](./018-spec-build-vs-routing.md) (2026-05-17). The "one orchestrator + thin adapter MCPs" core design stands; the "Commands map 1:1 to channel filters" sub-section is superseded — `/stage-ads`, `/publish-youtube`, `/publish-articles` were unified into `/distribute` per ADR-018. Read this ADR alongside 018 for the current shape.
Date: 2026-05-16
Source: Plan session 2026-05-16 (`~/.claude/plans/purring-crafting-perlis.md`, Phase A); supersedes the earlier per-platform `ads-ops` / `youtube-ops` design within the same plan iteration

## Context

The distribution layer needs to push approved Variants to multiple destinations (Meta paid, YouTube long, YouTube Shorts, and eventually Meta organic / IG / TikTok). The initial design sketched one agent per destination — `ads-ops` for Meta, `youtube-ops` for YouTube, etc. — modeled on the existing single-purpose agent pattern (tracking, analytics, targeting, content-gen, media-production).

During plan ratification (2026-05-16), the user surfaced a symmetry issue: for articles, `media-production` owns the full lifecycle (produce + materialize via cross-repo MCP). Why does video/image distribution need a separate agent per platform when the article path doesn't?

Three options were considered:

| Option | Shape                                                              | Notes |
|--------|--------------------------------------------------------------------|-------|
| **A** — One distribution agent, all sinks built-in                  | Tools include `mcp__meta-ads__*` + `mcp__youtube__*` + future platforms; agent has every platform's API directly | Big tool surface always loaded; cross-channel coordination trivial; harder to test channels in isolation |
| **B** — Per-sink agents (`meta-distrib`, `youtube-distrib`, ...)    | Many tiny focused agents, each owning one platform | Small per-agent context; channel independence; coordination requires Brain or a new coordinator; more files to maintain |
| **C** — Single orchestrator agent + thin per-platform adapter MCPs  | One `distribution` agent owns channel-routing logic; each platform is a dumb MCP server wrapping its API; MCP layer enforces all safety | Industry pattern (Buffer/Hootsuite); the MCPs hold all the safety enforcement (ADR-015); orchestrator stays small because the smart stuff is in the MCPs; adding a channel = new MCP + a few lines in the orchestrator |

Option C was selected. The decisive arguments:

1. **The safety enforcement layer is the MCP, not the agent** (ADR-015). Since the MCPs are doing the heavy lifting, the agent is mostly a routing function — fragmenting that routing across multiple agents doesn't reduce complexity, it just duplicates the routing.
2. **Channel-specific logic at the *agent* level is not anticipated to diverge.** All channels follow the same pattern: read `Channels` field, look up the entity ID, call the right MCP. Strategic divergence (Meta needs ML-driven bidding, YouTube doesn't) is not on the v1 roadmap.
3. **Cross-channel cases are 5-line functions, not coordination dances.** A Reel scheduled to Meta paid AND YouTube Shorts at the same moment is two sequential MCP calls inside one agent's flow. Splitting it across agents would require Brain or a new coordinator to sequence them.

## Decision

### One `distribution` agent owns all channel routing

`/Users/solid/Code/engineerdad-marketing/.claude/agents/distribution.md` is the single agent for the distribution layer.

- Model: sonnet (routing logic, not strategic reasoning)
- Tools: `mcp__meta-ads__*` (all writes from E-009) + `mcp__youtube__*` (added in E-010) + `mcp__notion__query` + `mcp__notion__update_page` + `mcp__corpus__get_compliance_block` + `mcp__analytics__log_event`
- Responsibilities:
  1. Query approved `CreativeVariants` rows for the current run
  2. For each row, read the `Channels` multi-select field
  3. For each channel listed, call the matching MCP adapter:
     - `Meta-paid` → `mcp__meta-ads__*` (create_ad chain)
     - `YouTube` → `mcp__youtube__upload_video` (long-form metadata)
     - `YouTube-Shorts` → `mcp__youtube__upload_video` (shorts metadata — same MCP, different metadata shape)
     - Future channels → their respective MCPs
  4. Back-fill platform-specific IDs to Notion (`AdID`, `YTVideoID`, etc.)
  5. Skip rows where the relevant ID is already populated (idempotent re-runs)

### Thin per-platform adapter MCPs hold all safety enforcement

Each platform gets its own MCP server (`mcp-servers/meta-ads/`, `mcp-servers/youtube/`, etc.). The MCP servers are "dumb adapters" in the sense that they have no business logic — they just wrap the platform's API surface. But they are "smart adapters" in the sense that **they hold every safety guarantee that matters** (per ADR-015):

- Hard-wired safe states on create (`PAUSED`, `unlisted`)
- No activation tools exist
- Guards on `update_*` for live entities
- Compliance checks inside the create path
- Idempotency via `client_request_id`

The agent does not enforce these. The agent calls `mcp__meta-ads__create_ad(...)` and trusts the MCP server to return a PAUSED ad. This is the right division: the agent is a routing function; the MCP is the contract with the platform.

### Commands map 1:1 to channel filters, not to agents

- `/stage-ads` — spawns `distribution`, filters to `Channels` containing `Meta-paid`
- `/publish-youtube` — spawns `distribution`, filters to `Channels` containing `YouTube` or `YouTube-Shorts`
- (Future) `/publish-meta-organic` — spawns `distribution`, filters to `Channels` containing `Meta-organic`

The user-facing surface is per-channel for UX clarity, but the agent invoked is the same one each time. This means `/stage-ads <runId>` and `/publish-youtube <runId>` can run interleaved or simultaneously without coordination — they invoke independent passes over different channel subsets.

### Adding a new channel is additive

When IG organic, FB organic, or TikTok lands:

1. Build a new MCP server (`mcp-servers/<platform>/`) with safe-state hard-wired
2. Add the platform's tools to the `distribution` agent's tool list (one-line change in `.claude/agents/distribution.md`)
3. Add the channel value to `CreativeVariants.Channels` multi-select options
4. Optionally add a `/publish-<platform>` command
5. Update the channel-defaults logic in `content-gen` / `media-production` to populate the new option per Format + FunnelStage

Steps 1, 3, and the channel-defaults change are the only places that grow with each new channel. The agent itself grows by one tool-list line. The orchestration code grows by one `case`-arm.

## Consequences

### Wins

- **One orchestrator to debug.** When distribution misbehaves, there's one agent's log to read, one routing decision to trace. No "which agent did this, and who told it to fire?"
- **Cross-channel coordination is free.** A Variant going to both Meta paid AND YouTube Shorts is two sequential MCP calls in the same agent invocation — no inter-agent message passing.
- **Adding a channel doesn't touch existing channels.** New MCP, new channel value, two-line orchestrator change. No risk of breaking Meta when adding TikTok.
- **The safety doctrine (ADR-015) holds uniformly.** Every channel inherits the same enforcement pattern because the pattern lives in the MCP layer, not in the agent prompt.
- **Symmetric with the article path.** `media-production` owns article materialization end-to-end (calling out to engineerdad-site's MCP); `distribution` owns video/image distribution end-to-end (calling out to platform MCPs). Two orchestrators, one principle.

### Trade-offs accepted

- **`distribution`'s tool surface grows over time.** With Meta + YouTube + IG + FB + TikTok all live, the agent loads ~5 platforms' worth of MCP tools every invocation. At sonnet-class context budgets, this is not a problem at the v1.5 scale. If the tool count explodes (say, dozens of platforms), revisit the split — but cross that bridge when it appears.
- **All-platform context loaded for single-platform runs.** `/stage-ads` for Meta-only still loads YouTube's MCP tools into the agent's context. Wasteful but bounded (a few hundred tokens of tool schemas, not a per-call cost).
- **One agent's bug surface is wider.** A bug in `distribution`'s routing logic affects every channel. Mitigated by keeping the agent thin (it's a router, not a reasoner) and by unit-testing the routing against mocked MCPs.

### Forward-compat

- **If a channel's *agent-level* logic ever diverges substantially** (e.g., TikTok requires an ML-bid-suggestion subagent that nothing else needs), spin off a dedicated agent for that channel only and have `distribution` delegate to it via the `Task` tool. The orchestrator pattern stays; one channel just gets its own sub-orchestrator.
- **The same shape extends to organic-only channels.** Meta organic, IG organic, FB organic, TikTok — all fit `distribution` with their own MCP. The `Channels` multi-select already includes `Meta-organic`, `IG-organic`, `FB-organic` as options; the MCPs land when those channels become in-scope.
- **Brain stays out of the loop for routine distribution.** Brain calls `/stage-ads` or `/publish-youtube` once; the orchestrator handles the per-variant routing. Brain's role is strategy (which Variants to push, which channel mix to default), not tactics (which API call to make in what order).

### Cross-references

- ADR-005 (MCP architecture) — extends the in-process MCP doctrine with the "many thin adapters, one fat orchestrator" pattern.
- ADR-015 — every adapter MCP enforces its own safety; this ADR establishes that the orchestrator can trust them to.
- ADR-016 — the cross-repo MCP pattern (engineerdad-site article-writer) is structurally identical from the calling side; this ADR clarifies that the orchestrator and the MCP can live in the same OR different repos, depending on who owns the artifact format.

## Status note

The original plan draft had `ads-ops` and `youtube-ops` as separate per-platform agents. That design is superseded by this ADR. No code shipped under the old names — the rename happened during plan ratification, before any agent file was created.
