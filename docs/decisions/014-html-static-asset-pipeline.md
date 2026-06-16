# 014 — HTML-rendered static-asset pipeline (orchestrator + worker)

Status: Accepted
Date: 2026-05-11
Source: TASKS.md B-004 (gap surfaced during E-004 image-phase iteration)

## Context

ADR-013 (2026-05-10) wired the static-format branch of `media-production` to **Gemini Nano Banana** ($0.039/image, ~70% brand fidelity). It worked, but inspecting the first iteration outputs surfaced three structural problems:

1. **Brand fidelity ceiling** — Gemini hallucinated the EngineerDad palette every render (close to navy + orange but never exact). Logo could not be reliably reproduced from text description. Fonts varied per call.
2. **No real chart support** — text-to-image cannot render data-accurate charts. Any chart-bearing creative had to be either a "chart-shaped decorative element" (false data) or skip charts entirely. For a finance-content brand, faking numbers is non-negotiable: it's a compliance violation.
3. **Cost ≠ value** — at $0.039/image × ~14 images per /produce run = ~$0.55/run. Cheap absolutely, but expensive relative to the alternative (HTML + headless browser = $0/render) given the brand-fidelity tax.

Considered alternatives included Canva MCP (rejected — discovered via schema inspection that the MCP tool surface has no chart-data injection operation; charts would need pre-rendering anyway, and template-based design conflicts with per-Variant tone flexibility).

User confirmed direction (2026-05-11): replace static-format Gemini path with HTML + Playwright. Open question that drove the orchestrator/worker split: **how to keep media-production's prompt small as the same pattern lands for video** (E-004 video phase, eventually). If media-production composes HTML inline, it bloats; if it spawns workers, the responsibility separation scales — video phase just adds a video worker, swap the prompt template, no change to the orchestrator.

## Decision

### Orchestrator + worker architecture

**`media-production` is a pure orchestrator** — reads Scripts, resolves buckets, decomposes shotlists, **delegates** per-Variant asset rendering to spawned `general-purpose` subagents (workers) via the `Task` tool. The orchestrator never composes HTML, never invokes the renderer directly except as a retry path on worker failure.

Workers spawn in parallel within a Script (one Task message with N spawn calls); serial across Scripts (failure on Script 1 doesn't poison Script 2). Within a Carousel worker, the N card renders are issued in parallel.

### Worker prompt as corpus file

The worker prompt body lives at `corpus/templates/worker-prompts/static-asset.md`. media-production reads it in Step 1 and passes it verbatim to spawned workers. **Iteration on the prompt happens by editing this corpus file** — no agent edits needed, no Claude Code restart needed (corpus is read fresh each turn).

### Worker authors HTML directly (no `frontend-slides` skill)

The `frontend-slides` skill was evaluated and rejected: it hardcodes presentation-deck defaults that actively fight this brand — anti-Inter typography, `100vh` sizing, slide-density spacing. Overriding all of them left almost nothing of the skill. Instead, workers (general-purpose subagents, `Tools: *`) author a self-contained HTML document directly against `corpus/templates/brand-contract.md` — palette, fonts, logo block, output contract, tone→palette mapping, type-size minimums. The worker then renders via `mcp__static-renderer__render_html_to_png`. Design quality is tuned entirely through the brand contract + worker prompt corpus files; if a reusable layout library is wanted later, it would be a new corpus file of HTML partials, not the slides skill.

### Renderer as new MCP server

`mcp-servers/static-renderer/` wraps Playwright headless Chromium. Single tool `render_html_to_png({html, width, height, run_id, variant_id, scene_id, wait_for_charts?}) → {path, sha256, bytes, render_ms}`. Bounded concurrency pool (default 6 simultaneous pages, configurable via `RENDERER_MAX_CONCURRENT`) prevents OOM under parallel load. Output path mirrors the existing `asset-store` convention so downstream code stays unchanged.

### Brand contract as corpus file

`corpus/templates/brand-contract.md` is the visual identity rulebook — locked palette, font CDN URL, logo HTML/CSS, tone→palette emphasis mapping. Extracted verbatim from the actual `engineerdad-site` codebase (single source of truth across web + marketing). Workers read this every render; non-compliance is a hard failure.

### Color tone routing via thumbnailBrief

media-production already authors `thumbnailBrief` per Variant (Step 4b — pre-existing). The brand contract's tone→palette table maps thumbnailBrief tone signals to palette emphasis. Worker reads thumbnailBrief, picks the closest tone, applies the corresponding palette. Strategic call (which tone fits the message) made by orchestrator with full Script context; tactical execution (which CSS rules implement that tone) made by worker.

### Charts — corpus YAMLs, never inline data

Chart YAMLs in `corpus/data/charts/` (3 starters: `compounding-30y`, `dca-vs-lump`, `children-fund-cost`) carry `{labels, series, captions, source_citation}` — but deliberately NO colors (worker picks per Variant tone). Workers embed Chart.js 4.x via CDN, build the config from the YAML. Scene cards gain optional `chartRef` field; worker emits `window.__chartsReady = true` after Chart.js renders so Playwright waits.

### Test harness for worker iteration

`scripts/test-static-worker.mjs` + 5 fixtures bypass the full /produce pipeline. `pnpm run test:worker <fixture-name>` assembles a copy-pasteable `Task()` call; user pastes into a Claude Code conversation, worker runs against the live MCP stack, PNG appears under `data/assets/test-run-<fixture>/`. ~20s feedback loop vs ~5min for /produce.

## Consequences

### Wins

- **$0 runtime API cost** for static assets (Playwright is free, Chart.js is free, Google Fonts CDN is free).
- **100% brand fidelity** — palette, logo, fonts are CSS-deterministic; no model variance.
- **Real charts** — data accuracy guaranteed by corpus YAMLs; no compliance risk.
- **Pattern scales to video** — video phase adds a `video` worker prompt, no change to media-production.
- **Iteration is decoupled** — design quality tweaks happen in `corpus/templates/worker-prompts/static-asset.md` without touching agent definitions or rebuilding anything.

### Trade-offs accepted

- **Per-Variant Task spawn cost** — ~$0.05–0.10 per worker spawn (sonnet-equivalent token spend). For 14 images per /produce run via 6 workers (3 static Variants × 2 Scripts), ~$0.30–0.60/run. Comparable to or slightly above prior Gemini cost; bought brand fidelity + chart support.
- **Wall-time slightly longer** — workers add LLM round-trip latency (~15–30s per worker). Mitigated by parallel spawn within Script.
- **Worker prompt iteration is the new craft** — design quality is now a function of how well the worker prompt is tuned. Test harness exists to make this fast.
- **Local-disk only (still)** — Playwright writes to `data/assets/<run_id>/<variant_id>/<scene>.png`. R2 backend swap remains future work (E-007 #2, narrowed to track this rather than Gemini-related cleanup).

### Forward-compat

- **Gemini static branch deprecated** — Gemini MCP stays installed for future scenarios where an HTML template wants an AI-generated photo background (e.g., `<img src="data:image/png;base64,...">` from a Gemini call as a background image). No code deletion.
- **Custom worker subagent** — using `general-purpose` for now. If the worker prompt becomes large enough that prompt overhead matters, migrate to a custom `.claude/agents/static-asset-worker.md` subagent (additive change, not blocking).
- **Reference designs library** — `corpus/templates/reference-designs/` ships empty; populated organically once the first 2–3 satisfactory outputs land. Then referenced as few-shot exemplars in the worker prompt for stronger design convergence.

### Cross-references

- ADR-013 remains valid for **video** formats (kie.ai abstraction is unchanged). This ADR scopes static formats out of Gemini.
- ADR-012 (Notion rich-text chunking) — `Image Generation Notes` field still uses the existing chunking helper.
- ADR-011 (server-side runId) — orchestrator passes runId in spawn prompts unchanged.
- ADR-010 (bilingual EN/BM) — chart YAMLs include both languages; current iteration renders EN only (per existing E-007 #1 deferral, now narrowed in TASKS.md B-004).

## Status note

ADR-013 is **partially superseded by this ADR**: the static-formats portion of E-004 (Gemini Nano Banana for Feed/Carousel) is no longer the active path. The video-formats portion (kie.ai aggregator, Veo 3, etc.) remains the live spec. ADR-013's provider abstraction shape (modality discriminator, generate_image vs generate_clip interface symmetry) is preserved for future image-vendor swaps.

---

## Amendment (2026-05-21) — worker spawn is non-functional; real fix tracked in E-021

The orchestrator+worker architecture above **does not execute as written.** `media-production` is a subagent, and a subagent cannot spawn another subagent — the `Task` tool in a subagent's frontmatter is non-functional for spawning (confirmed 2026-05-21 in this codebase: `brain` could not spawn `distribution`; the same constraint blocks media-production's Step 5.5 worker loop). In practice media-production direct-renders each scene via `mcp__static-renderer__render_html_to_png` in its own context, and Step 7.0 assertion B then stamps `ok: false` — a standing false failure.

**Interim posture (F9, 2026-05-21):** direct rendering is **accepted as-is**. The agent definitions (`media-production.md`, `brain.md`) are deliberately left unchanged to avoid churn ahead of the real fix. Until that fix lands, treat the Step 5.5 "worker spawn loop", the G11 direct-render prohibition, and Step 7.0 assertion B in `media-production.md` as **known-stale** — they describe an unrunnable path.

**Real fix:** the worker fan-out moves up to the `/produce` slash command — the main Claude Code session, which *can* spawn subagents. The orchestrator+worker *intent* of this ADR (context-budget isolation) is retained; only the actor that spawns the workers changes. Scoped in **TASKS.md E-021** — needs its own spec → plan cycle before any build.
