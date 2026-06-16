# Implementation Plan — Data-First Claim Binding

**Spec:** `docs/superpowers/specs/2026-06-02-data-first-claim-binding-design.html`
**Branch:** `feat/data-first-claim-binding` · **Closes** B-038 (P0), folds in B-036 · Mode C filed as sibling.

Phases are dependency-ordered. Each ends at a green test gate. Build sequentially (`pnpm -r build`, never `--parallel`). Keep `DATABASE_URL` on the branch sandbox before any test run.

---

## Phase 0 — Verify & de-risk (no code changes)

The two open code-facts from the spec gate everything downstream. Resolve them first.

- [ ] **0.1 Audit consumers of `corpus/data/*.json`.** `grep -rn "data/[a-z-]*\.json\|corpus/data/" mcp-servers packages apps corpus/templates .claude` (excl. `node_modules/dist/charts`). List every reader (path-based reads, prompt references, loaders). Output: a migration checklist of paths to update in Phase 1.6. If any consumer hardcodes a path, note it.
- [ ] **0.2 Determine `verify-content` gate semantics.** Read `packages/orchestrator/src/verifiers/verify-content.ts` + the content→HG2 stage builder. Confirm whether a per-script reject blocks the whole stage or the gate advances with the approved subset. Output: either "partial-advance already works" or a precise change for Phase 2.2.
- [ ] **0.3 Draft the ADR** `docs/decisions/ADR-0XX-data-first-claim-binding.md` (number = next free). Capture the doctrine, the locus decision, the three enforcement layers, the two-layer data model, and the amendments list. Mark **Proposed**. (Finalized in Phase 6.)

**Gate:** migration checklist + gate-semantics answer written into the ADR's context section.

---

## Phase 1 — Data model & two-layer foundation

- [ ] **1.1 Schema.** Add `claim_bindings jsonb` (default `[]`, not null) to `scripts` in `schema.ts`. Run `pnpm db:sandbox` then `pnpm db:generate`; commit `schema.ts` + generated `packages/*/drizzle/` together (`pnpm lint:migrations`).
- [ ] **1.2 Zod.** Add `ClaimBindingSchema` to `packages/shared/src/zod.ts` (`claim`, `kind` enum, `chartRef` nullable, `figures` string[], `takeaway`, `gapNote` nullable) with refinements: `kind:data ⇒ chartRef set`; `kind:gap ⇒ gapNote set, chartRef null`; `kind:qualitative ⇒ chartRef null`. Wire onto the Script shape. Unit tests for each refinement.
- [ ] **1.3 Numeric-normalize util.** New `packages/shared/src/numeric/normalize.ts` — parse `RM`/`k`/`M`/`%`/`age N`/plain into a canonical number; expose `tracesTo(figure, haystackNumbers, tol)`. Thorough table-driven tests (RM1.2M→1_200_000, "age 60"→60, "41%"→0.41, rounding tolerance).
- [ ] **1.4 Chart-metadata loader.** New util that reads a chart YAML and returns `{id, title, scenario, labels, valueRanges, source_citation}`. Tests over 2–3 real YAMLs.
- [ ] **1.5 `corpus.list_charts` MCP.** Add tool to `mcp-servers/corpus` + `packages/corpus/src/tools.ts` — **live `readdir`** of `corpus/data/charts/`, map each through the loader (1.4). NOT backed by the BM25 index. Tests.
- [ ] **1.6 `datasets/` rename.** `git mv corpus/data/*.json corpus/data/datasets/`. Update every consumer from the 0.1 checklist. Add the **provenance contract** to the chart-metadata expectations (new charts cite a dataset path; existing grandfathered). Re-run any touched tests.

**Gate:** `pnpm -r build` clean; new unit suites green; `db:sandbox` applied.

---

## Phase 2 — Authoring (content-writer, stays Sonnet)

- [ ] **2.1 Prompt: step 4d + internal QA.** Edit `packages/shared/src/prompts/*` content-writer fragment: add the claim-binding step (enumerate financial-outcome claims → match via `list_charts` → `data`/`qualitative`/`gap`; author numbers from the YAML; never mis-pair) and the **mandatory pre-emit internal-QA** stanza (mirror the hook-bank self-check). Persist `claim_bindings` on each Script write + in the C1 step-result payload. `pnpm sync:agents`; verify with `pnpm sync:agents:check`.
- [ ] **2.2 C1 validator.** In `verify-content.ts`: (a) **hard** — every `data` binding → real chart id + `figures` trace to YAML (uses 1.3/1.4); (b) **soft** — numeric-token coverage scan over the body minus the **incidental allowlist** (footer, age 25–60, durations, dates, step counts, CTA) → flag to HG2. Apply the Phase-0.2 partial-advance change if needed. Table-driven tests incl. the B-038 fixture (RM1.2M vs `inflation-vs-savings` → fail).

**Gate:** `verify-content` tests green incl. B-038 regression; sync check passes.

---

## Phase 3 — Staging enforcement (CD + P1 verifier)

- [ ] **3.1 Prompt: CD pinned to bindings.** Edit creative-director fragment: **delete** the Step-3c global chart inventory list; replace with "use ONLY the Script's `data` bindings; `explains := binding.takeaway`". Add CD self-QA before emit. `pnpm sync:agents`.
- [ ] **3.2 Render-worker prompts.** Remove the inline global inventory list from `corpus/templates/worker-prompts/reel-render-worker.md` + `render-worker.md`; cite "bound chartRefs only / missing → hard fail" (keep existing missing-file behavior).
- [ ] **3.3 P1 verifier.** In `verify-produce.ts`: plumb per-script `claim_bindings` into inputs; assert for **every** scene (all formats incl. Carousel/Feed) with a `chartRef`: ref ∈ Script `data` bindings (else reject); `explains` references bound figures/takeaway; concept visual (visualBrief, null chartRef) has **no digits** (folds in B-036). Tests incl. both B-038 (carousel + reel) and B-036 fixtures.

**Gate:** `verify-produce` tests green; B-038 + B-036 both blocked; sync check passes.

---

## Phase 4 — Gap-fill utility (`/chart-gap` + `chart-author`)

- [ ] **4.1 Agent.** New `.claude/agents/chart-author.md` — model TBD (lean Opus). Tools: `Read`, `WebFetch`, `WebSearch`, `Bash`, `Write`, `static-renderer`, `store`. Procedure: read gap flags → understand the missing data → ingest human-supplied source → **persist a dataset JSON first** → derive N chart YAML(s) citing it → write to `_pending/` + render preview. Honesty: `verification_status` for image-derived series.
- [ ] **4.2 Command.** New `.claude/commands/chart-gap.md` — human-invoked, out-of-loop. Surfaces open gaps (query Scripts where `claim_bindings.kind = gap`), takes source inputs, dispatches `chart-author`, presents candidates for CLI approval.
- [ ] **4.3 Promote + re-bind.** A deterministic helper (script or store action): move `_pending/` → `corpus/data/{datasets,charts}/`, then UPDATE the held Script's binding `gap → data` (set chartRef/figures/takeaway) and re-run the C1 figures-trace. **No reindex.** Tests for the re-bind transition (gap→data → C1 passes).

**Gate:** end-to-end dry-run on the B-038 gap (supply the EPF-drawdown source → dataset+chart authored → re-bind → script data-bound); promote/re-bind tests green.

---

## Phase 5 — Webapp HG2 surface

- [ ] **5.1 Bindings display.** HG2 Script review page renders `claim_bindings`: each claim → bound chart (title + figures + source + lightweight preview), or a **⛔ gap badge**.
- [ ] **5.2 Held state + partial advance.** Visible Held badge on gap-bearing scripts; gate advances the non-gap subset to produce while gap scripts park. (Reuse `Awaiting Approval` + gap flag unless 0.2 calls for an explicit status.)

**Gate:** manual walk on a seeded run — gap script shows Held; non-gap scripts approvable + flow to produce.

---

## Phase 6 — Docs & close-out

- [ ] **6.1 ADR → Accepted**; link from `ARCHITECTURE.md` *Where doctrine lives*.
- [ ] **6.2 ARCHITECTURE.md** — add the two-layer data model (`datasets/` JSON facts vs `charts/` YAML specs + provenance contract); note the data-first binding chain.
- [ ] **6.3 brand-contract §9** — note the concept-no-digits boundary is now structurally enforced (B-036).
- [ ] **6.4 TASKS.md / DONE.md** — close B-038 + B-036; retain IDs; refresh Status header. File the Mode-C sibling as a new entry.
- [ ] **6.5 Full suite** — `pnpm test` green; `pnpm sync:agents:check`; `pnpm lint:migrations`.

**Gate:** suite green; PR opened to `main`.

---

## Sequencing & risk notes

- **Phase 0 is mandatory first** — both code-facts can reshape Phases 1.6 and 2.2.
- Phases 2 and 3 can be reviewed independently but 3 depends on 1 (bindings exist) and is best after 2.
- Phase 4 depends on 1 (datasets/ + schema) and 2 (gap flags exist) but is independent of 3/5.
- **DB discipline:** branch sandbox before tests; commit `schema.ts` + generated drizzle together.
- **Defaults to confirm on review** (from spec §15): Sonnet for content-writer; Held = status+flag; CLI candidate review; grandfather the 16 YAMLs; `chart-author` model.
