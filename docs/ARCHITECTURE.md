# ARCHITECTURE.md

The current architecture of the EngineerDad Marketing OS — a navigational
snapshot of the system **as built**. Doctrine and the *why* behind each
decision live in `docs/decisions/` (the ADRs); this file is the map.

## What this is

A closed-loop marketing OS for EngineerDad — Shoo Kyuk Wei's Public Mutual unit
trust + PRS consultancy targeting Malaysian parents. It plans, produces, and
ships paid + organic marketing, learns from the results, and compounds. The
authoring substrate is Claude Code itself: slash commands, subagents, and MCP
servers. **Every external write is human-gated through the webapp at
http://localhost:3030.**

## The closed loop

One run walks nine stages in a fixed order. Three human gates punctuate it; the
loop STOPs at each until a human approves in the webapp.

```
tracking → analytics → synthesize → brief →[HG1]→ content →[HG2]→
produce →[HG3]→ schedule → experiment → distribute
```

`/reflect` closes the loop afterward — it grades the prior cycle's Hypotheses
and promotes the confirmed ones to Learnings, which feed the next run's
`synthesize`.

| Stage | Kind | What it does | Gate |
|---|---|---|---|
| `tracking` | deterministic | Validate the Meta CAPI path — sandbox canary + one synthetic Lead. A verify-fail STOPs the loop. | — |
| `analytics` | deterministic | Pull Meta insights into Postgres (analytics schema); rank creatives; cost-per-angle; decay curves. | — |
| `synthesize` | agentic cell | Spawn `brain` — the 9-step reasoning scaffold → the Decision Memo. | — |
| `brief` | agentic cell | Spawn `brief-writer` — the Memo's angles → 12 message-based Briefs. | HG1 |
| `content` | agentic cell | Spawn `content-writer` — approved Briefs → hook banks, scripts, AEO/GEO articles. | HG2 |
| `produce` | agentic cell + det. | Spawn `creative-director` (the creative plan), fan out render workers, derive per-channel specs, persist Creative Variants. | HG3 |
| `schedule` | deterministic | Assign organic publish slots + paid flight windows (`assignSchedule`); stamp `Scheduled For`. | — |
| `experiment` | deterministic | Design a factorial experiment from approved Variants; 70/20/10 allocation. | — |
| `distribute` | deterministic | Route approved content to its platforms — YouTube (unlisted), engineerdad-site articles (draft branch). Meta-paid: manual posting pack (webapp) when `META_PAID_MODE=manual` (the default); the `api` path creates ads PAUSED. | — |

The human gates: **HG1** Briefs approved · **HG2** Scripts approved · **HG3**
Creative Variants approved. Distribute is terminal with no gate (ADR-015
amendment): under the default `META_PAID_MODE=manual` the Meta-paid ads are
created — and later activated — by hand in Meta Ads Manager from the webapp
posting pack, so there is no API spend to gate. Activation stays human-only
(the OS never sets `ACTIVE`).

## Three layers, one direction

- **`.claude/commands/*.md`** — the runtime entry points. `/loop` is the
  domain-agnostic conductor; `/status` the run dashboard. The granular commands
  are scoped delegators / escape hatches (see *Command surface* below).
- **`.claude/agents/*.md`** — the four agentic cells: `brain`, `brief-writer`,
  `content-writer`, `creative-director`. Each is spawned by a stage; each has
  genuine open decision space. Nothing else is an agent.
- **`packages/` + `mcp-servers/`** — the deterministic substrate. Pure logic in
  `packages/`; thin stdio MCP adapters in `mcp-servers/`.

The conductor (`/loop`) talks to two surfaces only — `mcp__orchestrator__*`
and Claude Code's built-in `Task`. Cross-MCP work is initiated either by the
orchestrator MCP itself (via library imports of `packages/<name>` — see
ADR-023) or by the workers it spawns (which open their own MCP access scoped
to their `allowed-tools`). The conductor never reaches across MCP servers
itself; the orchestrator is its only mechanical surface.

The agentic litmus test (ADR-020): a step is an agent only if a verifier could
not make its judgement. Everything else is code.

## The orchestrator

`packages/orchestrator` is the typed run-state machine — the spine of the loop.

- **`plan(runId?, args?)`** — returns `{ runId, step }`, the next concrete
  `Step` for the conductor. A pure function of persisted run state, so a run is
  resumable and `plan` is safe to re-call. Mints a new run when `runId` is absent.
- **`verify(runId, stepId, result)`** — runs a step's acceptance test against a
  worker result → `{ ok, problems }`.
- **`advance(runId, stepId, result)`** — marks a step done and rolls the stage
  forward when its last step completes.
- **`Step`** is a discriminated union on `kind`. The engine has six kinds
  internally — `spawn | fanout | write | gate | done | halt` — but per
  ADR-023 the orchestrator MCP self-executes `write` steps and gates with
  an automated `check` inside its `plan()` handler. The conductor therefore
  only ever sees four conductor-visible kinds: `spawn | fanout | gate
  (terminal — check stripped if the check failed) | done | halt`. For
  conductor-visible kinds verify and advance are separate operations (the
  conductor calls each in turn); for engine-internal kinds the orchestrator
  folds verify into advance behind the MCP boundary.
- **`StageDefinition`** = `{ id, steps: StepSpec[] }`. One file per stage in
  `src/stages/`; one verifier per step in `src/verifiers/`.
- **`LIVE_REGISTRY`** (`src/registry.ts`) — the ordered nine stages above.
  `FIXTURE_REGISTRY` keeps a fixture stage for the engine unit tests.

`mcp-servers/orchestrator` is a thin stdio wrapper exposing `plan` / `verify` /
`advance` / `status` / `write_step_result` / `read_step_result` — no domain
logic of its own (ADR-005 thin-adapter doctrine). Its `plan()` handler
imports `executeWriteStep` + `executeCheck` from `@engineerdad/orchestrator`
to drive the eager-execute loop per ADR-023.

## Storage

One Postgres database, three schemas, plus a committed BM25 index:

- **`engineerdad` Postgres database** (containerised; volume at
  `./data/postgres/pgdata/`, gitignored) — one DB, three schemas:
  - `public` — the 8 entity tables (`briefs`, `scripts`, `authority_articles`,
    `creative_variants`, `experiments`, `performance_reports`, `hypotheses`,
    `learnings`). Schema in `packages/store/src/schema.ts`.
  - `orchestrator` — `runs`, `run_steps`, and `step_results` (the claim-check
    substrate from ADR-022 — JSONB payload + size_bytes audit). Schema in
    `packages/orchestrator/src/schema.ts` (Drizzle).
  - `analytics` — `events` audit trail, Meta insights, creatives, angle tags,
    bandit signals. Schema in `packages/analytics/src/schema.ts` (Drizzle).
  All three schemas are applied via Drizzle Kit migrations through one aggregate
  command: `pnpm db:migrate` (applies the store + orchestrator + analytics
  journaled migrations to the `DATABASE_URL` database; defaults to the local
  `engineerdad`). Clean-slate reset:
  `pnpm store:wipe && pnpm store:up && pnpm db:migrate`.
  See **ADR-025** (Postgres-only) for the decision history — E-034 retired the
  prior SQLite substrate for analytics + orchestrator state.
- **`corpus/.index/`** — the BM25 index + `chunks.jsonl` over `/corpus`. Committed.

## Corpus structure

Four content scopes, all indexed via `/ingest-corpus`:

- **`compliance/`** — regulatory disclaimers from Malaysian regulators (SC, FIMM, Public Mutual). Sentinel-phrase blocks checked at ad creative write time (ADR-015).
- **`courses/`** — educational content node library for AEO/GEO articles (Authority Entity Outcome / Goal Entity Outcome).
- **`proof/`** — testimonials and success artifacts keyed by `persona`.
- **`knowledge/`** — technical domain knowledge artifacts (PMB mechanics, tax/PRS, portfolio construction). Frontmatter-tagged by `cluster`, `granularity`, `source_type`. See ADR-031.

## Human-gate substrate

The three human gates (HG1 Brief, HG2 Content, HG3 Produce) are reviewed in
`apps/webapp` at http://localhost:3030. The webapp is a single-user Next.js 15
App Router app with server actions over `packages/store`. Approvals flip an
entity row's `approvalStatus` via a server action; the orchestrator's gate-check
steps poll the store for the approved count. Distribute has no gate (ADR-015
amendment); the webapp instead serves the per-run manual posting packs at
`/posting-pack/<runId>` (Meta-paid) and `/posting-pack/organic/<runId>` (IG),
where the operator records the ad / post IDs they created by hand.

## Postgres entities — eight tables

`briefs`, `scripts`, `authority_articles`, `creative_variants`, `experiments`,
`performance_reports`, `hypotheses`, `learnings`. Schemas in
`packages/store/src/schema.ts` as Drizzle `pgTable` definitions. The compliance
scan (`packages/shared/src/compliance.ts`) fires at the store-package write
boundary (`packages/store/src/crud.ts`) on the four content entities — the
single auditable choke point, layer-aware rather than transport-aware (so both
MCP writes and webapp server-action writes pass through the same gate).

## MCP servers

Fifteen stdio servers (`.mcp.json`): `orchestrator` (the state machine),
`distribute` (Meta-paid manual posting pack — `get_posting_pack` + `backfill_meta_ids`),
`store` (the 8 entities + compliance scan), `analytics` (Postgres signals + bandit),
`corpus` (BM25 search + compliance blocks), `meta-ads` (paid ads — writes hard-
wired PAUSED), `meta-organic` (FB/IG organic publish — schedule-only), `experiment`
(factorial design + readout), `youtube` (video upload — unlisted), `asset-store`
(asset upload + CDN), `static-renderer` (HTML → PNG), `heygen` (HeyGen avatar
video generation + status polling — wraps the v2 generate / v1 status APIs),
`media-providers-gemini` (image generation), `media-providers-kie-ai` (video
clips — **dormant** as of 2026-05-29; the Reel pipeline ADR-028 rescope to
HeyGen-native multi-scene assembly retired the kie.ai / Veo 3 dependency), and the
cross-repo `engineerdad_site` (article draft handoff).

Six of eight domain servers are now thin stdio adapters over sibling
`packages/<name>/` libraries: `store`, `analytics`, `corpus`, `meta-ads`,
`experiment`, `distribute`. The orchestrator MCP imports these libraries directly in-process
for write-step execution (ADR-023); the stdio servers continue to expose tools
to outside callers (the Claude Code main session, future scheduled runners,
debugging clients). `youtube` and `heygen` remain unextracted — filed as
follow-ups; their write steps don't currently run inside the eager-execute
loop and instead go through the conductor via the legacy MCP-call path.

Per ADR-005 / ADR-020: no MCP server opens a client to another MCP server.
Shared *logic* lives in `packages/`; cross-server *sequencing* goes through the
hub — the `/loop` conductor + the orchestrator. Per ADR-023: inside the
workspace, prefer library imports over MCP stdio calls. The orchestrator
MCP's in-process imports of `packages/<name>` are not mesh edges; they are
same-process library calls, and they replace what would otherwise be
conductor-driven cross-MCP transmission.

## Media production

P2-render fans out to two distinct worker toolchains depending on the
CreativeUnit's format:

- **Static path (Feed, Carousel)** — the existing render-worker
  (`corpus/templates/worker-prompts/render-worker.md`). Composes HTML from
  brand-contract templates; renders to PNG via the `static-renderer` MCP
  (Playwright + Chromium); uploads via `asset-store`. One spawn per
  CreativeUnit; Carousel emits two aspects per spawn. Patterns off the 4:5
  exemplars in `reference-designs/static/` (named by visual primitive, not post
  type — Feed + Carousel share the worker).

- **Reel 9:16 path (HeyGen-native pipeline)** — added 2026-05-29 per ADR-028
  (`docs/decisions/028-heygen-native-scene-assembly.md`); refined 2026-05-30
  per ADR-029 (`docs/decisions/029-reel-visual-scenes.md`). The orchestrator's
  `P1a-reels-prepare` write step pre-creates skeleton CreativeVariants rows so
  the worker has a row to update during Step 4a (orphan recovery for the
  `exec.ts:92` scar). The `reel-render-worker`
  (`corpus/templates/worker-prompts/reel-render-worker.md`) renders chart and
  visual frames via `static-renderer` (sharing the `buildChartConfig` recipe
  and the `worker-prompts/_chart-rules.md` doctrine partial with the static
  worker), uploads them to HeyGen (`upload_asset`), then issues
  a single `generate_reel` call — HeyGen concatenates scenes server-side and
  returns one finished MP4. `caption:true` produces a word-timed SRT sidecar.
  There is no local stitching, no ffmpeg, no whisper. P3-persist UPDATEs the
  pre-created Reel row (`fillOnlyIfEmpty: true` preserves the worker's writes).
  Gated by `EDOS_REEL_PIPELINE`. YT-Long 16:9 + YT-Short 9:16 are filed as
  E-004a/E-004b.
  Scene `sceneType` enum (ADR-029): **`face | visual`** —
  `face-over-chart` and `chart` are retired. `visual` (data) = library-grounded
  data chart from `corpus/data/charts/*.yaml` (`chartRef` non-null); `visual`
  (concept) = free-form concept visual (no numbers on-frame — HARD RULE,
  `visualBrief` non-null). Up to 3 visual scenes per reel; must open + close
  with `face`. VO budget: ≤30 words (face), ≤45 words (visual). A frames-only
  dev harness (`pnpm test:reel-frames <fixture>`) renders visual frames without
  HeyGen. Reference designs for 9:16 reels live under
  `corpus/templates/reference-designs/reel/` (the sibling `static/` set holds the
  4:5 Feed exemplars).
- **Data-first claim binding (ADR-030).** Two-layer data model:
  `corpus/data/datasets/*.json` are the source-of-record facts (provenance-rich);
  `corpus/data/charts/*.yaml` are derived bilingual captioned visualizations,
  each citing its upstream dataset (`source_citation`). A quantitative claim
  ships a chart only if a vetted dataset depicts it. The binding chain:
  **content-writer** authors a `claimBindings` entry per claim
  (`data | qualitative | gap`) on the Script and picks the chart via
  `corpus.list_charts`; **HG2** reviews each claim with its bound chart (or a
  ⛔ gap badge — gap scripts are *held* while siblings flow); the
  **creative-director** executes the bindings (never re-picks a chart); the
  **C1** (`verify-content`) and **P1** (`verify-produce`) verifiers enforce that
  every `chartRef` is a real `data` binding whose figures trace to the chart and
  that concept visuals carry no digits (folds in B-036). Gaps are filled
  out-of-loop by the human-invoked `/chart-gap` → `chart-author` utility
  (ingest source → dataset JSON → chart YAML → promote → re-bind). Charts and
  datasets are read by path, never BM25-indexed.

Both paths converge on the same `CreativeVariants.assetFiles[0].url`
contract that the distribute stage consumes — no downstream branching by
modality is needed.

## Command surface

- **`/loop`** — the conductor. Calls `plan` → if the returned step is
  `spawn`/`fanout`, dispatches workers via `Task` and passes the resulting
  claim-check refs (ADR-022) to `verify` + `advance`; if the step is a
  terminal `gate`, `done`, or `halt`, prints the message and stops. Write
  steps and gate-checks never surface — they run inside `plan()` per
  ADR-023.
- **`/status`** — the read-only run dashboard.
- **Loop-stage delegators** — `/loop-once`, `/brief` (start a run);
  `/content`, `/produce`, `/experiment`, `/distribute` (resume a run by
  `--run=<id>`). Each drives `loop.md`'s procedure scoped to its stage; no
  conductor logic is duplicated.
- **Off-loop** — `/analyze` and `/reflect` spawn `brain` for off-loop reasoning
  (analytics summary; the §B-step-2 Reflect procedure). `/brain` is a generic
  `brain` spawn.
- **Utility** — `/ingest-corpus` re-indexes `/corpus`; `/posting-pack` rebuilds
  the IG manual-posting pack (a B-005 throwaway aid — IG has no scheduled-publish
  API, ADR-019; retired when E-024 ships).

## The four agentic cells

| Agent | Spawned by | Produces |
|---|---|---|
| `brain` | `synthesize` | The 9-step reasoning scaffold → the Decision Memo + Hypotheses |
| `brief-writer` | `brief` | 12 message-based Briefs from the Memo's angles |
| `content-writer` | `content` | Hook banks, scripts, AEO/GEO authority articles |
| `creative-director` | `produce` | The creative plan — storyboard, hook register, thumbnail brief (taste only) |

## Where doctrine lives

`docs/decisions/` — 30 ADRs. The load-bearing ones: **ADR-020** (this
architecture — the orchestrator state machine + agentic cells), **ADR-005**
(MCP thin-adapter + no-MCP-mesh), **ADR-010** (bilingual EN/BM only),
**ADR-015** (write-API safety — PAUSED / unlisted hard-wired), **ADR-014 +
ADR-016** (the render-vs-handoff carve-out), **ADR-018** (spec-build vs
routing), **ADR-022** (claim-check / reference-based messaging for worker
output), **ADR-023** (orchestrator-resident execution — the conductor as
reasoning surface, not transmission or execution), **ADR-028** (HeyGen-native
multi-scene reel assembly), **ADR-029** (reel two-type visual scene model —
`face | visual`), **ADR-030** (data-first claim binding — quantitative claims
are bound to vetted data at the content-writer, reviewed at HG2, executed by
the creative-director, and enforced by the C1 + P1 verifiers). Regulatory
ground truth:
`corpus/compliance/{sc-malaysia,fimm,public-mutual}.md`.

## Build / dev

`CLAUDE.md` carries the non-obvious commands. The essentials: `pnpm -r build`
**sequentially** (the parallel form races on `@engineerdad/shared`);
`pnpm test` (vitest across the repo); `pnpm sync:agents` after editing any
prompt fragment in `packages/shared/src/prompts/`.
