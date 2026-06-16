# 018 — Spec-build vs routing split: media-production owns specs, distribution is a router, /distribute is the unified command

Status: Accepted
Date: 2026-05-17
Source: Session 2026-05-17 architectural reconsideration; supersedes part of ADR-017 ("Commands map 1:1 to channels"); related: ADR-015 (write-API safety), ADR-016 (specs not artifacts), ADR-017 (distribution Option C orchestrator + adapters).

> **Status note (2026-05-24):** ADR-023 generalizes the principle behind this ADR. "Distribution is a pure mechanical router" was the specific carve-out for one stage; ADR-023 names the underlying doctrine — *the conductor is a reasoning surface, not transmission or execution* — and applies it to every mechanical step in the loop, not just distribution. The distribution-specific architecture below (mechanical router, no LLM at call time) stands unchanged and is now one instance of a general rule.

## Context

Phases B (Meta paid), D (YouTube), and E.3 (engineerdad-site articles) shipped distribution paths to three destinations. After they landed, two architectural inconsistencies became visible by inspection:

1. **The Meta path derived ad copy at distribution time.** Distribution agent's Step 5a.4 read the Variant's parent Script + parent Brief and constructed `primary_text` / `headline` / `description` / `call_to_action` / `targeting JSON` on-the-fly inside the routing agent. YouTube, by contrast, read its spec verbatim from Notion fields (`YT Title`, `YT Description`, `YT Tags`, `YT Category`) — fields populated upstream and reviewable at HG3. Articles were a third pattern: the agent built the `ArticleSpec` at delivery time from the AuthorityArticles row's substance fields.

2. **The article delivery path lived in media-production** (Phase E.3's `phase: articles`), even though media-production wasn't actually materializing anything — it was reading a Notion row, building a spec, calling a cross-repo MCP, and stamping `Delivered At`. That's distribution work dressed up as production. The "media-production owns artifact materialization" framing applied cleanly to static-image rendering (Step 5.5 → HTML→PNG via static-renderer) but applied awkwardly to articles where no rendering happens in this repo.

Three problems followed from these inconsistencies:

- **No reviewable text surface for Meta copy.** Because primary_text / headline / description were derived in distribution at call time, humans had no chance to inspect the actual ad copy before it shipped. HG3 was nominally the spec gate, but the gate was empty for Meta.
- **Distribution agent was doing two jobs.** It was both a content reasoner (truncate, pick hook, choose CTA-by-funnel-stage, build targeting JSON from persona) AND a transport router. The first is hard to test; the second is mechanical.
- **Command surface was about to proliferate.** ADR-017's "commands map 1:1 to channels" meant `/stage-ads`, `/publish-youtube`, `/publish-articles` today, with `/publish-meta-organic`, `/publish-ig`, `/publish-fb`, `/publish-tiktok` queued for later. Asymmetric with the rest of the OS where `/content` handles three artifact types in one call and `/produce` handles five format variants in one call.

The user surfaced both inconsistencies in a 2026-05-17 design conversation. The clean fix is one ADR superseding three things at once.

## Decision

### Spec authority lives in media-production; distribution is a mechanical router

The work splits cleanly along **substance vs packaging** (for content) and **packaging vs routing** (for distribution):

| Layer | Authority | Examples |
|---|---|---|
| **content-gen** | Substance | Body, FAQ, Topic, Target Query, AEO Schema declaration, Citations, Hook bank, Script body, CTA text |
| **media-production** | Packaging — per-channel spec preparation with format constraints baked in | Meta primary_text (truncate ≤125, include regulator phrase); YT title (≤100); article slug (kebab from title); description (SERP ≤200); reading_time (word-count math); targeting JSON (from Persona); CTA Type (from Funnel Stage); Channels (from Format×FunnelStage) |
| **distribution** | Routing — read prepared spec, call right MCP, back-fill result | `mcp__meta-ads__create_ad`, `mcp__youtube__upload_video`, `mcp__engineerdad_site__draft_article` |

**Distribution does not derive, truncate, or shape content.** It reads spec fields from Notion verbatim and passes them straight to MCPs. If a spec field is wrong, the fix is in media-production or in Notion at HG3 — never in distribution. This is the load-bearing invariant; it's why the agent prompt's hard rules now lead with "Never derive, truncate, or shape ad copy."

**Media-production fills specs only-if-empty.** Re-running `/produce` after a human edits a spec field at HG3 review never overwrites the human's edit. Idempotent; human-friendly.

### Schema deltas to make spec-build reviewable in Notion

For the substance/packaging split to be reviewable, the specs have to live in Notion fields (not derived in-flight). The G.1 migration adds:

**CreativeVariants** (Meta spec):
- `Meta Primary Text EN` / `Meta Primary Text BM` (rich_text)
- `Meta Headline EN` / `Meta Headline BM` (rich_text)
- `Meta Description EN` / `Meta Description BM` (rich_text)
- `Meta CTA Type` (select: LEARN_MORE | SIGN_UP | CONTACT_US | WHATSAPP_MESSAGE | GET_QUOTE | SHOP_NOW | DOWNLOAD | SUBSCRIBE)
- `Meta Targeting JSON` (rich_text holding a JSON string)

(The corresponding YouTube fields — `YT Title`, `YT Description`, `YT Tags`, `YT Category`, `YT Video ID` — already existed from Phase D and already followed this pattern.)

**AuthorityArticles** (AEO/GEO packaging):
- `Slug` (rich_text) — lowercase kebab-case
- `Description` (rich_text) — ≤200 char SERP meta description
- `Reading Time` (rich_text) — e.g. "6 min read"
- `Keywords` (multi_select) — SEO/AEO keywords
- `OG Image URL` (url) — Open Graph image
- `Hero Image URL` (url) — optional in-page hero
- `Hero Image Alt` (rich_text) — optional alt
- `Related Slugs` (multi_select) — optional inter-link hints

### Unified `/distribute` command

`/distribute --run=<id> [--channels=A,B,...] [--dry-run]` replaces `/stage-ads`, `/publish-youtube`, `/publish-articles`.

- Default `channelFilter` (no `--channels` flag) → process every channel value present on every approved row, plus the implicit `engineerdad-site` for approved Articles with empty `Delivered At`.
- `--channels=Meta-paid` narrows to one. `--channels=YouTube,YouTube-Shorts` narrows to two. Etc.
- `--dry-run` walks the plan without any MCP write or Notion update; emits `would_call` JSON per planned step.

Future channels (Meta-organic, IG-organic, FB-organic, TikTok) **do not** get new commands — they become new MCP adapters under the same `distribution` agent and new entries in the channel-defaults logic. The user-facing surface stops growing.

### `engineerdad-site` is a channel, not a separate workflow

Articles route through distribution like any other channel. There's no dedicated articles agent. There's no `phase: articles` on media-production anymore (that's deleted). The cross-repo MCP (`mcp__engineerdad_site__draft_article`) is called from distribution Step 4c, with the spec read from Notion exactly the same way Meta and YouTube specs are read.

The article channel uses an *implicit* destination — there's no `Channels` field on `AuthorityArticles`. An approved Article with `Delivered At` empty is, by convention, "going to engineerdad-site." When/if other article destinations (Medium auto-poster, LinkedIn cross-post) land later, an explicit `Channels` field on AuthorityArticles can be added then.

## Consequences

### Wins

- **HG3 review surface is real.** Humans editing a Variant at HG3 can read the exact `Meta Primary Text EN` that will ship — and change it. Same for `YT Title`, `Slug`, `Description`, etc. The gate they think they have is the gate they actually have.
- **Distribution agent is testable.** A read-only router with no content judgment is easy to unit-test against mocked MCPs, easy to dry-run, easy to audit. Its full description fits in one sentence: "read the spec from Notion, call the right MCP, back-fill the result."
- **Spec changes happen in one place.** Truncation logic, regulator-phrase inclusion, CTA-by-funnel-stage mapping, targeting-by-persona logic — all in media-production. When the truncation boundary changes (Meta updates its rec) or the CTA mapping changes (a new BOFU stage), the edit is one location.
- **Command surface stops growing.** New channels = new MCPs + new routing branches + new schema fields. Not new commands.
- **Symmetry across the OS.** `/content` → many artifacts. `/produce` → many formats. `/distribute` → many destinations. Same shape.

### Trade-offs accepted

- **CreativeVariants schema is wider.** 8 new fields (Meta spec) on top of the existing 5 (YT spec). 13 spec fields total per Variant. Larger Notion table view; humans scroll more. Mitigated by Notion's column-hide UX — most reviewers focus on the spec fields for the channels actually in play for that Variant.
- **Two-step "spec → publish" cycle.** A Variant must go through /produce (spec build) AND /distribute (routing). Re-running /produce after a human edits at HG3 is safe (fill-only-if-empty), but the loop has more steps than the old "/stage-ads does everything" model. The trade: explicit review opportunity at HG3.
- **Articles enrichment runs on every /produce.** Even if you haven't changed an article, the enrichment pass walks approved rows on every /produce. Idempotent (no-ops fully-populated rows), but not zero cost. Acceptable at 1–2 articles per run.

### Forward-compat

- **New sibling codebases inherit the pattern.** When you eventually have an iOS app, an email newsletter system, etc., each gets its own MCP server (in its own repo), distribution adds a routing branch, media-production adds a spec-prep step. Same shape as engineerdad-site.
- **Meta organic / IG / FB / TikTok**: media-production's Meta spec build is already partly cross-applicable (the same primary_text + headline + description work for paid and organic Meta). When organic Meta lands, distribution gets a new routing branch reading the same fields. No schema change needed.
- **The dryRun flag generalizes.** Any future destination that supports it gets free dry-run support — the agent walks the plan and emits `would_call`. The flag is uniform across channels by design.

### What's deprecated / removed

- `/stage-ads`, `/publish-youtube`, `/publish-articles` — deleted (no operational history; muscle memory wasn't established).
- `phase: articles` branch in media-production.md — deleted. Articles enrichment is now Step 8 (always runs, no phase branching).
- The "build spec at distribution time" pattern in distribution.md Step 4a (formerly 5a) — replaced with "read from Notion verbatim."
- ADR-017's "Commands map 1:1 to channels" — superseded by this ADR's unified-command doctrine.

### What's NOT changed

- ADR-015 safety doctrine — unchanged. MCPs still hard-wire safe states.
- ADR-016 specs-not-artifacts doctrine — unchanged. Marketing OS still hands a spec to engineerdad-site via function call; engineerdad-site still owns the artifact format.
- ADR-017 Option C orchestrator + adapter pattern — partially superseded (only the "commands map 1:1" claim). The "one orchestrator + thin adapter MCPs" still holds.

## Status note on ADR-017

The "Commands map 1:1 to channel filters" section of ADR-017 is **superseded** by this ADR. The "one orchestrator agent owns all channel routing" section is **preserved** — that part of ADR-017's design stands; only the user-facing command surface is unified.

The original ADR-017 examples (`/stage-ads → distribution + channelFilter=["Meta-paid"]`) read as historical context for this evolution, not as current dispatch.
