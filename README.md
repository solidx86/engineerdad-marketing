# EngineerDad Marketing OS

[![CI](https://github.com/solidx86/engineerdad-marketing/actions/workflows/ci.yml/badge.svg)](https://github.com/solidx86/engineerdad-marketing/actions/workflows/ci.yml)

**A closed-loop marketing driver** — a self-optimising, agentic marketing platform built on Claude Code (subagents + slash commands + custom MCP servers), in active production use for [EngineerDad](https://engineerdad.my), a licensed financial-advisory practice serving Malaysian parents.

Each cycle it reads live ad-performance signals, reasons about what worked, writes its own creative briefs, scripts and renders bilingual (EN/BM) ad creatives — image carousels and AI-avatar video Reels — designs the next experiment, and ships. It learns cycle-to-cycle: hypotheses are graded against real results and the confirmed ones become Learnings that feed the next cycle's strategy. **Every external write is human-gated**, and an automated SC-Malaysia / FIMM compliance scanner blocks non-compliant financial content before it can ship.

## The closed loop

```mermaid
flowchart LR
    T[tracking] --> A[analytics] --> S["synthesize<br/><i>brain</i>"] --> B["brief<br/><i>brief-writer</i>"]
    B --> HG1{{"HG1<br/>briefs"}} --> C["content<br/><i>content-writer</i>"]
    C --> HG2{{"HG2<br/>scripts"}} --> P["produce<br/><i>creative-director</i>"]
    P --> HG3{{"HG3<br/>creatives"}} --> SC[schedule] --> E[experiment] --> D[distribute]
    D -. "/reflect — hypotheses graded → Learnings" .-> S
    classDef gate fill:#fff3d6,stroke:#d99a1b,stroke-width:2px,color:#7a5200;
    classDef agent stroke:#0e9e8a,stroke-width:2px;
    class HG1,HG2,HG3 gate
    class S,B,C,P agent
```

One run walks nine stages in fixed order. Outlined stages spawn an agentic cell with genuine decision space; everything else is deterministic code. The three human gates (HG1 briefs · HG2 scripts · HG3 creatives) STOP the loop until a human approves in the review webapp. `/reflect` closes the loop afterward: it grades the cycle's hypotheses and promotes confirmed ones to Learnings for the next run. Full map: [`ARCHITECTURE.md`](./docs/ARCHITECTURE.md) · visual overview: [`docs/architecture.html`](./docs/architecture.html) (served via GitHub Pages once public).

## What's inside

- **7 subsystems, 4 agentic cells** — `brain` (strategy memo), `brief-writer`, `content-writer`, `creative-director`; everything that a verifier *could* check is deterministic code instead (ADR-020).
- **15 custom stdio MCP servers** over typed package libraries — Meta Ads/organic, analytics (bandit allocation, decay curves), BM25 corpus search, HTML→PNG renderer, HeyGen avatar video, R2 asset store, orchestrator state machine.
- **Typed, resumable orchestrator** — a Postgres-backed run-state machine (`plan`/`verify`/`advance`); every run is resumable from any step.
- **RAG grounding without a vector DB** — all generation grounded on a local BM25-indexed compliance + brand corpus; an output scanner enforces banned-phrase and disclosure rules.
- **Human-gate webapp** — Next.js 15 review UI; approvals, posting packs, and asset preview live at every gate.
- **Engineering discipline** — [30 ADRs](./docs/decisions/), 100+ test files (Vitest + Playwright E2E), Drizzle migrations with branch-sandboxed databases, monorepo CI.

## Showcase

Everything below comes from **one loop run on a blank database** (`run_1781193285`) — no seed content, no manual authoring. The committed snapshots under [`data/snapshots/main/`](./data/snapshots/main/) capture the same run at each human gate — whole-DB dumps committed deliberately, so any gate state is restorable and the run's evidence is inspectable, not just claimed.

### What the loop produces

| | | |
|---|---|---|
| ![Carousel cover](./docs/media/creative-carousel-cover.png) | ![Feed chart creative](./docs/media/creative-feed-chart.png) | ![Reel concept frame](./docs/media/creative-reel-frame.png) |
| Carousel cover (4:5) — hook chosen from a 30-hook bank | Feed still — every figure traces to a vetted dataset (ADR-030) | Reel scene frame — concept visuals carry no digits, by enforced rule |

Plus two finished AI-avatar video Reels (HeyGen multi-scene assembly, word-timed captions) and a bilingual authority article delivered as a draft PR to the website repo.

### The human-gated pipeline

**One run, end-to-end.** The run dashboard shows the brain's Decision Memo — its full reasoning trace is preserved, not just the conclusion — and every artifact the run produced beneath it.

![Run dashboard — Decision Memo and artifacts](./docs/media/run-detail.png)

**HG3 — creative review.** Each Creative Variant is reviewed with its rendered asset in place — here a finished AI-avatar Reel — with per-variant approve/reject and an EN/BM toggle. The loop stays stopped until a human acts.

![HG3 — Reel variant review with rendered video](./docs/media/review-variant-reel-hg3.png)

**Meta-paid posting pack.** Paid ads ship as a copy-paste pack — campaign, ad set, bilingual ad copy per creative — for a human to place in Ads Manager. The OS never creates an active ad; activation is structurally human-only.

![Meta-paid posting pack — bilingual ad copy per creative](./docs/media/posting-pack-meta-paid.png)

**IG organic queue.** Instagram won't schedule posts via API, so IG-bound formats land in a manual queue — slides, generated caption with the compliance footer, hashtags, one-click downloads — and a "Mark posted" backfill that ties the live post ID back to the run for the next cycle's analytics.

![IG organic posting pack — caption, hashtags, slide downloads](./docs/media/posting-pack-organic.png)

Not pictured: HG1 (12 message-angle briefs reviewed the same way) and the per-run distribution audit trail (every target × channel decision persisted as `routed`/`skipped` with reason).

## Stack at a glance

TypeScript / Node 20 · pnpm workspaces · Postgres 16 + Drizzle · Next.js 15 · Claude Code (agents, slash commands, MCP) · Meta Marketing API · HeyGen · Cloudflare R2.

## How this was built

Most of the code in this repo was written by AI agents — Claude Code is both the runtime *and* the authoring tool. That is the point, not a disclosure footnote: my engineering is everything that makes agent-written code safe to run unattended against a real, regulated business.

- **The architecture and its doctrine** — the 9-stage state machine, the agentic litmus test (a step is an agent only if a verifier couldn't make its judgement — ADR-020), the no-mesh MCP rule (ADR-005). Recorded as [30 dated ADRs](./docs/decisions/).
- **The verifiers and rails.** Agent output is never trusted: structural verifiers gate every stage (e.g. a creative citing a figure its bound dataset doesn't contain fails verification — nothing "looks right" its way past). Platform adapters are hard-wired fail-safe: ads create PAUSED, videos upload unlisted.
- **The review surface.** Every external write stops at a human gate; the open bug log in [`TASKS.md`](./docs/TASKS.md) is the unedited engineering record — including the failures the verifiers caught.

I designed the system, wrote the doctrine, reviewed the output, and operate the gates. The agents typed most of the code. Knowing how to make that division of labor *safe and productive* is the skill this repo demonstrates.

## License & reuse

Source-available for portfolio/hiring review only — see [`LICENSE`](./LICENSE). All rights reserved — the marketing corpus, brand doctrine, and code are published for reading, not reuse. No license is granted to copy or operate this system.

## Disclaimer

A personal technical portfolio project supporting a licensed consultant's own practice. It is **not affiliated with, endorsed by, or sponsored by Public Mutual Berhad**; "Public Mutual" and related marks belong to their respective owner. Fund figures in the grounding corpus are illustrative — derived from public Monthly Fund Report snapshots for demonstration, they change over time and are **not investment advice**; verify against the current Public Mutual factsheets before any use. Generated marketing creatives are illustrative samples.

---

**Current architecture:** [`ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
**Open work:** [`TASKS.md`](./docs/TASKS.md)  •  **Architectural decisions:** [`docs/decisions/`](./docs/decisions/)

v1 is built end-to-end on Claude Code as the authoring substrate, designed to promote later to the Claude Agent SDK (cron) and Cowork (team) without rewrite.

## Day-1 setup checklist

1. Install Node ≥ 20.10 and enable corepack: `corepack enable`. pnpm 9 is provisioned automatically from `package.json`'s `packageManager` field.
2. Install Docker Desktop — Postgres runs in a container.
3. `cp .env.example .env` — `DATABASE_URL` defaults work for local Docker; fill Meta + YouTube credentials when you reach the distribution stages.
4. `pnpm install`
5. `pnpm -r build` — **sequential**; never `pnpm -r --parallel build` (the parallel form races on `@engineerdad/shared`).
6. `pnpm store:up` — start the Postgres container (`docker compose up -d --wait postgres`).
7. `pnpm db:migrate` — apply the journaled migrations for all three schemas into the local `engineerdad` DB (idempotent; safe to re-run). To run the test suite too, create + migrate the test DB once: `docker exec engineerdad-postgres psql -U engineerdad -d postgres -c 'CREATE DATABASE engineerdad_test'` then `DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test pnpm db:migrate`.
8. `pnpm review` — start the webapp at http://localhost:3030.
9. Drop grounding files into `corpus/compliance/`, `corpus/courses/`, `corpus/proof/`.
10. Restart Claude Code so it picks up `.claude/settings.json` MCP registrations.

## Resuming on another machine

Cloning elsewhere follows the **same steps as Day-1 setup** above, with three differences:

- **Restore `.env` yourself** — it's gitignored, so copy it across (or rebuild from `.env.example`). Optionally bring `.claude/settings.local.json` for your per-machine permission allowlist (also gitignored).
- **The corpus index travels** — `corpus/.index/` **is** committed, so you can skip dropping fresh grounding files (step 9).
- **The data volume doesn't** — `data/postgres/pgdata/` (entity data, orchestrator state, analytics history) is **not** committed, so the clone starts with empty tables; `store:up && db:migrate` (steps 6–7) is the only way in.

## Repo map

```
.claude/                    # Subagents + slash commands + Claude Code settings
apps/
  webapp/                   # Next.js 15 App Router — human-gate UI on port 3030
mcp-servers/                # stdio MCP servers (meta-ads, store, analytics, corpus, experiment, …)
  media-providers/          # v1.5+ video providers (kie.ai, etc.)
packages/
  shared/                   # Zod types, compliance scanner, prompt fragments
  store/                    # Drizzle ORM + postgres.js — canonical data layer
  orchestrator/             # Typed state machine driving the 9-stage loop
corpus/                     # Local grounding material
  compliance/               # SC Malaysia + FIMM + Public Mutual rules
  courses/                  # Fund factsheets, guides, brand voice samples
  proof/                    # Testimonials, screenshots, credentials
  .index/                   # Built by /ingest-corpus (committed)
data/
  postgres/pgdata/          # Postgres data volume (gitignored) — public / orchestrator / analytics schemas
scripts/                    # Bootstrap + maintenance scripts
```

## Workspace scripts

| Command | Purpose |
|---|---|
| `pnpm build` | **Parallel build alias — avoid.** Races on `@engineerdad/shared`; build with `pnpm -r build` (sequential) instead. See CLAUDE.md |
| `pnpm typecheck` | Type-check every workspace package |
| `pnpm lint` / `pnpm lint:fix` | ESLint across the repo |
| `pnpm format` / `pnpm format:check` | Prettier across the repo |
| `pnpm test` | Vitest across the repo |
| `pnpm test:e2e` | Playwright E2E for the webapp |
| `pnpm store:up` / `:down` | Start / stop the Postgres container |
| `pnpm db:migrate` | Apply journaled Drizzle migrations (store + orchestrator + analytics) to `DATABASE_URL` (defaults to local `engineerdad`) |
| `pnpm store:wipe` | Drop the data volume and reset (cold-start scenario) |
| `pnpm review` | Start the webapp dev server on port 3030 |

## Stack

TypeScript / Node 20 / pnpm 9 workspaces. Postgres 16-alpine in Docker — one DB, three schemas (`public` entities, `orchestrator` run state, `analytics` signals/bandit) via Drizzle ORM end-to-end (ADR-025). Next.js 15 App Router + server actions for the webapp. Meta Marketing API is the primary paid-channel integration, alongside HeyGen (avatar video), YouTube, Cloudflare R2, and a cross-repo site handoff. Bilingual EN / Bahasa Malaysia on every artifact. Humans gate every external write.
