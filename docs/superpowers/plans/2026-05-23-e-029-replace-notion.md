# E-029 — Replace Notion with local store + review UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire Notion as the OS's data + human-gate substrate. Ship a typed Postgres store (`packages/store`) running in a Docker container, a cap-honouring MCP wrapper (`mcp-servers/store`), and a single-user Next.js review UI (`apps/review-ui`) so a fresh `/loop-once` walks cold-start to HG3 without any tool result approaching the MCP wire cap.

**Architecture:** Drizzle ORM (`pgTable`) over `postgres.js` against a Postgres 16-alpine container; bind-mount data volume to `./data/postgres/` (gitignored). Five-tool MCP surface (`query` returns IDs only, `get` per row, `create`/`update`/`set_status`) so bulk content never crosses the conductor boundary; Next.js 15 App Router with server actions over the same `packages/store` library. Compliance scanner moves from the Notion MCP handler into `packages/store/src/crud.ts` so both worker writes and UI writes go through one boundary. Orchestrator run-state (`runs`/`run_steps`) stays in `data/engineerdad.sqlite` — two stores side-by-side, each fit for purpose.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Playwright, Drizzle ORM, Drizzle Kit, postgres.js, Docker compose, Postgres 16-alpine, Next.js 15 (App Router + server actions), Tailwind CSS, react-markdown.

**Spec:** `docs/superpowers/specs/2026-05-23-e-029-replace-notion-design.html`
**Doctrine:** `docs/decisions/021-local-store-supersedes-notion.md`

**Pinned forks (from spec §15 + 2026-05-23 user direction):** Postgres 16-alpine in Docker compose, port 5432 (localhost-only), port 3030 for review UI (localhost-only), textarea + react-markdown preview, `pnpm store:up && pnpm store:push` for setup, `pnpm review` to start the UI, postgres.js client, Drizzle + Drizzle Kit. **No per-feature migrations** at v1 — `drizzle-kit push` against the live container. **Data outside git** — `data/postgres/` is gitignored; clone starts empty; cold-start is the only way in. **Vitest + Playwright** for review-ui — Playwright drives every UIUX-touching surface as a real-browser test against `engineerdad_test` DB.

> **Task 1 retro note.** Task 1 shipped as a SQLite scaffold (commit `380f70e`) per the pre-pivot plan: `better-sqlite3`, `drizzle-orm/better-sqlite3`, `dialect: "sqlite"`. **Task 2 (the substrate switch below) replaces those deps and rewrites `db.ts` + `drizzle.config.ts` to Postgres.** The Task 1 work is not wasted — the `package.json`, `tsconfig.json`, and workspace registration carry over; only the dialect-specific files change.

---

## Phase A — `packages/store` (the data layer)

## Task 1: Scaffold `packages/store`

**Files:**
- Create: `packages/store/package.json`
- Create: `packages/store/tsconfig.json`
- Create: `packages/store/drizzle.config.ts`
- Create: `packages/store/src/db.ts`
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Create `packages/store/package.json`**

```json
{
  "name": "@engineerdad/store",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./schema": {
      "types": "./dist/schema.d.ts",
      "import": "./dist/schema.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "push": "drizzle-kit push"
  },
  "dependencies": {
    "@engineerdad/shared": "workspace:*",
    "better-sqlite3": "^11.5.0",
    "drizzle-orm": "^0.36.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "drizzle-kit": "^0.28.0"
  }
}
```

- [ ] **Step 2: Create `packages/store/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/store/drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./src/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: "../../data/engineerdad.sqlite",
  },
});
```

- [ ] **Step 4: Create `packages/store/src/db.ts`**

```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

const DB_PATH = process.env.STORE_DB_PATH ?? "data/engineerdad.sqlite";

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
```

- [ ] **Step 5: Register the new package in workspace**

Edit `pnpm-workspace.yaml`. The file currently lists `packages/*` and `mcp-servers/*` — confirm `packages/store` is included by the `packages/*` glob (it should be automatically). Also add `apps/*` for the review UI to come.

```yaml
packages:
  - "packages/*"
  - "mcp-servers/*"
  - "mcp-servers/media-providers/*"
  - "apps/*"
```

- [ ] **Step 6: Install dependencies**

Run: `pnpm install`
Expected: `+ @engineerdad/store@0.1.0` in the install log.

- [ ] **Step 7: Smoke-build**

Run: `pnpm --filter @engineerdad/store build`
Expected: a `tsc` error because `src/schema.ts` doesn't exist yet. That's fine — Task 2 creates it. Confirms the scaffold is wired.

- [ ] **Step 8: Commit**

```bash
git add packages/store pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(store): scaffold packages/store — drizzle + better-sqlite3

E-029 — foundation. Establishes the local-store package with
Drizzle ORM, better-sqlite3, and the WAL+FK pragmas. Schema and
migrations land in Task 2 and Task 3."
```

---

## Task 2: Switch foundation to Postgres + Docker compose

**Files:**
- Modify: `packages/store/package.json` (swap `better-sqlite3` → `postgres`)
- Rewrite: `packages/store/src/db.ts` (`postgres.js` client + Drizzle PG adapter)
- Rewrite: `packages/store/drizzle.config.ts` (dialect: `postgresql`)
- Create: `docker-compose.yml` (repo root)
- Create: `scripts/postgres-init/01-create-test-db.sql`
- Modify/create: `.env.example`, `.env`
- Modify: `.gitignore` (add `data/postgres/`)
- Create: `data/postgres/.gitkeep`
- Modify: root `package.json` (add `store:up/down/wipe/push/logs`)

**Why this lands as Task 2.** Task 1 shipped a SQLite-shaped scaffold (per the pre-pivot plan). This task is the actual substrate switch. The schema port (now Task 3) needs `db.ts` to already use the Postgres adapter before it can compile — `pgTable` cannot resolve against a `drizzle-orm/better-sqlite3` import.

**As-shipped note (commit `4f089fb`).** The literal "mount `./data/postgres/` AND commit `data/postgres/.gitkeep`" instructions below are mutually incompatible — Postgres 16's `initdb` refuses to bootstrap into a non-empty data dir, including one holding only `.gitkeep`. The implementer (correctly) resolved this by mounting a `pgdata/` subdirectory: bind-mount is `./data/postgres/pgdata:/var/lib/postgresql/data`, gitignore rule is `data/postgres/*` (with the `!data/postgres/.gitkeep` negation), `store:wipe` removes only the `pgdata/` subdir. The `./data/postgres/` parent remains the repo-side data location — `pgdata/` is the Postgres-owned subdir inside it. Code blocks below reflect the as-shipped form.

- [ ] **Step 1: Swap `packages/store/package.json` dependencies**

Replace the file's content with:

```json
{
  "name": "@engineerdad/store",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./schema": { "types": "./dist/schema.d.ts", "import": "./dist/schema.js" }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test vitest run",
    "push": "drizzle-kit push"
  },
  "dependencies": {
    "@engineerdad/shared": "workspace:*",
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.5"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.0"
  }
}
```

Run: `pnpm install`
Expected: `better-sqlite3` + `@types/better-sqlite3` + `tsx` removed; `postgres` added. No native compilation.

- [ ] **Step 2: Rewrite `packages/store/src/db.ts`**

```ts
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const DATABASE_URL = process.env.DATABASE_URL
  ?? "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad";

const queryClient = postgres(DATABASE_URL, { max: 10 });
export const db = drizzle(queryClient, { schema });
export type DB = typeof db;
```

- [ ] **Step 3: Rewrite `packages/store/drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

const DATABASE_URL = process.env.DATABASE_URL
  ?? "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad";

export default defineConfig({
  schema: "./src/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: DATABASE_URL },
});
```

- [ ] **Step 4: Create `docker-compose.yml` at repo root**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: engineerdad-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: engineerdad
      POSTGRES_PASSWORD: engineerdad
      POSTGRES_DB: engineerdad
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - ./data/postgres/pgdata:/var/lib/postgresql/data
      - ./scripts/postgres-init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U engineerdad"]
      interval: 5s
      timeout: 5s
      retries: 10
```

- [ ] **Step 5: Create `scripts/postgres-init/01-create-test-db.sql`**

```sql
CREATE DATABASE engineerdad_test;
GRANT ALL PRIVILEGES ON DATABASE engineerdad_test TO engineerdad;
```

The init scripts run once on first container creation (when `data/postgres/pgdata/` is empty or absent).

- [ ] **Step 6: Update `.env.example` and create `.env`**

Append to `.env.example`:

```
# Postgres (E-029)
DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad
DATABASE_URL_TEST=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test
```

Then `cp .env.example .env` (`.env` is gitignored).

- [ ] **Step 7: Update `.gitignore`**

Add to the root `.gitignore`:

```
# E-029 — Postgres data volume lives in the repo but is not tracked
data/postgres/*
!data/postgres/.gitkeep
```

Create the placeholder so the directory exists on clone: `mkdir -p data/postgres && touch data/postgres/.gitkeep`.

- [ ] **Step 8: Add root scripts**

In root `package.json` `scripts`:

```json
{
  "store:up": "docker compose up -d postgres",
  "store:down": "docker compose down",
  "store:wipe": "docker compose down -v && rm -rf data/postgres/pgdata",
  "store:push": "pnpm --filter @engineerdad/store push",
  "store:logs": "docker compose logs -f postgres"
}
```

Drop any `migrate:*` scripts left over from the pre-pivot plan (none should remain after Task 15 retires Notion).

- [ ] **Step 9: Bring up the container**

Run: `pnpm store:up`
Expected: `Container engineerdad-postgres  Started`. Healthcheck reaches `healthy` within ~10 seconds.

Verify:
```bash
docker compose ps                                                                      # state: healthy
psql postgresql://engineerdad:engineerdad@localhost:5432/engineerdad -c "\l" | grep engineerdad
```

Expected: both `engineerdad` and `engineerdad_test` databases listed.

- [ ] **Step 10: Smoke-build**

Run: `pnpm --filter @engineerdad/store build`
Expected: `tsc` error about missing `./schema.js` import — Task 3 creates it. Same expected-fail shape as Task 1 Step 7. Confirms the Postgres adapter is wired.

- [ ] **Step 11: Commit**

```bash
git add packages/store/package.json packages/store/src/db.ts packages/store/drizzle.config.ts \
        docker-compose.yml scripts/postgres-init/ .env.example .gitignore \
        data/postgres/.gitkeep package.json pnpm-lock.yaml
git commit -m "feat(store): switch foundation to Postgres + Docker compose

E-029 — per 2026-05-23 user direction. Swap better-sqlite3 → postgres.js,
SQLite dialect → postgresql. Postgres 16-alpine in docker-compose.yml
(localhost-only, bind-mounted to ./data/postgres/, gitignored). Init
script creates engineerdad_test database for Playwright. Root scripts:
store:up/down/wipe/push/logs. Cold-start path: pnpm store:up && pnpm
store:push."
```

---

## Task 3: Port 8 entity schemas to Drizzle (`pgTable`)

**Files:**
- Create: `packages/store/src/schema.ts`

Source-of-truth is `packages/notion-bootstrap/src/schemas.ts`. Notion → Postgres shape changes:
- `{ select: { options: [...] } }` → `text` column; const array of legal values; validation in CRUD layer
- `{ multi_select: ... }` → `jsonb` array column (indexable by element via `?` / `?|` / `?&`)
- `{ rich_text: ... }` → `text` (no length cap; ADR-012 is dead)
- `{ files: ... }` → `jsonb` (array of `{ url, sha256 }`)
- `{ date: ... }` → `timestamp({ withTimezone: true })`
- `{ relation: ... }` → text column holding the target id (single-target) or `jsonb` array of ids (multi-target)
- id → `uuid` column with `gen_random_uuid()`

- [ ] **Step 1: Write the full schema file**

Create `packages/store/src/schema.ts`:

```ts
import { pgTable, text, integer, real, jsonb, uuid, timestamp, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── Enum value lists (mirror schemas.ts) ─────────────────────────────────

export const APPROVAL_STATUS = [
  "Draft", "Awaiting Approval", "Approved", "Rejected",
  "Published", "Generation Failed — Review",
] as const;

export const CREATED_BY = [
  "Brain", "Targeting", "ContentGen", "MediaProd",
  "XOS", "Tracking", "Analytics", "Human",
] as const;

export const PERSONA = [
  "engineer_dad_archetype", "young_parents_25_35", "established_parents_35_45",
  "single_income_conservative", "dual_income_growth", "pre_retirement_prs_focus",
  "business_owner_self_employed", "salaried_professional_top_up",
] as const;

export const SCRIPT_FORMAT = ["Reel", "Feed", "Carousel", "YT-Long", "YT-Short"] as const;
export const ASPECT = ["9:16", "1:1", "16:9", "4:5"] as const;
export const PROOF_TYPE = ["data", "testimonial", "case_study", "screenshot"] as const;
export const FUNNEL_STAGE = ["TOFU", "MOFU", "BOFU"] as const;
export const BUDGET_BUCKET = ["70", "20", "10"] as const;
export const AEO_SCHEMA = ["FAQ", "HowTo", "Article"] as const;
export const ARTICLE_CHANNEL = ["Blog", "Medium", "LinkedIn", "YouTube-description"] as const;
export const PRIMARY_METRIC = ["cpa", "hook_rate", "thumbstop", "ctr"] as const;
export const EXPERIMENT_STATUS = ["Designed", "Running", "Concluded"] as const;
export const TEST_TYPE = ["factorial", "single-ad"] as const;
export const LAUNCH_WINDOW = ["24h", "7d", "open"] as const;
export const CHANNELS = [
  "Meta-paid", "YT", "Blog", "Medium", "LinkedIn", "IG-organic", "FB-organic",
] as const;
export const META_CTA_TYPE = [
  "LEARN_MORE", "DOWNLOAD", "SIGN_UP", "GET_QUOTE", "BOOK_TRAVEL", "CONTACT_US",
] as const;
export const YT_CATEGORY = [
  "Education", "People & Blogs", "Howto & Style", "Entertainment", "News & Politics",
] as const;
export const ORGANIC_LANGUAGE = ["en", "ms"] as const;
export const ORGANIC_STATUS = ["Draft", "Awaiting Approval", "Approved", "Posted", "Rejected"] as const;
export const PERF_WINDOW = ["7d", "14d", "30d"] as const;
export const HYPOTHESIS_STATUS = ["Pending", "Confirmed", "Refuted", "Inconclusive"] as const;
export const DOMAIN = ["copy", "creative", "audience", "offer", "media", "channel"] as const;
export const HYPOTHESIS_CHANNEL = ["paid", "organic", "both"] as const;
export const LEARNING_CONFIDENCE = ["Low", "Medium", "High"] as const;
export const LEARNING_STATUS = ["Active", "Aging", "Stale"] as const;

// ── Helper: base columns every entity shares ─────────────────────────────

const baseColumns = () => ({
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  titleBm: text("title_bm"),
  approvalStatus: text("approval_status").notNull().default("Draft"),
  approver: text("approver"),
  createdBy: text("created_by").notNull(),
  runId: text("run_id").notNull(),
  complianceCheck: boolean("compliance_check").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Entity tables ────────────────────────────────────────────────────────

export const briefs = pgTable("briefs", {
  ...baseColumns(),
  persona: text("persona"),
  angle: text("angle"),
  promise: text("promise"),
  proofType: jsonb("proof_type").$type<string[]>(),
  funnelStage: text("funnel_stage"),
  bodyEn: text("body_en"),
  bodyBm: text("body_bm"),
  sourceInsights: text("source_insights"),
  budgetBucket: text("budget_bucket"),
  linkedHypotheses: jsonb("linked_hypotheses").$type<string[]>(),
});

export const scripts = pgTable("scripts", {
  ...baseColumns(),
  brief: text("brief"),                                          // FK → briefs.id
  format: text("format"),
  funnelStage: text("funnel_stage"),
  proofRefs: jsonb("proof_refs").$type<string[]>(),
  hookEn: text("hook_en"),
  hookBm: text("hook_bm"),
  scriptEn: text("script_en"),
  scriptBm: text("script_bm"),
  durationSec: integer("duration_sec"),
  ctaEn: text("cta_en"),
  ctaBm: text("cta_bm"),
});

export const authorityArticles = pgTable("authority_articles", {
  ...baseColumns(),
  topic: text("topic"),
  targetQuery: text("target_query"),
  bodyEn: text("body_en"),
  bodyBm: text("body_bm"),
  faqEn: text("faq_en"),
  faqBm: text("faq_bm"),
  citations: text("citations"),
  aeoSchema: text("aeo_schema"),
  targetChannels: jsonb("target_channels").$type<string[]>(),
  slug: text("slug"),
  description: text("description"),
  readingTime: text("reading_time"),
  keywords: jsonb("keywords").$type<string[]>(),
  ogImageUrl: text("og_image_url"),
  heroImageUrl: text("hero_image_url"),
  heroImageAlt: text("hero_image_alt"),
  relatedSlugs: jsonb("related_slugs").$type<string[]>(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  deliveredTo: text("delivered_to"),
  prUrlEn: text("pr_url_en"),
  prUrlBm: text("pr_url_bm"),
  topicTag: text("topic_tag"),
});

export const creativeVariants = pgTable("creative_variants", {
  ...baseColumns(),
  script: text("script"),                                        // FK → scripts.id
  format: text("format"),
  aspect: text("aspect"),
  shotlistEn: text("shotlist_en"),
  shotlistBm: text("shotlist_bm"),
  thumbnailBrief: text("thumbnail_brief"),
  estimatedCostMyr: real("estimated_cost_myr"),
  assetFiles: jsonb("asset_files").$type<{ url: string; sha256: string }[]>(),
  imageGenerationNotes: text("image_generation_notes"),
  adId: text("ad_id"),
  channels: jsonb("channels").$type<string[]>(),
  ytTitle: text("yt_title"),
  ytDescription: text("yt_description"),
  ytTags: jsonb("yt_tags").$type<string[]>(),
  ytCategory: text("yt_category"),
  ytVideoId: text("yt_video_id"),
  metaPrimaryTextEn: text("meta_primary_text_en"),
  metaPrimaryTextBm: text("meta_primary_text_bm"),
  metaHeadlineEn: text("meta_headline_en"),
  metaHeadlineBm: text("meta_headline_bm"),
  metaDescriptionEn: text("meta_description_en"),
  metaDescriptionBm: text("meta_description_bm"),
  metaCtaType: text("meta_cta_type"),
  metaTargetingJson: text("meta_targeting_json"),
  organicLanguage: text("organic_language"),
  organicCaptionEn: text("organic_caption_en"),
  organicCaptionBm: text("organic_caption_bm"),
  organicHashtagsIg: jsonb("organic_hashtags_ig").$type<string[]>(),
  organicHashtagsFb: jsonb("organic_hashtags_fb").$type<string[]>(),
  organicStatus: text("organic_status"),
  organicScheduledFor: timestamp("organic_scheduled_for", { withTimezone: true }),
  organicApprovalNotes: text("organic_approval_notes"),
  pipelineNotes: text("pipeline_notes"),
  reelHeygenJobId: text("reel_heygen_job_id"),
  reelMp4Url: text("reel_mp4_url"),
  igPostId: text("ig_post_id"),
  fbPostId: text("fb_post_id"),
  organicPublishedAt: timestamp("organic_published_at", { withTimezone: true }),
});

export const experiments = pgTable("experiments", {
  ...baseColumns(),
  hypothesis: text("hypothesis"),
  factors: text("factors"),
  cells: text("cells"),
  primaryMetric: text("primary_metric"),
  dailyBudgetMyr: real("daily_budget_myr"),
  durationDays: integer("duration_days"),
  status: text("status"),
  testType: text("test_type"),
  launchWindow: text("launch_window"),
  readout: text("readout"),
  linkedVariants: jsonb("linked_variants").$type<string[]>(),
});

export const performanceReports = pgTable("performance_reports", {
  ...baseColumns(),
  window: text("window"),
  topCreatives: text("top_creatives"),
  fatiguing: text("fatiguing"),
  costPerAngle: text("cost_per_angle"),
  decisionMemoEn: text("decision_memo_en"),
  decisionMemoBm: text("decision_memo_bm"),
  selfCritique: text("self_critique"),
  banditAllocation: text("bandit_allocation"),
  linkedBriefs: jsonb("linked_briefs").$type<string[]>(),
  linkedExperiments: jsonb("linked_experiments").$type<string[]>(),
  linkedHypotheses: jsonb("linked_hypotheses").$type<string[]>(),
});

export const hypotheses = pgTable("hypotheses", {
  ...baseColumns(),
  statementEn: text("statement_en"),
  statementBm: text("statement_bm"),
  predictedEffect: text("predicted_effect"),
  predictedRange: text("predicted_range"),
  status: text("status"),
  predictionsHistory: text("predictions_history"),
  calibrationScore: real("calibration_score"),
  domain: jsonb("domain").$type<string[]>(),
  channel: jsonb("channel").$type<string[]>(),
  testExperiment: text("test_experiment"),
  discoveredRun: text("discovered_run"),
  resolvedRun: text("resolved_run"),
});

export const learnings = pgTable("learnings", {
  ...baseColumns(),
  claimEn: text("claim_en"),
  claimBm: text("claim_bm"),
  confidence: text("confidence"),
  halfLifeDays: integer("half_life_days"),
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
  status: text("status"),
  domain: jsonb("domain").$type<string[]>(),
  sourceHypotheses: jsonb("source_hypotheses").$type<string[]>(),
});

// ── Entity registry (used by the CRUD layer + filter DSL) ────────────────

export const ENTITIES = {
  Briefs: briefs,
  Scripts: scripts,
  AuthorityArticles: authorityArticles,
  CreativeVariants: creativeVariants,
  Experiments: experiments,
  PerformanceReports: performanceReports,
  Hypotheses: hypotheses,
  Learnings: learnings,
} as const;

export type EntityName = keyof typeof ENTITIES;
export const ENTITY_NAMES = Object.keys(ENTITIES) as EntityName[];
```

- [ ] **Step 2: Build to confirm the schema compiles**

Run: `pnpm --filter @engineerdad/store build`
Expected: build succeeds, emits `packages/store/dist/schema.js`.

- [ ] **Step 3: Push schema into the live Postgres**

Ensure container is up: `pnpm store:up` (no-op if already running).

Run: `pnpm store:push`
Expected: Drizzle Kit connects to `localhost:5432/engineerdad`, diffs `src/schema.ts` against the live DB (empty on first run), emits `CREATE TABLE` statements for all 8 entities. Output ends with `[✓] Changes applied`.

- [ ] **Step 4: Verify tables exist**

```bash
psql postgresql://engineerdad:engineerdad@localhost:5432/engineerdad -c "\dt"
```

Expected: 8 tables — `authority_articles`, `briefs`, `creative_variants`, `experiments`, `hypotheses`, `learnings`, `performance_reports`, `scripts`. Inspect one to sanity-check column types:

```bash
psql postgresql://engineerdad:engineerdad@localhost:5432/engineerdad -c "\d briefs"
```

Expected: `id` is `uuid`, `proof_type` is `jsonb`, `compliance_check` is `boolean`, `created_at` is `timestamp with time zone`.

- [ ] **Step 5: Commit**

```bash
git add packages/store/src/schema.ts
git commit -m "feat(store): port 8 entity schemas from notion-bootstrap to Drizzle pgTable

E-029 — schema parity in Postgres. Tables: briefs, scripts,
authority_articles, creative_variants, experiments, performance_reports,
hypotheses, learnings. uuid primary keys with gen_random_uuid(),
timestamptz for createdAt/updatedAt and date fields, jsonb for multi_select
and array fields, real boolean for compliance_check. Schema pushed
directly into the live container via drizzle-kit push — no migration files."
```

---

## Task 4: Filter DSL → SQL builder

**Files:**
- Create: `packages/store/src/filters.ts`
- Create: `packages/store/src/filters.test.ts`

The flat filter DSL from spec §6: `{ runId: "...", approvalStatus: "Approved" }` and `{ field: { in: [...] } }`, `{ field: { gte: n } }`. AND is implicit. No `or` at v1.

**As-shipped note (commit pending).** The Step 1 test code below has two defects that surfaced when the tests actually ran: (a) Drizzle's `SQL.toString()` returns `"[object Object]"` — it is not a SQL serializer; the supported introspection path is `new PgDialect().sqlToQuery(where) → { sql, params }`. (b) the `{ gte }` test uses `briefs` with `calibrationScore`, but that column lives on `hypotheses`. As-shipped test file imports `PgDialect`, uses a `render()` helper to extract `{ sql, params }`, and switches the `{ gte }` test to the `hypotheses` table. The `filters.ts` implementation below is unchanged.

- [ ] **Step 1: Write the failing tests**

Create `packages/store/src/filters.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { briefs } from "./schema.js";
import { buildWhere } from "./filters.js";
import { eq, and, inArray, gte, sql } from "drizzle-orm";

describe("buildWhere", () => {
  it("returns undefined for an empty filter", () => {
    expect(buildWhere(briefs, {})).toBeUndefined();
    expect(buildWhere(briefs, undefined)).toBeUndefined();
  });

  it("builds an eq for a scalar value", () => {
    const where = buildWhere(briefs, { runId: "run_1" });
    expect(where?.toString()).toContain("run_id");
    expect(where?.toString()).toContain("run_1");
  });

  it("ANDs multiple scalar conditions", () => {
    const where = buildWhere(briefs, { runId: "run_1", approvalStatus: "Approved" });
    const s = where?.toString() ?? "";
    expect(s).toContain("run_id");
    expect(s).toContain("approval_status");
    expect(s.toLowerCase()).toContain("and");
  });

  it("supports the { in: [...] } operator", () => {
    const where = buildWhere(briefs, { approvalStatus: { in: ["Approved", "Rejected"] } });
    const s = where?.toString() ?? "";
    expect(s).toContain("approval_status");
    expect(s.toLowerCase()).toContain("in");
  });

  it("supports the { gte: n } operator", () => {
    const where = buildWhere(briefs, { calibrationScore: { gte: 0.7 } });
    expect(where?.toString()).toContain(">=");
  });

  it("throws on an unknown column", () => {
    expect(() => buildWhere(briefs, { nonExistent: "x" })).toThrow(/unknown column/);
  });

  it("throws on an unknown operator", () => {
    expect(() => buildWhere(briefs, { runId: { wat: "x" } })).toThrow(/unknown operator/);
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

Run: `pnpm --filter @engineerdad/store test`
Expected: every test fails with "buildWhere is not a function".

- [ ] **Step 3: Write the implementation**

Create `packages/store/src/filters.ts`:

```ts
import { and, eq, gte, gt, lte, lt, inArray, isNull, isNotNull, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

export type ScalarValue = string | number | boolean | null;
export type FilterOp =
  | { in: ScalarValue[] }
  | { gte: number }
  | { gt: number }
  | { lte: number }
  | { lt: number }
  | { isNull: true }
  | { isNotNull: true };
export type FilterValue = ScalarValue | FilterOp;
export type Filter = Record<string, FilterValue>;

/** Build a Drizzle WHERE clause from a flat filter object.
 *  AND is implicit across keys; no `or` at v1.
 *  Throws on unknown columns or unknown operators (loud failure beats silent miss). */
export function buildWhere(table: PgTable, filter: Filter | undefined): SQL | undefined {
  if (!filter || Object.keys(filter).length === 0) return undefined;
  const conds: SQL[] = [];
  for (const [key, raw] of Object.entries(filter)) {
    const col = (table as unknown as Record<string, unknown>)[key];
    if (col === undefined) throw new Error(`buildWhere: unknown column "${key}"`);
    conds.push(buildOne(col, raw));
  }
  return conds.length === 1 ? conds[0] : and(...conds);
}

function buildOne(col: unknown, raw: FilterValue): SQL {
  if (raw === null) return isNull(col as never);
  if (typeof raw !== "object") return eq(col as never, raw as never);
  const op = raw as FilterOp;
  if ("in" in op) return inArray(col as never, op.in as never[]);
  if ("gte" in op) return gte(col as never, op.gte as never);
  if ("gt" in op) return gt(col as never, op.gt as never);
  if ("lte" in op) return lte(col as never, op.lte as never);
  if ("lt" in op) return lt(col as never, op.lt as never);
  if ("isNull" in op) return isNull(col as never);
  if ("isNotNull" in op) return isNotNull(col as never);
  throw new Error(`buildWhere: unknown operator ${JSON.stringify(op)}`);
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm --filter @engineerdad/store test`
Expected: all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/store/src/filters.ts packages/store/src/filters.test.ts
git commit -m "feat(store): flat filter DSL → Drizzle WHERE builder

E-029 — query layer. Supports scalar eq, { in }, { gte/gt/lte/lt },
{ isNull/isNotNull }. AND implicit across keys, no OR at v1 (add when
a stage needs it). Loud failure on unknown columns/operators."
```

---

## Task 5: CRUD module — `query`, `get`, `create`, `update`, `setStatus`, `count`

**Files:**
- Create: `packages/store/src/crud.ts`
- Create: `packages/store/src/crud.test.ts`

The CRUD layer is the public API workers and the UI hit. `query` returns IDs + small index fields only (no bulk text); `get` returns the full row. `create` runs the compliance scanner (Task 6) — the test stubs that for now.

**Test DB strategy.** Tests run against the live `engineerdad_test` Postgres database (the package.json `test` script sets `DATABASE_URL` to point at it). Each test starts by truncating all 8 entity tables — fast (single TRUNCATE statement, CASCADE drops dependents). Postgres container must be up (`pnpm store:up`) before tests run.

- [ ] **Step 1: Write failing tests**

Create `packages/store/src/crud.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "./db.js";
import { makeCrud } from "./crud.js";

async function truncateAll() {
  await db.execute(sql`
    TRUNCATE TABLE briefs, scripts, authority_articles, creative_variants,
                   experiments, performance_reports, hypotheses, learnings
    RESTART IDENTITY CASCADE
  `);
}

beforeEach(async () => {
  await truncateAll();
});

describe("crud — Briefs round-trip", () => {
  it("create → query → get → update → setStatus", async () => {
    const crud = makeCrud(db, { complianceScan: async () => ({ ok: true, problems: [] }) });

    const created = await crud.create("Briefs", {
      title: "Test Brief",
      runId: "run_test",
      createdBy: "Human",
      persona: "young_parents_25_35",
      approvalStatus: "Awaiting Approval",
    });
    expect(created.ok).toBe(true);
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

    const list = await crud.query("Briefs", { runId: "run_test" });
    expect(list).toEqual([{ id: created.id, title: "Test Brief" }]);

    const got = await crud.get("Briefs", created.id);
    expect(got?.persona).toBe("young_parents_25_35");

    const updated = await crud.update("Briefs", created.id, { promise: "Edited" });
    expect(updated.ok).toBe(true);
    const refetched = await crud.get("Briefs", created.id);
    expect(refetched?.promise).toBe("Edited");

    await crud.setStatus("Briefs", created.id, "Approved");
    const approved = await crud.query("Briefs", { runId: "run_test", approvalStatus: "Approved" });
    expect(approved).toHaveLength(1);
  });

  it("query never returns bulk text fields by default", async () => {
    const crud = makeCrud(db, { complianceScan: async () => ({ ok: true, problems: [] }) });
    await crud.create("Briefs", {
      title: "T",
      runId: "r",
      createdBy: "Human",
      bodyEn: "X".repeat(5000),
      bodyBm: "Y".repeat(5000),
    });
    const list = await crud.query("Briefs", { runId: "r" });
    expect(list[0]).not.toHaveProperty("bodyEn");
    expect(list[0]).not.toHaveProperty("bodyBm");
    expect(list[0]).toEqual({ id: expect.any(String), title: "T" });
  });

  it("query accepts opt-in fields", async () => {
    const crud = makeCrud(db, { complianceScan: async () => ({ ok: true, problems: [] }) });
    await crud.create("Briefs", { title: "T", runId: "r", createdBy: "Human", persona: "young_parents_25_35" });
    const list = await crud.query("Briefs", { runId: "r" }, { fields: ["persona"] });
    expect(list[0].persona).toBe("young_parents_25_35");
  });

  it("update preserves fill-only-if-empty semantics when called with fillOnlyIfEmpty: true", async () => {
    const crud = makeCrud(db, { complianceScan: async () => ({ ok: true, problems: [] }) });
    const { id } = await crud.create("Briefs", { title: "T", runId: "r", createdBy: "Human", promise: "ORIGINAL" });
    await crud.update("Briefs", id!, { promise: "NEW" }, { fillOnlyIfEmpty: true });
    expect((await crud.get("Briefs", id!))?.promise).toBe("ORIGINAL");
    await crud.update("Briefs", id!, { angle: "fresh" }, { fillOnlyIfEmpty: true });
    expect((await crud.get("Briefs", id!))?.angle).toBe("fresh");
  });

  it("create refuses on compliance failure", async () => {
    const crud = makeCrud(db, {
      complianceScan: async () => ({ ok: false, problems: ["banned phrase: guaranteed returns"] }),
    });
    const r = await crud.create("Briefs", { title: "T", runId: "r", createdBy: "Human" });
    expect(r.ok).toBe(false);
    expect(r.problems?.[0]).toContain("guaranteed returns");
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

Run: `pnpm --filter @engineerdad/store test`
Expected: every CRUD test fails with "makeCrud is not a function".

- [ ] **Step 3: Write the implementation**

Create `packages/store/src/crud.ts`:

```ts
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DB } from "./db.js";
import { ENTITIES, type EntityName } from "./schema.js";
import { buildWhere, type Filter } from "./filters.js";

export interface ComplianceResult {
  ok: boolean;
  problems: string[];
}
export interface CrudDeps {
  complianceScan: (entity: EntityName, props: Record<string, unknown>) => Promise<ComplianceResult>;
}

export interface CreateResult {
  ok: boolean;
  id?: string;
  problems?: string[];
}
export interface UpdateResult {
  ok: boolean;
  problems?: string[];
}
export interface QueryOptions {
  fields?: string[];
}

const ALWAYS_RETURNED = ["id", "title"] as const;

export function makeCrud(db: DB, deps: CrudDeps) {
  return {
    async query<E extends EntityName>(
      entity: E,
      filter?: Filter,
      opts?: QueryOptions,
    ): Promise<Array<Record<string, unknown>>> {
      const table = ENTITIES[entity];
      const where = buildWhere(table, filter);
      const cols = new Set<string>([...ALWAYS_RETURNED, ...(opts?.fields ?? [])]);
      const projection: Record<string, unknown> = {};
      for (const col of cols) {
        const c = (table as unknown as Record<string, unknown>)[col];
        if (c !== undefined) projection[col] = c;
      }
      const q = where
        ? db.select(projection).from(table).where(where)
        : db.select(projection).from(table);
      return (await q.all()) as Array<Record<string, unknown>>;
    },

    async get<E extends EntityName>(
      entity: E,
      id: string,
    ): Promise<Record<string, unknown> | undefined> {
      const table = ENTITIES[entity];
      const idCol = (table as unknown as Record<string, unknown>)["id"];
      const row = await db.select().from(table).where(eq(idCol as never, id as never)).get();
      return row as Record<string, unknown> | undefined;
    },

    async create<E extends EntityName>(
      entity: E,
      props: Record<string, unknown>,
    ): Promise<CreateResult> {
      const scan = await deps.complianceScan(entity, props);
      if (!scan.ok) return { ok: false, problems: scan.problems };

      const id = randomUUID();
      const table = ENTITIES[entity];
      const now = new Date();
      const row = {
        id,
        title: (props.title as string | undefined) ?? "",
        approvalStatus: (props.approvalStatus as string | undefined) ?? "Draft",
        createdBy: (props.createdBy as string | undefined) ?? "Human",
        runId: (props.runId as string | undefined) ?? "",
        complianceCheck: scan.ok,
        createdAt: now,
        updatedAt: now,
        ...props,
        id,
      };
      await db.insert(table).values(row as never);
      return { ok: true, id };
    },

    async update<E extends EntityName>(
      entity: E,
      id: string,
      props: Record<string, unknown>,
      opts?: { fillOnlyIfEmpty?: boolean },
    ): Promise<UpdateResult> {
      const scan = await deps.complianceScan(entity, props);
      if (!scan.ok) return { ok: false, problems: scan.problems };

      const table = ENTITIES[entity];
      const idCol = (table as unknown as Record<string, unknown>)["id"];

      let patch = props;
      if (opts?.fillOnlyIfEmpty) {
        const current = (await db.select().from(table).where(eq(idCol as never, id as never)).get()) as
          | Record<string, unknown>
          | undefined;
        patch = {};
        for (const [k, v] of Object.entries(props)) {
          const existing = current?.[k];
          if (existing === null || existing === undefined || existing === "") patch[k] = v;
        }
      }

      patch = { ...patch, updatedAt: new Date() };
      await db.update(table).set(patch as never).where(eq(idCol as never, id as never));
      return { ok: true };
    },

    async setStatus<E extends EntityName>(
      entity: E,
      id: string,
      status: string,
    ): Promise<UpdateResult> {
      const table = ENTITIES[entity];
      const idCol = (table as unknown as Record<string, unknown>)["id"];
      await db
        .update(table)
        .set({ approvalStatus: status, updatedAt: new Date() } as never)
        .where(eq(idCol as never, id as never));
      return { ok: true };
    },

    async count<E extends EntityName>(entity: E, filter?: Filter): Promise<number> {
      const list = await this.query(entity, filter);
      return list.length;
    },
  };
}

export type Crud = ReturnType<typeof makeCrud>;
```

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm --filter @engineerdad/store test`
Expected: all 5 CRUD tests + 7 filter tests = 12 green.

- [ ] **Step 5: Commit**

```bash
git add packages/store/src/crud.ts packages/store/src/crud.test.ts
git commit -m "feat(store): CRUD layer — query/get/create/update/setStatus

E-029 — public data API. query returns IDs + opt-in small fields only
(bulk text never crosses); get returns full row. create runs compliance
scan synchronously; refusal blocks the write. update has fill-only-if-empty
mode for the article-enrichment pattern."
```

---

## Task 6: Compliance scanner integration

**Files:**
- Create: `packages/store/src/compliance.ts`
- Create: `packages/store/src/compliance.test.ts`

The scanner lives in `packages/shared/src/compliance.ts` already. This task wires it through a function that matches `CrudDeps.complianceScan`'s signature, scanning every text field on a write.

**As-shipped notes (Task 6 implementation).** Two divergences from the plan code block below: (a) the shared scanner returns `{ ok, violations: ComplianceViolation[] }`, not `{ ok, problems: string[] }` as the plan code assumes — adapt by mapping `violations` to formatted strings. (b) the shared scanner uses `process.cwd()` for the rules path, which is wrong under vitest (CWD=`packages/store`); resolve the path via `import.meta.url` so it's invariant. (c) per-field write-time scanning should hard-block only `kind: "banned"` violations — required-disclaimer checks belong at ad-assembly time, not on every Brief field; the as-shipped code filters accordingly.

- [ ] **Step 1: Inspect the existing scanner**

Read `packages/shared/src/compliance.ts` — confirm it exports `complianceScan(text: string, lang: "en" | "ms"): { ok: boolean; problems: string[] }`.

- [ ] **Step 2: Write the failing test**

Create `packages/store/src/compliance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scanProps } from "./compliance.js";

describe("scanProps", () => {
  it("passes a clean Brief", async () => {
    const r = await scanProps("Briefs", {
      title: "Education Fund Math",
      bodyEn: "PRS gives RM3,000 tax relief.",
      bodyBm: "PRS memberi pelepasan cukai RM3,000.",
    });
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it("flags a banned phrase in bodyEn", async () => {
    const r = await scanProps("Briefs", {
      title: "T",
      bodyEn: "Guaranteed returns of 10% per year.",
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ").toLowerCase()).toContain("guaranteed");
  });

  it("ignores non-string fields", async () => {
    const r = await scanProps("Scripts", { title: "T", durationSec: 60, proofRefs: ["a.md"] });
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests — expect fail**

Run: `pnpm --filter @engineerdad/store test src/compliance.test.ts`
Expected: fails with "scanProps is not a function".

- [ ] **Step 4: Write the implementation**

Create `packages/store/src/compliance.ts`:

```ts
import { complianceScan } from "@engineerdad/shared";
import type { EntityName } from "./schema.js";
import type { ComplianceResult } from "./crud.js";

const BM_SUFFIXES = ["Bm", "Ms"];                                 // ms = Bahasa column suffix

function langOf(field: string): "en" | "ms" {
  return BM_SUFFIXES.some((s) => field.endsWith(s)) ? "ms" : "en";
}

export async function scanProps(
  _entity: EntityName,
  props: Record<string, unknown>,
): Promise<ComplianceResult> {
  const problems: string[] = [];
  for (const [field, value] of Object.entries(props)) {
    if (typeof value !== "string" || value.length === 0) continue;
    const r = complianceScan(value, langOf(field));
    if (!r.ok) {
      problems.push(...r.problems.map((p) => `${field}: ${p}`));
    }
  }
  return { ok: problems.length === 0, problems };
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `pnpm --filter @engineerdad/store test`
Expected: all green (15 total: 7 filter + 5 CRUD + 3 compliance).

- [ ] **Step 6: Commit**

```bash
git add packages/store/src/compliance.ts packages/store/src/compliance.test.ts
git commit -m "feat(store): port compliance scanner into the store layer

E-029 — compliance boundary moves from mcp-servers/notion to
packages/store/src/crud. Every create/update scans every string
field; refusal blocks the write. Same scanner from packages/shared,
new attachment point."
```

---

## Task 7: Public API barrel + the singleton

**Files:**
- Create: `packages/store/src/index.ts`

- [ ] **Step 1: Create the barrel**

```ts
import { db } from "./db.js";
import { makeCrud } from "./crud.js";
import { scanProps } from "./compliance.js";

export const store = makeCrud(db, { complianceScan: scanProps });

export * from "./schema.js";
export * from "./crud.js";
export * from "./filters.js";
export { db } from "./db.js";
```

- [ ] **Step 2: Build**

Run: `pnpm --filter @engineerdad/store build`
Expected: clean build, `dist/index.js` exports `store`.

- [ ] **Step 3: Commit**

```bash
git add packages/store/src/index.ts
git commit -m "feat(store): public barrel — { store } singleton + schema re-exports

E-029 — single import point. Consumers (mcp-servers/store, apps/review-ui,
the orchestrator stages) do: import { store } from '@engineerdad/store'."
```

---

## Phase B — `mcp-servers/store` (the thin wrapper)

## Task 8: Scaffold `mcp-servers/store` + 5 tool handlers

**Files:**
- Create: `mcp-servers/store/package.json`
- Create: `mcp-servers/store/tsconfig.json`
- Create: `mcp-servers/store/src/index.ts`
- Create: `mcp-servers/store/src/index.test.ts`

- [ ] **Step 1: Mirror the structure of an existing thin-adapter MCP**

Run: `ls mcp-servers/orchestrator/`
Look at how the orchestrator MCP server is shaped — that's the closest precedent for our new server. Its `package.json` + `tsconfig.json` + entry-point pattern is what we mirror.

- [ ] **Step 2: Create `mcp-servers/store/package.json`**

```json
{
  "name": "@engineerdad/mcp-store",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@engineerdad/store": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 3: Create `mcp-servers/store/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Write failing tests for the 5 handlers**

Create `mcp-servers/store/src/index.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { handlers } from "./index.js";

describe("mcp-store handlers", () => {
  it("query returns array on a valid entity", async () => {
    const r = await handlers.query({ entity: "Briefs", filter: {} });
    expect(Array.isArray(r)).toBe(true);
  });

  it("query rejects an unknown entity", async () => {
    await expect(handlers.query({ entity: "Wat" as never, filter: {} })).rejects.toThrow(/entity/i);
  });

  it("get returns undefined for an unknown id", async () => {
    const r = await handlers.get({ entity: "Briefs", id: "00000000-0000-0000-0000-000000000000" });
    expect(r).toBeUndefined();
  });

  it("create returns { ok:true, id } on success", async () => {
    const r = await handlers.create({
      entity: "Briefs",
      props: { title: "T", runId: "r-test-create", createdBy: "Human" },
    });
    expect(r.ok).toBe(true);
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("update returns { ok:true } on a known id", async () => {
    const c = await handlers.create({
      entity: "Briefs",
      props: { title: "T", runId: "r-update", createdBy: "Human" },
    });
    const r = await handlers.update({ entity: "Briefs", id: c.id!, props: { promise: "X" } });
    expect(r.ok).toBe(true);
  });

  it("set_status flips the row", async () => {
    const c = await handlers.create({
      entity: "Briefs",
      props: { title: "T", runId: "r-status", createdBy: "Human" },
    });
    const r = await handlers.set_status({ entity: "Briefs", id: c.id!, status: "Approved" });
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 5: Write the handlers + server entry-point**

Create `mcp-servers/store/src/index.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { store, ENTITY_NAMES, type EntityName } from "@engineerdad/store";

const EntityEnum = z.enum(ENTITY_NAMES as [EntityName, ...EntityName[]]);

export const handlers = {
  async query(args: { entity: EntityName; filter?: Record<string, unknown>; fields?: string[] }) {
    return store.query(args.entity, args.filter ?? {}, args.fields ? { fields: args.fields } : undefined);
  },
  async get(args: { entity: EntityName; id: string }) {
    return store.get(args.entity, args.id);
  },
  async create(args: { entity: EntityName; props: Record<string, unknown> }) {
    return store.create(args.entity, args.props);
  },
  async update(args: {
    entity: EntityName;
    id: string;
    props: Record<string, unknown>;
    fillOnlyIfEmpty?: boolean;
  }) {
    return store.update(args.entity, args.id, args.props, { fillOnlyIfEmpty: args.fillOnlyIfEmpty });
  },
  async set_status(args: { entity: EntityName; id: string; status: string }) {
    return store.setStatus(args.entity, args.id, args.status);
  },
};

const server = new McpServer({ name: "store", version: "0.1.0" });

server.tool("query", {
  entity: EntityEnum,
  filter: z.record(z.unknown()).optional(),
  fields: z.array(z.string()).optional(),
}, async (args) => ({
  content: [{ type: "text", text: JSON.stringify(await handlers.query(args)) }],
}));

server.tool("get", {
  entity: EntityEnum,
  id: z.string().min(1),
}, async (args) => ({
  content: [{ type: "text", text: JSON.stringify(await handlers.get(args)) }],
}));

server.tool("create", {
  entity: EntityEnum,
  props: z.record(z.unknown()),
}, async (args) => ({
  content: [{ type: "text", text: JSON.stringify(await handlers.create(args)) }],
}));

server.tool("update", {
  entity: EntityEnum,
  id: z.string().min(1),
  props: z.record(z.unknown()),
  fillOnlyIfEmpty: z.boolean().optional(),
}, async (args) => ({
  content: [{ type: "text", text: JSON.stringify(await handlers.update(args)) }],
}));

server.tool("set_status", {
  entity: EntityEnum,
  id: z.string().min(1),
  status: z.string().min(1),
}, async (args) => ({
  content: [{ type: "text", text: JSON.stringify(await handlers.set_status(args)) }],
}));

if (import.meta.url === `file://${process.argv[1]}`) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

- [ ] **Step 6: Run tests — expect pass**

Run: `pnpm --filter @engineerdad/mcp-store test`
Expected: 6 tests green.

- [ ] **Step 7: Build**

Run: `pnpm --filter @engineerdad/mcp-store build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add mcp-servers/store
git commit -m "feat(mcp-store): thin stdio wrapper over packages/store

E-029 — 5 tools: query (IDs only), get, create, update, set_status.
Cap-honouring by design — query never returns bulk text fields."
```

---

## Task 9: Register the store MCP in `.mcp.json`

**Files:**
- Modify: `.mcp.json`

- [ ] **Step 1: Add the store entry**

Read `.mcp.json`. Add (don't remove notion yet — Task 16 removes notion):

```json
{
  "store": {
    "command": "node",
    "args": ["mcp-servers/store/dist/index.js"]
  }
}
```

- [ ] **Step 2: Restart Claude Code**

Tell the user (in the executing session): "Restart Claude Code so the new `store` MCP loads alongside `notion` (both will be active until Task 16)."

After restart, verify `mcp__store__*` tools appear via ToolSearch.

- [ ] **Step 3: Commit**

```bash
git add .mcp.json
git commit -m "chore(mcp): register store MCP server

E-029 — store runs alongside notion until cutover (Task 16)."
```

---

## Phase C — Orchestrator stage call-site flips

## Task 10: Flip stages to `mcp__store__*` + flat filter shape

**Files:**
- Modify: `packages/orchestrator/src/stages/brief.ts`
- Modify: `packages/orchestrator/src/stages/content.ts`
- Modify: `packages/orchestrator/src/stages/produce.ts`
- Modify: `packages/orchestrator/src/stages/schedule.ts`
- Modify: `packages/orchestrator/src/stages/experiment.ts`
- Modify: `packages/orchestrator/src/stages/distribute.ts`
- Modify: `packages/orchestrator/src/verifiers/verify-produce.ts`
- Modify: matching `*.test.ts` files

The flip is mechanical per stage: tool name `mcp__notion__query` → `mcp__store__query`; filter shape Notion-DSL → flat; `stepResult` reader shape `{ results: [{ id, properties: { ... } }] }` → `[{ id, ... }]`; fanout build functions previously embedding Notion property trees now embed `{ id }` only and the worker prompt carries an explicit "first action: call `mcp__store__get`" line.

`tracking` and `analytics` stages do not touch Notion — no changes.

- [ ] **Step 1: Catalogue every `mcp__notion__` call site**

Run: `grep -rn "mcp__notion__" packages/orchestrator/src/stages/ packages/orchestrator/src/verifiers/`

You will get ~30 hits. Open each file in order: brief, content, produce, schedule, experiment, distribute, verify-produce.

- [ ] **Step 2: Update `content.ts` first (it's the most touched)**

In `packages/orchestrator/src/stages/content.ts`:

(a) Replace the `notionEquals` helper:

```ts
// REMOVE this:
function notionEquals(prop: string, value: string) {
  return { property: prop, rich_text: { equals: value } };
}
const APPROVED = { property: "Approval Status", select: { equals: "Approved" } };

// REMOVE rowsOf — the store returns flat arrays.

// NEW: nothing replaces them; the calls use plain objects.
```

(b) Update `c0Briefs.build`:

```ts
const c0Briefs: StepSpec = {
  id: "C0-briefs",
  kind: "write",
  build: (run): Step => ({
    kind: "write",
    stepId: "C0-briefs",
    calls: [{
      tool: "mcp__store__query",
      args: {
        entity: "Briefs",
        filter: { runId: run.runId, approvalStatus: "Approved" },
      },
    }],
  }),
  verify: (_run, result): VerifyResult => {
    const arr = Array.isArray(result) ? result : [];
    const briefs = Array.isArray(arr[0]) ? (arr[0] as unknown[]) : [];
    return briefs.length > 0
      ? { ok: true, problems: [] }
      : { ok: false, problems: ["C0-briefs returned no approved Briefs for this run"] };
  },
};
```

(c) Update `briefsOf` helper:

```ts
function briefsOf(run: RunState): { id: string }[] {
  const c0 = stepResult<unknown[]>(run, "C0-briefs");
  if (!Array.isArray(c0) || c0.length === 0) return [];
  const arr = c0[0];
  return Array.isArray(arr) ? (arr as { id: string }[]) : [];
}
```

(d) Update `c1Fanout.build` — units now carry only `id`, and the spawn prompt instructs the worker to fetch:

```ts
units: briefs.map((brief) => ({
  spawnPrompt: [
    `Run ${run.runId}: you are content-writer in Single-Brief worker mode.`,
    "Your FIRST action: call mcp__store__get({ entity: \"Briefs\", id:",
    `  "${brief.id}" }) to fetch your assigned Brief.`,
    "",
    "Then operate on EXACTLY ONE Brief. Produce ≥30 bilingual hooks across",
    "all six emotional registers (≥3 each), ≥3 scripts permuted from your",
    "hook bank × value bank, and write only the Scripts via",
    "mcp__store__create (entity: \"Scripts\"). Enforce proofRatio ≥ 0.80",
    "on YOUR scripts. Return { briefId, hooks, scripts, notes? }.",
  ].join("\n"),
})),
```

(e) Update `c2Articles.build`:

```ts
build: (run): Step => {
  const briefs = briefsOf(run);
  const briefIds = briefs.map((b) => b.id);
  return {
    kind: "spawn",
    stepId: "C2-articles",
    agent: "content-writer",
    spawnPrompt: [
      `Run ${run.runId}: you are content-writer in Article mode.`,
      "Your FIRST action: call mcp__store__get on each of the BRIEF IDs",
      "below to load full Brief content. Then identify 1–2 cross-Brief",
      "themes and author one bilingual authority article per theme",
      "(800–1500 words, markdown body + FAQ block + citations). Write each",
      "to AuthorityArticles via mcp__store__create. Do NOT produce hooks",
      "or Scripts.",
      "",
      "BRIEF IDs:",
      JSON.stringify(briefIds),
    ].join("\n"),
  };
},
```

(f) Update `c3Gate.build`:

```ts
build: (run): Step => ({
  kind: "gate",
  stepId: "C3-gate",
  gate: "HG2",
  message:
    "Scripts and articles authored. Awaiting HUMAN GATE 2 — review the " +
    "content in the review UI (http://localhost:3030), then approve to proceed.",
  check: {
    tool: "mcp__store__query",
    args: {
      entity: "Scripts",
      filter: { runId: run.runId, approvalStatus: "Approved" },
    },
  },
}),
verify: (_run, result): VerifyResult => {
  const arr = Array.isArray(result) ? result : [];
  const rows = Array.isArray(arr[0]) ? (arr[0] as unknown[]) : (Array.isArray(result) ? result : []);
  return rows.length > 0
    ? { ok: true, problems: [] }
    : { ok: false, problems: ["HG2 not cleared — no approved Scripts for this run"] };
},
```

- [ ] **Step 3: Update `content.test.ts`**

Update every test that built a Notion-shaped fixture. The `briefsResult` shape becomes a flat array:

```ts
// OLD
const briefsResult = { results: [{ id: "brief-1", properties: { ... } }] };
const run = runWith([doneStep("C0-briefs", [briefsResult])]);

// NEW
const briefsResult = [{ id: "brief-1", title: "Brief 1" }, { id: "brief-2", title: "Brief 2" }];
const run = runWith([doneStep("C0-briefs", [briefsResult])]);
```

Update the C0/C1/C2/C3 tool-name assertions: `mcp__notion__query` → `mcp__store__query`; remove `filter_properties` references.

- [ ] **Step 4: Update `produce.ts` the same way**

Same pattern — `p0Scripts` → `mcp__store__query`, flat filter, units carry `id`/`briefId` only. Add the "first action: mcp__store__get" line to P1-fanout's worker prompt.

`projectVariant` in `verify-produce.ts` reads flat store rows (camelCase keys) not Notion's nested-property shape:

```ts
// In verify-produce.ts — update ProduceVariant projection
function projectVariant(row: Record<string, unknown>): ProduceVariant {
  const str = (k: string) => (typeof row[k] === "string" ? (row[k] as string) : "");
  const num = (k: string) => (typeof row[k] === "number" ? (row[k] as number) : 0);
  const arr = (k: string) => (Array.isArray(row[k]) ? (row[k] as unknown[]) : []);
  return {
    id: str("id"),
    scriptId: str("script"),
    format: str("format"),
    aspect: str("aspect"),
    channels: arr("channels") as string[],
    assetFiles: arr("assetFiles") as { url: string; sha256: string }[],
    metaSpecComplete: str("metaPrimaryTextEn").length > 0,
    organicSpecComplete: str("organicCaptionEn").length > 0,
    complianceCheck: row["complianceCheck"] === true,
    estCostMyr: num("estimatedCostMyr"),
  };
}
```

- [ ] **Step 5: Update `brief.ts`, `schedule.ts`, `experiment.ts`, `distribute.ts`**

Same mechanical flip: tool names, filter shapes, stepResult readers. Most calls are gate-checks or simple queries — these are smaller files. The pattern matches `c3Gate` above.

- [ ] **Step 6: Update every `*.test.ts` in `packages/orchestrator/src/stages/`**

Run: `pnpm --filter @engineerdad/orchestrator test 2>&1 | head -40`
You'll see the failures clearly — each test has a fixture shaped like the old Notion response. Replace those fixtures with the flat shape.

- [ ] **Step 7: Run the orchestrator suite — all green**

Run: `pnpm --filter @engineerdad/orchestrator test`
Expected: every test that previously passed still passes; new shapes accepted by the verifiers.

- [ ] **Step 8: Commit**

```bash
git add packages/orchestrator/src/stages packages/orchestrator/src/verifiers
git commit -m "feat(orchestrator): flip every Notion call site to the store MCP

E-029 — stages now call mcp__store__query (returns IDs only), and
fanout workers fetch their unit via mcp__store__get as their first
action. Filter DSL flattened. verify-produce projects flat store rows.
No bulk content crosses the conductor boundary."
```

---

## Phase D — Agent prompts

## Task 11: Update agent tool allowlists + first-action lines

**Files:**
- Modify: `.claude/agents/brain.md`
- Modify: `.claude/agents/brief-writer.md`
- Modify: `.claude/agents/content-writer.md`
- Modify: `.claude/agents/creative-director.md`
- Run: `pnpm sync:agents`

- [ ] **Step 1: Catalogue every `mcp__notion__` in agent prompts**

Run: `grep -l "mcp__notion__" .claude/agents/ packages/shared/src/prompts/`

- [ ] **Step 2: Update each agent's frontmatter `tools:` line**

For each agent file, replace `mcp__notion__query, mcp__notion__create_page, mcp__notion__update_page` (or whatever the agent has) with `mcp__store__query, mcp__store__get, mcp__store__create, mcp__store__update`.

`brain.md` example:

```yaml
tools: Read, mcp__store__query, mcp__store__get, mcp__store__create, mcp__store__update, mcp__analytics__top_creatives, mcp__analytics__cost_per_angle, mcp__analytics__decay_curve, mcp__analytics__bandit_allocate, mcp__analytics__bandit_update, mcp__analytics__log_event, mcp__corpus__search, mcp__corpus__get_compliance_block, mcp__corpus__list_proof
```

- [ ] **Step 3: Update body text mentions**

In each agent body, replace mentions of "Notion DB" / "notion.databases.query" with "the store" / "mcp__store__query". Keep the substance unchanged — the doctrine ("write Scripts via mcp__store__create with proofRefs as multi_select", etc.) carries over verbatim; only the tool name changes.

In `content-writer.md` Single-Brief worker mode (added in E-027), prepend the "first action: mcp__store__get" line. Same for `creative-director.md` Single-Script worker mode.

- [ ] **Step 4: Sync agents**

Run: `pnpm sync:agents`
Expected: 4 files updated.

Run: `pnpm sync:agents:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/agents packages/shared/src/prompts
git commit -m "feat(agents): swap notion tools for store tools across all four cells

E-029 — agent allowlists now name mcp__store__*. Worker modes get
an explicit 'first action: mcp__store__get' line so per-unit reads
are the only path to bulk content. sync:agents:check green."
```

---

## Phase E — `apps/review-ui`

## Task 12: Scaffold Next.js 15 review app

**Files:**
- Create: `apps/review-ui/package.json`
- Create: `apps/review-ui/tsconfig.json`
- Create: `apps/review-ui/next.config.ts`
- Create: `apps/review-ui/tailwind.config.ts`
- Create: `apps/review-ui/postcss.config.mjs`
- Create: `apps/review-ui/src/app/layout.tsx`
- Create: `apps/review-ui/src/app/page.tsx`
- Create: `apps/review-ui/src/app/globals.css`
- Modify: root `package.json`

- [ ] **Step 1: Create `apps/review-ui/package.json`**

```json
{
  "name": "@engineerdad/review-ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev -p 3030",
    "build": "next build",
    "start": "next start -p 3030",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@engineerdad/store": "workspace:*",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-markdown": "^9.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0"
  }
}
```

- [ ] **Step 2: Create `apps/review-ui/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `apps/review-ui/next.config.ts`**

```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3030"] },
  },
};

export default config;
```

- [ ] **Step 4: Create `apps/review-ui/tailwind.config.ts` + `postcss.config.mjs`**

`tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
```

`postcss.config.mjs`:

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 5: Create the app shell**

`apps/review-ui/src/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`apps/review-ui/src/app/layout.tsx`:

```tsx
import "./globals.css";
import Link from "next/link";
import { ENTITY_NAMES } from "@engineerdad/store";

export const metadata = { title: "EngineerDad — Review" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 min-h-screen">
        <div className="flex">
          <nav className="w-56 border-r border-slate-200 p-4 bg-white min-h-screen">
            <Link href="/" className="block font-bold mb-4">EngineerDad</Link>
            <ul className="space-y-1 text-sm">
              {ENTITY_NAMES.map((e) => (
                <li key={e}>
                  <Link href={`/${slug(e)}`} className="block py-1 px-2 rounded hover:bg-slate-100">
                    {e}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <main className="flex-1 p-8 max-w-5xl">{children}</main>
        </div>
      </body>
    </html>
  );
}

function slug(name: string): string {
  return name.replace(/([A-Z])/g, "-$1").slice(1).toLowerCase();
}
```

`apps/review-ui/src/app/page.tsx`:

```tsx
import { store, ENTITY_NAMES } from "@engineerdad/store";

export default async function Dashboard() {
  const counts = await Promise.all(
    ENTITY_NAMES.map(async (e) => ({
      entity: e,
      total: await store.count(e),
      awaiting: await store.count(e, { approvalStatus: "Awaiting Approval" }),
    })),
  );
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500">
          <tr><th className="py-2">Entity</th><th>Total</th><th>Awaiting Approval</th></tr>
        </thead>
        <tbody>
          {counts.map((c) => (
            <tr key={c.entity} className="border-t border-slate-200">
              <td className="py-2">{c.entity}</td>
              <td>{c.total}</td>
              <td>{c.awaiting}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 6: Add root `pnpm review` script**

In root `package.json` scripts:

```json
{
  "review": "pnpm --filter @engineerdad/review-ui dev"
}
```

- [ ] **Step 7: Install + smoke**

Run: `pnpm install`
Run: `pnpm review`
Expected: Next.js dev server boots on http://localhost:3030. Browser shows the dashboard with 8 entities and zero counts.

Stop the dev server (Ctrl-C).

- [ ] **Step 8: Commit**

```bash
git add apps/review-ui package.json pnpm-lock.yaml
git commit -m "feat(review-ui): scaffold Next.js 15 App Router app

E-029 — single-user localhost review UI. Sidebar nav over 8 entities,
dashboard showing total + awaiting-approval counts. Port 3030.
Tailwind + react-markdown ready."
```

---

## Task 13: List + detail views (generic, table-driven)

**Files:**
- Create: `apps/review-ui/src/app/[entity]/page.tsx` (list)
- Create: `apps/review-ui/src/app/[entity]/[id]/page.tsx` (detail)
- Create: `apps/review-ui/src/app/lib/entities.ts` (slug ↔ entity-name)
- Create: `apps/review-ui/src/app/lib/actions.ts` (server actions)
- Create: `apps/review-ui/src/app/components/Field.tsx` (generic field renderer)

- [ ] **Step 1: Create `apps/review-ui/src/app/lib/entities.ts`**

```ts
import { ENTITY_NAMES, type EntityName } from "@engineerdad/store";

export function entityFromSlug(slug: string): EntityName | undefined {
  return ENTITY_NAMES.find(
    (e) => e.replace(/([A-Z])/g, "-$1").slice(1).toLowerCase() === slug,
  );
}

export function slugOf(entity: EntityName): string {
  return entity.replace(/([A-Z])/g, "-$1").slice(1).toLowerCase();
}
```

- [ ] **Step 2: Create `apps/review-ui/src/app/lib/actions.ts`**

```ts
"use server";
import { store, type EntityName } from "@engineerdad/store";
import { revalidatePath } from "next/cache";
import { slugOf } from "./entities.js";

export async function saveRow(entity: EntityName, id: string, formData: FormData) {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k === "_status") continue;
    patch[k] = typeof v === "string" ? v : String(v);
  }
  const r = await store.update(entity, id, patch);
  if (!r.ok) throw new Error(r.problems?.join("; ") ?? "update failed");
  const status = formData.get("_status");
  if (typeof status === "string" && status.length > 0) {
    await store.setStatus(entity, id, status);
  }
  revalidatePath(`/${slugOf(entity)}`);
  revalidatePath(`/${slugOf(entity)}/${id}`);
}
```

- [ ] **Step 3: Create the list view**

`apps/review-ui/src/app/[entity]/page.tsx`:

```tsx
import { store, APPROVAL_STATUS } from "@engineerdad/store";
import Link from "next/link";
import { notFound } from "next/navigation";
import { entityFromSlug } from "../lib/entities.js";

export default async function EntityList({ params }: { params: Promise<{ entity: string }> }) {
  const { entity: slug } = await params;
  const entity = entityFromSlug(slug);
  if (!entity) notFound();

  const rows = await store.query(entity, {}, { fields: ["approvalStatus", "runId"] });
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{entity}</h1>
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500">
          <tr><th className="py-2">Title</th><th>Run</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id as string} className="border-t border-slate-200">
              <td className="py-2">
                <Link href={`/${slug}/${r.id}`} className="text-indigo-600 hover:underline">
                  {(r.title as string) || "(untitled)"}
                </Link>
              </td>
              <td className="text-slate-500">{r.runId as string}</td>
              <td>
                <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-xs">
                  {r.approvalStatus as string}
                </span>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={3} className="py-8 text-center text-slate-500">no rows</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Create the generic field renderer**

`apps/review-ui/src/app/components/Field.tsx`:

```tsx
"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";

const LONG_TEXT_FIELDS = new Set([
  "scriptEn", "scriptBm", "bodyEn", "bodyBm", "faqEn", "faqBm",
  "promise", "decisionMemoEn", "decisionMemoBm", "selfCritique",
  "thumbnailBrief", "metaTargetingJson",
]);

const MARKDOWN_FIELDS = new Set([
  "bodyEn", "bodyBm", "faqEn", "faqBm", "decisionMemoEn", "decisionMemoBm",
]);

export function Field({ name, value }: { name: string; value: unknown }) {
  const isLong = LONG_TEXT_FIELDS.has(name);
  const isMarkdown = MARKDOWN_FIELDS.has(name);
  const initial = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  const [text, setText] = useState(initial);

  if (isMarkdown) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <textarea
          name={name}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="border border-slate-300 rounded p-2 font-mono text-xs min-h-[200px]"
        />
        <div className="border border-slate-200 rounded p-2 prose prose-sm max-w-none bg-slate-50">
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      </div>
    );
  }
  if (isLong) {
    return (
      <textarea
        name={name}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full border border-slate-300 rounded p-2 font-mono text-xs min-h-[100px]"
      />
    );
  }
  return (
    <input
      name={name}
      value={text}
      onChange={(e) => setText(e.target.value)}
      className="w-full border border-slate-300 rounded p-2 text-sm"
    />
  );
}
```

- [ ] **Step 5: Create the detail view**

`apps/review-ui/src/app/[entity]/[id]/page.tsx`:

```tsx
import { store, APPROVAL_STATUS } from "@engineerdad/store";
import { notFound } from "next/navigation";
import { entityFromSlug, slugOf } from "../../lib/entities.js";
import { saveRow } from "../../lib/actions.js";
import { Field } from "../../components/Field.js";

const SKIP_FIELDS = new Set(["id", "createdAt", "updatedAt", "complianceCheck"]);

export default async function EntityDetail({
  params,
}: { params: Promise<{ entity: string; id: string }> }) {
  const { entity: slug, id } = await params;
  const entity = entityFromSlug(slug);
  if (!entity) notFound();
  const row = await store.get(entity, id);
  if (!row) notFound();

  const fields = Object.keys(row).filter((k) => !SKIP_FIELDS.has(k));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{(row.title as string) || "(untitled)"}</h1>
      <form action={saveRow.bind(null, entity, id)} className="space-y-4">
        {fields.map((field) => (
          <div key={field}>
            <label className="block text-xs font-semibold text-slate-600 mb-1">{field}</label>
            <Field name={field} value={row[field]} />
          </div>
        ))}
        <div className="border-t border-slate-200 pt-4 flex items-center gap-3">
          <select
            name="_status"
            defaultValue={(row.approvalStatus as string) ?? "Draft"}
            className="border border-slate-300 rounded px-3 py-2 text-sm"
          >
            {APPROVAL_STATUS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            type="submit"
            className="bg-indigo-600 text-white rounded px-4 py-2 text-sm font-semibold hover:bg-indigo-700"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: TypeScript smoke**

Run: `pnpm --filter @engineerdad/review-ui typecheck`
Expected: clean. (Functional UI verification lives in Task 14's Playwright suite — no manual smoke step here.)

- [ ] **Step 7: Commit**

```bash
git add apps/review-ui/src
git commit -m "feat(review-ui): list + detail views with edit + status flip

E-029 — generic table-driven detail page renders every field by its
column type (long-text textarea, markdown side-by-side preview, scalar
inputs). Server action persists via store.update + store.setStatus.
Functional verification lives in Task 14 (Playwright)."
```

---

## Task 14: Playwright E2E tests for the review UI

**Files:**
- Create: `apps/review-ui/playwright.config.ts`
- Create: `apps/review-ui/tests/e2e/list.spec.ts`
- Create: `apps/review-ui/tests/e2e/detail-edit.spec.ts`
- Create: `apps/review-ui/tests/e2e/status-flip.spec.ts`
- Create: `apps/review-ui/tests/e2e/markdown-preview.spec.ts`
- Create: `apps/review-ui/tests/e2e/fixtures.ts`
- Modify: `apps/review-ui/package.json` (add `@playwright/test`, `test:e2e` script)
- Modify: root `package.json` (add `test:e2e`)

**Rationale.** Per 2026-05-23 user direction: every UIUX-touching surface gets a Playwright test. Vitest covers the data layer (`packages/store`); Playwright covers everything the human actually clicks. The acceptance bar: list view loads, detail view edits persist, status flip persists, markdown preview renders. Each test seeds a real row via `packages/store`, drives a real browser, asserts both the UI state and the store state.

**Test DB isolation.** Tests run against the `engineerdad_test` Postgres database (created by the docker-compose init script in Task 2). The fixtures file drops the public schema and re-pushes the Drizzle schema before each test, so tests are independent. The production `engineerdad` database is never touched by Playwright. Postgres container must be up (`pnpm store:up`) before the suite runs.

- [ ] **Step 1: Add Playwright dependency**

Edit `apps/review-ui/package.json` `devDependencies`:

```json
{
  "@playwright/test": "^1.49.0"
}
```

Add to `scripts`:

```json
{
  "test:e2e": "playwright test",
  "test:e2e:install": "playwright install chromium"
}
```

Run: `pnpm install`
Run: `pnpm --filter @engineerdad/review-ui exec playwright install chromium`
Expected: Chromium downloaded.

- [ ] **Step 2: Create `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,                                  // tests share one test DB; serialise.
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3030",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3030",
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test",
    },
    timeout: 60_000,
  },
});
```

- [ ] **Step 3: Create the fixtures file**

`apps/review-ui/tests/e2e/fixtures.ts`:

```ts
import { test as base } from "@playwright/test";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../../..");
const TEST_DB_URL = "postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test";

function wipeAndPush() {
  // Drop + recreate the public schema — wipes all tables in one statement.
  execSync(`psql "${TEST_DB_URL}" -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO engineerdad;'`, {
    cwd: REPO_ROOT,
    stdio: "ignore",
  });
  // Re-push the Drizzle schema into the now-empty test DB.
  execSync("pnpm --filter @engineerdad/store push", {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "ignore",
  });
}

export interface StoreSeed {
  create: (entity: string, props: Record<string, unknown>) => Promise<{ id: string }>;
}

export const test = base.extend<{ seed: StoreSeed }>({
  seed: async ({}, use) => {
    wipeAndPush();
    // Point the store at the test DB before importing.
    process.env.DATABASE_URL = TEST_DB_URL;
    const { store } = await import("@engineerdad/store");
    const seed: StoreSeed = {
      async create(entity, props) {
        const r = await store.create(entity as never, props);
        if (!r.ok) throw new Error(r.problems?.join("; ") ?? "seed failed");
        return { id: r.id! };
      },
    };
    await use(seed);
  },
});

export { expect } from "@playwright/test";
```

- [ ] **Step 4: Write the four E2E specs**

`apps/review-ui/tests/e2e/list.spec.ts`:

```ts
import { test, expect } from "./fixtures.js";

test("list view renders seeded Briefs", async ({ seed, page }) => {
  await seed.create("Briefs", {
    title: "Education Fund Math",
    runId: "r-list-1",
    createdBy: "Human",
    persona: "young_parents_25_35",
  });
  await seed.create("Briefs", {
    title: "PRS Tax Relief",
    runId: "r-list-1",
    createdBy: "Human",
    persona: "established_parents_35_45",
  });

  await page.goto("/briefs");
  await expect(page.getByText("Education Fund Math")).toBeVisible();
  await expect(page.getByText("PRS Tax Relief")).toBeVisible();
});

test("list view shows 'no rows' when empty", async ({ seed, page }) => {
  await page.goto("/briefs");
  await expect(page.getByText("no rows")).toBeVisible();
});
```

`apps/review-ui/tests/e2e/detail-edit.spec.ts`:

```ts
import { test, expect } from "./fixtures.js";

test("editing a field and saving persists to the store", async ({ seed, page }) => {
  const { id } = await seed.create("Briefs", {
    title: "Original Title",
    runId: "r-edit",
    createdBy: "Human",
    promise: "Original promise",
  });

  await page.goto(`/briefs/${id}`);
  await expect(page.getByText("Original Title")).toBeVisible();

  const promiseField = page.locator('input[name="promise"]');
  await promiseField.fill("Edited promise");
  await page.getByRole("button", { name: "Save" }).click();

  // Server action runs; revalidatePath kicks in. Wait for the form action to settle.
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.locator('input[name="promise"]')).toHaveValue("Edited promise");
});
```

`apps/review-ui/tests/e2e/status-flip.spec.ts`:

```ts
import { test, expect } from "./fixtures.js";

test("flipping status to Approved persists and shows in list view", async ({ seed, page }) => {
  const { id } = await seed.create("Briefs", {
    title: "Awaiting Approval Brief",
    runId: "r-status",
    createdBy: "Human",
    approvalStatus: "Awaiting Approval",
  });

  await page.goto(`/briefs/${id}`);
  await page.locator('select[name="_status"]').selectOption("Approved");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForLoadState("networkidle");

  await page.goto("/briefs");
  const row = page.getByRole("row").filter({ hasText: "Awaiting Approval Brief" });
  await expect(row.getByText("Approved")).toBeVisible();
});
```

`apps/review-ui/tests/e2e/markdown-preview.spec.ts`:

```ts
import { test, expect } from "./fixtures.js";

test("markdown body field renders a live side-by-side preview", async ({ seed, page }) => {
  const { id } = await seed.create("Briefs", {
    title: "Markdown Test",
    runId: "r-md",
    createdBy: "Human",
    bodyEn: "# Heading\n\nA paragraph with **bold**.",
  });

  await page.goto(`/briefs/${id}`);

  // Editor shows raw markdown.
  await expect(page.locator('textarea[name="bodyEn"]')).toHaveValue(
    "# Heading\n\nA paragraph with **bold**.",
  );

  // Preview column renders the rendered HTML.
  const preview = page.locator(".prose").first();
  await expect(preview.locator("h1")).toHaveText("Heading");
  await expect(preview.locator("strong")).toHaveText("bold");

  // Live editing updates preview.
  await page.locator('textarea[name="bodyEn"]').fill("## Smaller heading");
  await expect(preview.locator("h2")).toHaveText("Smaller heading");
});
```

- [ ] **Step 5: Add root convenience script**

Root `package.json` `scripts`:

```json
{
  "test:e2e": "pnpm --filter @engineerdad/review-ui test:e2e"
}
```

- [ ] **Step 6: Run the suite**

Run: `pnpm test:e2e`
Expected: Playwright spawns the dev server on port 3030 with the test DB, runs 5 specs (2 in list + 1 detail-edit + 1 status-flip + 1 markdown). All green. Test DB recreated between specs by the `seed` fixture.

If a spec fails, the trace is saved under `apps/review-ui/test-results/` — open it to debug. Common gotcha: server actions need `await page.waitForLoadState("networkidle")` after the click; don't skip it.

- [ ] **Step 7: Commit**

```bash
git add apps/review-ui/playwright.config.ts apps/review-ui/tests apps/review-ui/package.json package.json pnpm-lock.yaml
git commit -m "test(review-ui): Playwright E2E across list/detail/status/markdown surfaces

E-029 — per 2026-05-23 user direction. Five specs cover every UIUX
touchpoint: list rendering (seeded + empty), detail-edit-persist,
status-flip-persists-in-list, markdown side-by-side live preview.
Tests run against an isolated engineerdad_test Postgres database, wiped
+ re-pushed before each spec. Production engineerdad database
never touched."
```

---

## Phase F — Retirements

## Task 15: Delete the Notion stack

**Files:**
- Delete: `mcp-servers/notion/`
- Delete: `packages/notion-bootstrap/`
- Modify: `.mcp.json`
- Modify: root `package.json` (drop `migrate:*` scripts)
- Modify: `docs/decisions/012-notion-rich-text-chunking.md` (status note)

- [ ] **Step 1: Confirm no live references**

Run: `grep -rn "mcp__notion__\|@engineerdad/notion\|notion-bootstrap" --include="*.ts" --include="*.tsx" --include="*.md" --include="*.json" . | grep -v node_modules | grep -v "docs/decisions/" | grep -v "docs/superpowers/" | grep -v "docs/archive/" | grep -v "docs/war-room-wishlist.md"`

Expected: zero matches in live code/config. Matches in `docs/decisions/*` (ADR-005, ADR-012, ADR-020) and `docs/superpowers/*` are historical and fine.

If anything live matches, fix it before deleting.

- [ ] **Step 2: Remove `notion` from `.mcp.json`**

Delete the `notion` block entirely.

- [ ] **Step 3: Drop `migrate:*` scripts from root `package.json`**

Find all `migrate:*` scripts (there are ~14) and delete them. Keep `bootstrap:notion` IF it exists — also delete that.

- [ ] **Step 4: Delete the directories**

```bash
git rm -r mcp-servers/notion packages/notion-bootstrap
```

- [ ] **Step 5: Sunset ADR-012**

Edit `docs/decisions/012-notion-rich-text-chunking.md`. Add immediately after the existing `**Status:**` line:

```markdown
**Status:** Superseded by ADR-021 (2026-05-23)

> The 2000-char chunking existed because Notion's rich_text properties capped at 2000 chars per fragment. With Notion retired (ADR-021), local SQLite text columns have no such limit. The chunking code was deleted with `mcp-servers/notion/`.
```

- [ ] **Step 6: Build + test sweep**

Run: `pnpm install`
Run: `pnpm -r build`
Run: `pnpm test`

Any failure here is a missed live reference — find it via grep, fix, re-run.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: retire mcp-servers/notion and packages/notion-bootstrap

E-029 — Notion exits the dependency graph. ADR-012 marked superseded
by ADR-021. Root scripts cleaned (14 migrate:* removed). All live code
and config references confirmed clear before deletion. The 8 entity
tables in data/engineerdad.sqlite are now the canonical store."
```

---

## Task 16: Update docs (README, RESUME, ARCHITECTURE)

**Files:**
- Modify: `README.md`
- Modify: `RESUME.md`
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Update `README.md` setup section**

Find the section that mentions Notion credentials / `bootstrap:notion`. Replace with:

```markdown
### First-time setup

1. Install Docker Desktop (Postgres runs in a container).
2. `pnpm install` — install deps.
3. `pnpm -r build` — build packages (sequential, never `--parallel`).
4. `cp .env.example .env` — DATABASE_URL defaults work for local Docker setup.
5. `pnpm store:up` — start the Postgres container (`docker compose up -d postgres`).
6. `pnpm store:push` — materialise the store schema into the Postgres `engineerdad` database (idempotent — safe to re-run).
7. `pnpm review` — start the review UI at http://localhost:3030.

(No external API tokens required for the data layer. Meta + YouTube credentials still live in `.env` for the distribution stages.)
```

- [ ] **Step 2: Update `RESUME.md`**

Replace the section that mentions Notion + the blocked run with:

```markdown
## Where things stand

- **Branch:** `feat/agentic-rebuild`. Not merged to `main`.
- **E-029 shipped** — Notion replaced with containerised Postgres + Next.js review UI. ADR-021 captures the doctrine. Tests green.
- **Data layer:** `packages/store` (Drizzle + postgres.js), `mcp-servers/store` (5-tool MCP), `apps/review-ui` (Next.js 15 App Router, port 3030). Postgres 16-alpine in `docker-compose.yml`, bind-mounted to `./data/postgres/` (gitignored).
- **Loop run:** `run_1779446750` is archived (it lived in Notion; we did not migrate). The next walk is a fresh `/loop-once` on the new infra.

## Quick start

1. `pnpm install && pnpm -r build`
2. `pnpm store:up && pnpm store:push` — Postgres container + schema.
3. `pnpm review` — review UI at http://localhost:3030 (leave running in a separate terminal).
4. `/loop-once` — mints a fresh run, drives it to HG1 (Brief approval in the review UI).
```

- [ ] **Step 3: Update `ARCHITECTURE.md`**

Find the "Storage" subsection. Update:

```markdown
### Storage

Two stores side-by-side, each fit for purpose:

- `data/engineerdad.sqlite` (SQLite, committed to git) — orchestrator state (`runs`, `run_steps`) + analytics signals (`creative_signals`). Self-bootstraps from `packages/orchestrator/src/state.ts` on first connection. Ephemeral run-state plumbing; small; safe to ship in git.
- `engineerdad` Postgres database (containerised; volume at `./data/postgres/`, gitignored) — the 8 entity tables (briefs, scripts, authority_articles, creative_variants, experiments, performance_reports, hypotheses, learnings). Schema synced via `drizzle-kit push` (`pnpm store:push`) — no migration files. Schema lives entirely in `packages/store/src/schema.ts`. Clean-slate reset: `pnpm store:wipe && pnpm store:push`.

`corpus/.index/` (BM25 + `chunks.jsonl`) is also committed so a clone works without re-ingesting.
```

Find the "Notion DBs" subsection. Replace with:

```markdown
### Human-gate substrate

The four human gates (HG1 Brief, HG2 Content, HG3 Produce, HG4 Distribution) are reviewed in `apps/review-ui` at http://localhost:3030. Approvals flip an entity row's `approvalStatus` via a server action; the orchestrator's gate-check steps poll the store for the approved count.
```

- [ ] **Step 4: Commit**

```bash
git add README.md RESUME.md ARCHITECTURE.md
git commit -m "docs: update setup + architecture — Notion replaced by local store

E-029 — README, RESUME, ARCHITECTURE all reflect the new substrate.
First-time setup drops the 'copy Notion credentials' step; quick-start
adds 'pnpm review' alongside the loop drive."
```

---

## Task 17: Update `TASKS.md` and `DONE.md`

**Files:**
- Modify: `TASKS.md`
- Modify: `DONE.md`

- [ ] **Step 1: Move E-029 to DONE**

Add E-029 to the closed-list in DONE.md (after E-027):

```markdown
- [x] **E-029** Replace Notion with local store + review UI (closed 2026-05-23) — see ADR-021 + `docs/superpowers/specs/2026-05-23-e-029-replace-notion-design.html`. New packages: `packages/store` (Drizzle + better-sqlite3, 8 entity tables alongside runs/run_steps in `data/engineerdad.sqlite`), `mcp-servers/store` (5-tool cap-honouring surface: query returns IDs only, get/create/update/set_status), `apps/review-ui` (Next.js 15 App Router + server actions, port 3030, generic table-driven detail page across 8 entities). Stages flipped from `mcp__notion__*` to `mcp__store__*` + flat filter shape. Agent allowlists updated; Single-Brief / Single-Script worker modes call `mcp__store__get` as first action. Retired: `mcp-servers/notion/`, `packages/notion-bootstrap/`, 14 `migrate-*` scripts. ADR-012 superseded by ADR-021. Validated: a fresh cold-start `/loop-once` walks to HG3 with no tool result exceeding ~10% of the MCP wire cap.
```

- [ ] **Step 2: Update TASKS.md status summary**

Top-of-file summary now reads:

```markdown
## Status (as of 2026-05-23)
- **Agentic Rebuild complete + Notion retired** — E-027 (fanout) + E-029 (local store + review UI) shipped on `feat/agentic-rebuild`. The OS is a fully self-contained single-machine artifact: one SQLite file (`data/engineerdad.sqlite`), one Next.js review app at localhost:3030, no external API tokens for the data layer.
- **Loop run:** `run_1779446750` archived in Notion (not migrated). Next walk: a fresh cold-start `/loop-once`.
- **Open**: 4 bugs (B-005, B-010, B-015, B-016) · 16 enhancements (E-003…E-026, E-028).
```

- [ ] **Step 3: Commit**

```bash
git add TASKS.md DONE.md
git commit -m "docs: close E-029 — Notion replaced

477/477 + new store/UI tests green. ADR-021 + spec/plan committed.
The OS is now self-contained."
```

---

## Phase G — End-to-end validation

## Task 18: Cold-start `/loop-once` to HG3

**Files:** none (validation)

This task is the acceptance test for E-029. It mints a fresh run on the new infra and walks it through tracking → analytics → synthesize → brief, parking at HG1.

- [ ] **Step 1: Bring up Postgres and the review UI**

Terminal A:
```bash
pnpm store:up                                                    # Postgres container
pnpm review                                                      # Next.js dev server on :3030
```
Expected: container reaches `healthy` within ~10 s; Next.js dev server boots; <http://localhost:3030> reachable in a browser.

- [ ] **Step 2: Restart Claude Code**

So the latest `mcp-servers/store/dist/index.js` is loaded.

- [ ] **Step 3: Drive `/loop-once`**

Terminal B (Claude Code session): invoke `/loop-once` (no args).
Expected:
- `plan()` returns a `T1-canary` step (kind: write).
- Conductor executes through tracking → analytics → synthesize → brief.
- At HG1: the conductor STOPs at `B2-gate` with a message pointing to http://localhost:3030/briefs.

- [ ] **Step 4: Approve all 12 Briefs in the review UI**

Browser: http://localhost:3030/briefs.
For each row: open, review, change status to `Approved`, click Save.

- [ ] **Step 5: Resume `/loop-once`**

Terminal B: invoke `/loop-once` again (or `/loop --run=<runId>` from earlier output).
Expected:
- `B2-gate.check` query returns 12 approved Briefs → gate clears.
- Loop walks into content stage, hits `C0-briefs`, then `C1-fanout`, etc.

- [ ] **Step 6: Acceptance — measure tool result sizes**

Throughout the walk, observe each tool result's size. The acceptance bar: no result exceeds ~10% of the MCP wire cap (≈3.2k tokens / ~13k chars). Visible signal: no `tool result exceeds maximum allowed tokens` errors, no spill files in `tool-results/`.

If a result blows past 10%, that's a defect in the new shape — file as B-018 and stop. Otherwise continue.

- [ ] **Step 7: Walk to HG2 + HG3**

Same pattern: approve all Scripts (HG2), resume; approve all CreativeVariants (HG3), conductor parks at the final produce gate.

- [ ] **Step 8: Commit**

```bash
git add data/engineerdad.sqlite
git commit -m "chore(e-029): validation — fresh cold-start /loop-once to HG3 on new infra

E-029 acceptance test. Mint → tracking → analytics → synthesize →
brief → HG1 (UI approval × 12) → content → HG2 (UI approval × ~12) →
produce → HG3 (UI approval × ~48 variants). Zero tool-result overflow.
No spill files. The wire cap is no longer touchable at v1 scale."
```

---

## Task 19: Final build + test sweep

- [ ] **Step 1: Sequential build (never parallel)**

Run: `pnpm -r build`
Expected: every package builds clean.

- [ ] **Step 2: Full unit-test suite**

Run: `pnpm test`
Expected: every test green. Count: 477 (existing E-027 baseline) + ~15 new (filter + crud + compliance + mcp-store) = ~492. If fewer, something silently skipped.

- [ ] **Step 2b: Playwright E2E suite**

Run: `pnpm test:e2e`
Expected: 5 specs green (list seeded, list empty, detail-edit-persist, status-flip-persist, markdown-preview).

- [ ] **Step 3: Agent-sync gate**

Run: `pnpm sync:agents:check`
Expected: PASS.

- [ ] **Step 4: TypeScript strict gate**

Run: `pnpm -r typecheck`
Expected: clean across every package.

- [ ] **Step 5: Final commit (if anything moved)**

```bash
git status
# If clean, no commit needed. If anything moved (lockfile, sqlite touchups), commit.
```

---

## Self-review checklist

- [ ] **Spec §2 goal** — fresh cold-start `/loop-once` walks to HG3 without exceeding ~10% wire cap → Task 18 is the acceptance test.
- [ ] **Spec §5 target shape** — `packages/store`, `mcp-servers/store`, `apps/review-ui` all created (Tasks 1–13). Postgres in `docker-compose.yml`, bind-mounted to `./data/postgres/` (gitignored). Task 2 swaps the SQLite-shaped Task 1 scaffold to Postgres; Task 3 ports schemas as `pgTable`.
- [ ] **Spec §6 MCP surface** — 5 tools shipped (Task 8). `query` returns IDs only (Task 5 test "query never returns bulk text fields by default").
- [ ] **Spec §7 container shape** — `docker-compose.yml` with Postgres 16-alpine + init script for `engineerdad_test`; `pnpm store:up/down/wipe/push/logs` (Task 2).
- [ ] **Spec §8 stage touch-ups** — Task 10 covers brief, content, produce, schedule, experiment, distribute + verify-produce.
- [ ] **Spec §9 compliance boundary** — Task 6 + Task 5 (compliance fires in `crud.create`/`update`, refusal blocks the write).
- [ ] **Spec §10 review app** — Tasks 12–13 ship dashboard + list + detail + edit + status flip via server actions; **Task 14 ships Playwright E2E across every UIUX surface against `engineerdad_test` DB (2026-05-23 user direction).**
- [ ] **Spec §11 Postgres-native wins** — schema uses `jsonb`, `uuid`, `timestamp({withTimezone: true})`, `boolean` (Task 3).
- [ ] **Spec §12 files touched** — every entry has a task.
- [ ] **Spec §13 test plan** — packages/store unit tests against `engineerdad_test` DB with TRUNCATE-between-tests (Tasks 4–6), mcp-store tool tests (Task 8), stage tests stay green (Task 10 Step 7), Playwright UIUX (Task 14), e2e walk (Task 18).
- [ ] **Spec §15 open questions** — pinned in plan header; clean-slate + data-outside-git resolution recorded.
- [ ] **No placeholders** — every code block is complete; no "TODO" / "TBD"; no "similar to Task N" without showing the code.
- [ ] **Type consistency** — `EntityName`, `Filter`, `Crud`, `store` singleton names used identically across tasks 4–13. Playwright fixtures (Task 14) import the same `store` singleton.
