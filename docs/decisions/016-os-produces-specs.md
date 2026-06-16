# 016 — Marketing OS produces specs, not artifacts (cross-repo handoff via function call, not shared data store)

Status: Accepted
Date: 2026-05-16
Source: Plan session 2026-05-16 (`~/.claude/plans/purring-crafting-perlis.md`, Phase A); memory `feedback_os_produces_specs_not_artifacts.md`

## Context

As the Marketing OS extends past HG3 (Variant approved) into actual publishing, a category boundary emerges: some destinations are **third-party platforms** (Meta, YouTube — the user does not own a codebase for them), while others are **systems the user owns** (`engineerdad-site` is a vanilla HTML site at `/Users/solid/Code/engineerdad-site/`). The naive design — let Marketing OS render HTML and commit it directly into engineerdad-site — was rejected by the user with an analogy that surfaced the underlying principle:

> "Just like we don't generate video ourselves (we hand a shotlist to kie.ai/Gemini/human), we shouldn't generate HTML for the website ourselves. The site repo owns the template, the conventions, the deploy story. If those change, the change should happen in one place — the system that owns the artifact format."

This is the **hexagonal-architecture / ports-and-adapters** insight applied to a multi-codebase OS: a system that consumes an artifact format should not be the system that produces it. Otherwise every downstream convention (template placeholder names, FAQ schema, bilingual URL rules, brand contract details) leaks into the upstream system and must be re-synced on every change.

A second pass tightened the principle further. An earlier framing had Marketing OS reading the article spec from Notion, calling the engineerdad-site agent, AND having that agent **also** read/write Notion to mark itself "delivered." The user rejected that too: the engineerdad-site agent should know nothing about Notion. Its contract is a pure function — spec in, confirmation out. Otherwise it cannot be invoked from a CLI, a Slack bot, a test harness, or any other caller that doesn't speak the OS's Notion schema.

The combined doctrine: **specs cross repo boundaries via function calls; data stores stay private to their owners.**

## Decision

### Marketing OS produces specifications

`content-gen` and `media-production` are the OS's production-layer agents. They produce **specifications** — structured data describing what should be rendered:

- `content-gen` → text specs: scripts (with hook banks), authority article bodies, copy
- `media-production` → media specs: shotlists, scene cards, thumbnail briefs, format matrices

These specs land in Notion (`Scripts`, `AuthorityArticles`, `CreativeVariants`). Notion is the OS's **private workflow state** — schema versioned in `packages/notion-bootstrap/src/schemas.ts`, mutated only by OS-internal agents.

### Artifact production lives where the artifact format is owned

The fork that determines where rendering logic lives:

| Type of destination                                       | Where rendering lives                          | Why                                                          |
|-----------------------------------------------------------|------------------------------------------------|--------------------------------------------------------------|
| **Third-party platform** (Meta, YouTube, IG, TikTok)      | An MCP server **inside Marketing OS** wrapping the platform's API | There's no other codebase to host it; the OS is the only owner |
| **System the user owns a codebase for** (engineerdad-site, future apps) | An agent or MCP server **inside that codebase** | That codebase owns the format/template/conventions and the deploy story |

For engineerdad-site specifically: the article-writer MCP lives at `/Users/solid/Code/engineerdad-site/mcp/article-writer/` (final path confirmed at Phase E start). It reads `_template.html`, performs `{{placeholder}}` substitution, renders FAQ JSON-LD + visible HTML in sync, writes the file, commits it. Marketing OS never touches the template, never knows the placeholder list, never executes a git command against engineerdad-site.

### The handoff contract is a function call, not a shared data store

Marketing OS reads the spec from Notion (its own state), calls the downstream agent **with the spec as INPUT**, receives a minimal return value, and writes that return value back to Notion. The downstream agent is a pure function: spec in → confirmation out.

```
[Marketing OS]                                              [engineerdad-site]
  media-production reads AuthorityArticles row              article-writer MCP
       │
       │  spec_obj = { slug, title, lang, body_html, faq, ... }
       └────────────────────────────────────────────────────►  draft_article(spec_obj)
                                                                    │
                                                                    │  reads _template.html
                                                                    │  substitutes placeholders
                                                                    │  writes file
                                                                    │  git commit (no push)
                                                                    ▼
       ┌────────────────────────────────────────────────────  { ok, slug, lang, file_path }
       │
       ▼
  marks Notion row DELIVERED
```

The return value is **minimal** — whatever the receiving system naturally produces (`ok`, `slug`, `lang`, `file_path`). It does NOT include workflow metadata that only makes sense to the OS (e.g., do not invent a `notion_row_url` to round-trip). Tracking artifacts like PR URLs are NOT added unless they're genuinely useful for the workflow; the user rejected PR-URL bookkeeping during the conversation that drove this ADR.

### MCP is the transport for the cross-repo handoff

The function call materializes as an MCP tool call. The article-writer MCP registers in the Marketing OS's `.mcp.json` with stdio transport (for v1, same-machine). Same protocol as in-house adapters; only the server location differs.

Future move to a different machine requires only a transport swap (stdio → HTTPS) in `.mcp.json`. No agent code changes; the calling site is `mcp__engineerdad_site__draft_article(spec)` regardless of where the server runs.

### Notion stays private to Marketing OS

No downstream agent in any sibling codebase reads or writes Notion. Marketing OS owns the Notion schema, the Notion API token, and all Notion mutations. Specs flow OUTWARD via function arguments; results flow BACK via return values; OS writes those results back to Notion itself.

## Consequences

### Wins

- **Template/convention changes stay local.** When engineerdad-site's `_template.html` adds a new section, the change is in one place — the site repo. No coordination with Marketing OS needed; no version-skew risk between two systems trying to track the same template.
- **Sibling agents are reusable.** The article-writer MCP can be invoked from a CLI (`claude --agent article-writer < spec.json`), from a future Slack bot, from a test harness — anywhere. No Notion coupling means no caller-specific scaffolding.
- **Each codebase grows its own agent ecosystem.** engineerdad-site can add `slide-builder`, `tool-page-generator`, `landing-page-renderer` over time without polluting Marketing OS. Owned systems are first-class citizens of the AI workflow, not afterthoughts.
- **Failure is local.** A bug in the article-writer doesn't corrupt Notion state; it returns an error, Marketing OS leaves the row un-DELIVERED, next run retries.

### Trade-offs accepted

- **Two systems must agree on the spec schema.** When the spec contract changes (new field, renamed field), both sides update. We mitigate by making the spec object the **only** contract — versioned in `docs/integrations/<system>-<agent>.md` — and treating it as a stable interface (additive changes only, deprecation for removals).
- **No transactional guarantees across the boundary.** If the MCP call succeeds but the Notion update fails (rare), the article exists in the site repo but the OS thinks it's un-DELIVERED. Idempotency on the receiving side (skip if file already exists for this slug+lang) makes the retry safe. Net behavior: at-least-once, not exactly-once.
- **Slight latency vs. in-process.** stdio MCP is fast (~10ms overhead per call) but non-zero. Negligible at one-article-per-publish; would matter only at very high throughput.

### Forward-compat

- **Future owned codebases inherit the pattern.** If the user later builds an iOS app, an email-newsletter system, a Notion plugin, etc., each one hosts its own agents/MCPs that Marketing OS calls. No central monorepo, no shared schema sprawl.
- **Transport is swappable.** Same-machine stdio today; HTTPS-over-network when a system moves to a different host. The agent code is unchanged across the swap.
- **The MCP server in the sibling repo can itself spawn its own subagents** without leaking that complexity to Marketing OS. The function-call contract is the only thing that crosses the boundary.

### Cross-references

- ADR-005 (MCP architecture) — extends the in-process MCP doctrine to cross-repo MCPs; same protocol, different server location.
- ADR-015 — the safety doctrine applies symmetrically: a cross-repo MCP also hard-wires its safe state (e.g., article-writer commits but does not push, does not modify `index.html`). The MCP layer is the enforcement point regardless of which repo it lives in.
- ADR-017 — the distribution agent uses this same handoff pattern when calling out to MCP servers; ADR-017 establishes the orchestrator role, this ADR establishes that the called MCP can live in another codebase entirely.

## Status note

This ADR codifies a principle that was implicit but not written down. The first cross-repo application is E-008 (engineerdad-site article-writer). Future ops integrations (additional sites, apps, owned systems) should reference this ADR as the canonical justification rather than re-deriving the principle.
