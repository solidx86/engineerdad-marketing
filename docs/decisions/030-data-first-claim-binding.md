# ADR-030 — Data-First Claim Binding

**Status:** Accepted (2026-06-02)
**Branch:** `feat/data-first-claim-binding`
**Closes:** B-038 (P0); folds in B-036 (concept-visual figure leak). Mode C (narrative-flow drift) filed as a sibling.
**Spec:** `docs/superpowers/specs/2026-06-02-data-first-claim-binding-design.html`
**Plan:** `docs/superpowers/plans/2026-06-02-data-first-claim-binding.md`

## Context

A quantitative financial claim in a Script ("RM1.2M by retirement", "41% income
replacement") must ship with a chart that actually depicts *that* claim's
scenario and numbers. Today it does not, and the failure is structural:

- **The binding is born at the wrong place.** `chartRef` is created at
  **creative-director** (post-HG2) by reverse-engineering from the Script prose
  via topical adjacency — the CD picks the closest-sounding chart from a global
  16-chart inventory pasted into its prompt. The Script itself carries **no
  link** to any dataset. So the human at HG2 reviews prose with no bound
  evidence, and the CD guesses afterward. B-038 is exactly this: a script claim
  paired with `inflation-vs-savings-real-value.yaml`, whose numbers describe a
  different scenario.
- **Concept visuals leak figures.** B-036: a concept-visual `visualBrief`
  (which has no chart) still gets digits written into it, implying data that
  was never bound.
- **There is no enforcement.** `verify-produce` checks only structure (variant
  count, file non-emptiness, channel spec, compliance footer, cost) — zero
  semantic chart checks. Nothing proves a chart's numbers trace to the claim.

EngineerDad is data-driven: a number on screen is a promise that a vetted
dataset backs it. The fix is to move the claim↔data binding **upstream to where
the claim is authored**, review it at the human gate, execute it (never
re-derive it) downstream, and enforce it deterministically.

### Phase-0 findings (verified in code, 2026-06-02)

1. **Rename safety — consumers of `corpus/data/*.json`.** No source under
   `mcp-servers/ packages/ apps/` reads the root JSONs by path. The only code
   consumers are two build scripts:
   - `scripts/build-derivative-tables.mjs:61` — `dataDir = corpus/data`, writes
     `compounding-table.json` + `monthly-contribution-required.json`.
   - `scripts/harvest-epf-simulations.mjs:25,52` — `OUTPUT_PATH` =
     `corpus/data/epf-sustainability-simulations.json`; reads
     `corpus/data/kwsp-ria-benchmarks.json`.

   Prose citations also name the JSON paths in `corpus/proof/epf-shortfall-cases.md`
   and `corpus/courses/epf-sustainability-model.md` (human-readable references;
   update for accuracy, low-risk). The `corpus/data/charts/` YAMLs and every
   prompt reference to them are **unaffected** — the rename only moves the root
   JSONs into `corpus/data/datasets/`; `charts/` stays put.

   → Phase 1.6 migration list: those two scripts (one path const + one
   `dataDir`), plus the two prose files for accuracy.

2. **Partial-advance already works — no orchestrator change needed.** The HG2
   gate (`stages/content.ts` `c3Gate`) clears on `Scripts where
   approvalStatus = "Approved"` having `rows > 0` — it does **not** require all
   scripts approved. A gap/held script left un-approved simply never enters the
   approved set, so it does not flow to produce while its siblings do. "Held" is
   therefore a **UI/status surface**, not a gate-mechanics change.

   → Phase 2.2 "apply partial-advance change if needed" → **not needed**.
   → Phase 5.2 "gate advances the non-gap subset" → **already true**; the webapp
     only needs to *surface* Held and support per-script approval.

   Note: a **hard** C1 failure (a `data` binding whose figures don't trace)
   fails the whole `C1-fanout` step and forces a re-spawn/fix — this is correct;
   a *gap* is a legitimate `kind`, not a failure, so gap scripts pass C1 and are
   merely held at HG2.

## Decision

**Doctrine — data-first claim binding.** A quantitative financial claim ships a
chart-backed visual **only if** a vetted dataset depicts that claim's
scenario + numbers. The binding is **authored where the claim is authored**
(content-writer), **reviewed at HG2**, **executed — never invented — by
creative-director**, and **enforced by verifiers**.

### Locus

The claim↔data binding is created at **content-writer** and persisted on the
Script (new `claim_bindings` jsonb column), not invented downstream at CD.

### ClaimBinding

Per quantitative claim: `{ claim, kind: data|qualitative|gap, chartRef,
figures[], takeaway, gapNote }`.

- `kind:data` — a dataset/chart depicts the claim ⇒ `chartRef` set, `figures`
  trace to the chart.
- `kind:qualitative` — the statement asserts no financial number ⇒ no chart.
- `kind:gap` — the claim asserts a number but no dataset depicts it yet ⇒
  **held**; `gapNote` set, `chartRef` null. **No reword-to-keep-the-number
  escape.**

### Gap = HELD (data-first)

A gap claim parks its Script at HG2 until the dataset is authored, then re-binds
to `data`. Non-gap siblings flow (partial advance — already supported, see
finding 2).

### Three enforcement layers

0. **content-writer internal QA** — mandatory pre-emit self-check (mirrors the
   hook-bank self-check pattern).
1. **C1 deterministic validator** (`verify-content`) — **hard:** every `data`
   binding → real chart id + `figures` trace to the YAML; **soft:** numeric
   coverage scan over the body minus an incidental allowlist (footer, ages
   25–60, durations, dates, step counts, CTA) → flag to HG2.
2. **P1 produce verifier** (`verify-produce`) — for **every** scene with a
   `chartRef` (all formats incl. Carousel/Feed): ref ∈ Script `data` bindings;
   `explains` references the bound figures/takeaway; concept visual (null
   chartRef) has **no digits** (folds in B-036).

**LLM/code split:** the LLM reasons *which* statements are claims and *picks*
the chart; code *proves* figures trace and *catches* misses.

### Two-layer data model

- `corpus/data/datasets/*.json` — facts / source-of-record (provenance-rich,
  many-views). *(rename of today's `corpus/data/*.json`.)*
- `corpus/data/charts/*.yaml` — one derived bilingual captioned visualization.
- **Provenance contract:** each chart YAML's `source_citation` names its
  upstream dataset path. New charts must cite; the existing 16 are grandfathered.

### Gap-fill = `/chart-gap` (human-invoked utility, out-of-loop)

A new `chart-author` subagent ingests human-supplied source (PDF/Excel/image/
text/URL), **persists a dataset JSON first**, derives N chart YAML(s) citing it,
stages to `_pending/` with a render preview for human approval, then on promote
moves the files into `datasets/` + `charts/` and re-binds the held Script's
claim `gap → data` (re-running the C1 figures-trace). **No reindex** — the
corpus BM25 index covers `.md/.txt/.vtt/.pdf` only; charts/datasets are read by
path, never indexed.

## Amendments

- **ADR-022** (claim-check worker output) — the Script claim-check now carries
  `claim_bindings`.
- **ADR-029** (reel visual scenes) — reel scene `chartRef` must resolve to a
  bound `data` claim.
- Supersedes the CD-side "pick from global inventory" step (Step-3c list
  deleted from the creative-director prompt; CD uses only the Script's `data`
  bindings).

## Consequences

- Human at HG2 reviews each claim *with* its bound chart (or a gap badge) — the
  evidence is visible at decision time.
- Mis-pairing (B-038) and concept-visual figure leak (B-036) become
  deterministically blockable, not reliant on CD taste.
- Ungroundable claims get dropped or held — a truth-check side-effect.
- Cost: content-writer does more work per script; a new jsonb column; a new
  subagent + command; webapp HG2 surface for bindings + Held.
