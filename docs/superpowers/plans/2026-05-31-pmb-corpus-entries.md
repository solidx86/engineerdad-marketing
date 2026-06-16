# PMB Corpus Entries — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author ~40 PMB-specific knowledge entries into `corpus/knowledge/`, tagged with the ADR-029 frontmatter schema, so downstream agents (brain, brief-writer, content-writer, creative-director) can surface deeper-than-DCA technical content.

**Architecture:** Pure content authoring — markdown files only, no code. Each entry follows the `corpus/knowledge/README.md` convention: YAML frontmatter (`cluster`, `granularity`, `source_type`, `source_ref`, `verified_at`, `lang_status`, `related`) + a sourcing/disclaimer blockquote + a `## English` body. After each phase, reindex via the corpus MCP and verify the entries are chunked with correct tags.

**Tech Stack:** Markdown, the `@engineerdad/corpus` reindex pipeline (already shipped via ADR-029), `mcp__corpus__reindex` / `mcp__corpus__search`.

**Spec reference:** `docs/superpowers/specs/2026-05-29-pmb-corpus-expansion-design.html`.

---

## Authoring Doctrine (applies to every entry)

These are hard rules. Every task inherits them; a reviewer rejects entries that break them.

1. **EN ships first.** `lang_status: en_only` on first commit. BM is a later pass (not in this plan).
2. **Proof discipline.** Every entry carries at least one of: a real PMB factsheet/fund-code worked example, a prospectus/trust-deed clause citation, or an LHDN/FIMM/SC reference. No generic "unit trusts in general…" hedging.
3. **Honesty on figures (`source_type: public`).** Author using best-known *public* PMB/LHDN figures. Put the document in `source_ref`. **Do NOT invent precise numbers as if confirmed.** Where an exact current figure (a specific sales-charge %, a switching fee in RM, a relief cap) is used, it is the author's best public knowledge and must be flagged for Shoo to confirm in PR review (trust + spot-check, per spec §10). Use the sourcing blockquote to say so explicitly, e.g. *"Figures reflect publicly published PMB/LHDN schedules as of <date>; consultant to confirm current values."*
4. **`source_type: synthesized` framing.** Scenario entries are plausible patterns, **never** real client cases. The body must use "imagine / a parent who / scenario / example" language. Never "my client" or "a client of ours."
5. **Hook density (concept entries).** Each `granularity: concept` entry must contain **≥4 standalone "I didn't know that" facts** — single-claim, single-stat, or single-mechanic surprises, formatted as bullet points so content-writer can lift them. If an entry can't yield 4, it isn't technical enough — deepen it or merge.
6. **Bilingual register note.** EN body leans technical/analytical (the engineer-parent). No ZH ever (ADR-010).
7. **Filename = slug.** Kebab-case, cluster-prefixed where helpful (e.g. `a-switching-matrix.md`, `b-relief-stacking.md`, `c-reading-a-factsheet.md`, fund instances `fund-pmittf.md`). The slug is the ID used in other entries' `related:` lists.
8. **Disclaimer blockquote.** Mirror the house style in `corpus/proof/epf-shortfall-cases.md`: a leading `>` block stating what's sourced, what's illustrative, and that nothing is personalised advice.

---

## File Structure

All files created under `corpus/knowledge/`. Delete `_example.md` in the final task.

```
corpus/knowledge/
  # Phase 1 — primitives
  glossary.md
  compliance-claim-phrasebank.md
  proof-asset-index.md
  # Phase 2 — Cluster A (mechanics)
  a-fee-schedule.md
  a-switching-matrix.md
  a-sales-charge-math.md
  a-nav-cutoff-settlement.md
  a-distribution-mechanics.md
  a-trust-deed-prospectus-map.md
  a-bid-offer-retirement.md
  a-scenario-double-charged.md        # synthesized
  # Phase 3 — Cluster B (tax / PRS)
  b-relief-stacking.md
  b-prs-withdrawal-mechanics.md
  b-prs-default-vs-self-select.md
  b-prs-estate-nomination-hibah.md
  b-self-employed-contribution-math.md
  b-scenario-relief-stack.md          # synthesized
  # Phase 4 — Cluster C (portfolio)
  c-reading-a-factsheet.md
  c-fund-family-taxonomy.md
  c-risk-metric-glossary.md
  c-shariah-vs-conventional.md
  c-currency-exposure.md
  c-rebalance-without-charges.md
  # Phase 4b — fund-level instances (granularity: fund)
  fund-pmittf.md
  fund-pmgf.md
  fund-pmbf.md
  fund-pm-shariah-equity.md
  fund-pm-bond.md
  # (extend to the funds Shoo actively recommends — target ~5 to start)
```

Target ~25 strong entries in this plan (primitives 3 + A 8 + B 6 + C 6 + funds ≥5 ≈ 28). The spec's ~40 includes BM versions and a deeper factsheet archive that grow in later passes. ±20% is acceptable per spec §10.

---

## Task 1: Phase 1 — Primitives

**Files:**
- Create: `corpus/knowledge/glossary.md`
- Create: `corpus/knowledge/compliance-claim-phrasebank.md`
- Create: `corpus/knowledge/proof-asset-index.md`

- [ ] **Step 1: Write `glossary.md`**

Frontmatter:
```yaml
---
cluster: primitive
granularity: concept
source_type: public
source_ref: "FIMM/SC investor glossary; PMB Master Prospectus definitions section"
verified_at: 2026-05-31
lang_status: en_only
related: [a-fee-schedule, a-bid-offer-retirement, a-nav-cutoff-settlement]
---
```
Body (`## English`): a definition list of ≥12 terms in the parent-investor's path, each 1–2 sentences, each ending with how it shows up on a PMB statement where relevant. Required terms: NAV, unit, bid-offer spread (and why it's retired), sales charge, switching fee, redemption, distribution (vs dividend), reinvestment, annual management fee, trustee fee, ex-date, T+ settlement. This is a concept entry → it inherently exceeds the ≥4-fact bar via the definitions; ensure at least 4 of them carry a non-obvious "I didn't know that" clause (e.g. "distribution is not a gain — your NAV drops by the distributed amount on ex-date").

- [ ] **Step 2: Write `compliance-claim-phrasebank.md`**

Frontmatter `cluster: primitive`, `source_type: public`, `source_ref: "SC Malaysia guidelines on advertising; FIMM Code; corpus/compliance/*"`. Body: two lists — **Claimable** (e.g. "past performance is not indicative of future results", how to cite a factsheet figure, how to phrase relief amounts) and **Non-claimable / banned** (guaranteed returns, "risk-free", advice without risk profiling, implying capital protection on equity funds). Cross-reference `corpus/compliance/public-mutual.md`. This entry is what content-writer leans on to keep anger/fear-register hooks compliant.

- [ ] **Step 3: Write `proof-asset-index.md`**

Frontmatter `cluster: primitive`, `granularity: concept`, `source_type: public`. Body: a registry table of what proof assets exist and where — columns: asset, type (factsheet | prospectus clause | calculator output | data file), location/path, what claims it can back. Seed it with the existing `corpus/proof/*` and `corpus/data/*` assets plus the fund-level entries this plan creates. This is the map brief-writer uses to pick a proof type per Brief.

- [ ] **Step 4: Reindex + verify**

Call `mcp__corpus__reindex`. Then `mcp__corpus__search` with `{ query: "NAV distribution ex-date", scope: ["knowledge"], cluster: "primitive" }` and confirm `glossary.md` appears with `cluster: "primitive"`.

- [ ] **Step 5: Commit**

```bash
git add corpus/knowledge/glossary.md corpus/knowledge/compliance-claim-phrasebank.md corpus/knowledge/proof-asset-index.md
git commit -m "feat(corpus): knowledge primitives — glossary, compliance phrasebank, proof index"
```

---

## Task 2: Phase 2 — Cluster A mechanics (concept entries)

**Files:** `a-fee-schedule.md`, `a-switching-matrix.md`, `a-sales-charge-math.md`, `a-nav-cutoff-settlement.md`, `a-distribution-mechanics.md`, `a-trust-deed-prospectus-map.md`, `a-bid-offer-retirement.md`

All `cluster: mechanics`, `granularity: concept`, `source_type: public` (except where noted), `lang_status: en_only`. Each MUST carry ≥4 standalone facts as bullets.

- [ ] **Step 1: `a-fee-schedule.md`** — full PMB fee table: sales charge by fund class (equity/balanced/bond/Shariah), switching fee, redemption fee, annual management fee, trustee fee. `source_ref` = PMB Master Prospectus fees section. Flag exact figures for Shoo confirmation in the blockquote. ≥4 facts (e.g. "bond funds carry a lower sales charge than equity"; "switching inside a family is cheaper than redeem-then-buy").

- [ ] **Step 2: `a-switching-matrix.md`** — intra-family vs cross-family switching rules; the "redeem then re-buy pays the sales charge twice" trap; same-fund-family swap mechanics; NAV used for the switch. `related: [a-fee-schedule, a-nav-cutoff-settlement, a-scenario-double-charged]`. ≥4 facts.

- [ ] **Step 3: `a-sales-charge-math.md`** — 5.5%-upfront vs annual-fee drag over 5/10/20-year horizons; break-even framing; why upfront can beat a higher trailing fee on long horizons. Worked example with a fund code. Mark the model assumptions in the blockquote (illustrative). ≥4 facts.

- [ ] **Step 4: `a-nav-cutoff-settlement.md`** — forward pricing, the daily NAV cutoff time, T+ settlement for buy/switch/redeem, why the price you get isn't today's published NAV. ≥4 facts.

- [ ] **Step 5: `a-distribution-mechanics.md`** — ex-date vs payment date, NAV drops by the distributed amount on ex-date, auto-reinvest NAV rule, why "distribution" ≠ profit. `related: [glossary]`. ≥4 facts.

- [ ] **Step 6: `a-trust-deed-prospectus-map.md`** — which document binds what: trust deed vs master prospectus vs product highlight sheet vs fund factsheet; where charges, switching rights, and suspension clauses actually live. `source_ref` cites the document hierarchy. ≥4 facts.

- [ ] **Step 7: `a-bid-offer-retirement.md`** — bid-offer spread is retired; single-NAV pricing replaced it; why older statements/articles still mention it; what the parent sees now. ≥4 facts.

- [ ] **Step 8: Reindex + verify** — `mcp__corpus__reindex`, then `mcp__corpus__search` `{ query: "switching fee twice sales charge", scope: ["knowledge"], cluster: "mechanics" }`; confirm `a-switching-matrix.md` returns with `cluster: "mechanics"`.

- [ ] **Step 9: Commit**
```bash
git add corpus/knowledge/a-*.md
git commit -m "feat(corpus): Cluster A mechanics concept entries (7)"
```

---

## Task 3: Phase 2b — Cluster A synthesized scenario

**Files:** `corpus/knowledge/a-scenario-double-charged.md`

- [ ] **Step 1: Write the scenario** — `cluster: mechanics`, `granularity: concept`, `source_type: synthesized`, `related: [a-switching-matrix, a-fee-schedule]`. Body: an *imagined* parent who redeemed one PMB equity fund to buy another and paid the sales charge twice, vs the intra-family switch path. Use "Imagine a parent who…" framing throughout. Show the ringgit difference as an illustrative worked example (assumptions stated). This is the hook-seed across fear/anger/curiosity registers.

- [ ] **Step 2: Verify framing** — confirm no "client" language; all hypothetical. Reindex.

- [ ] **Step 3: Commit**
```bash
git add corpus/knowledge/a-scenario-double-charged.md
git commit -m "feat(corpus): Cluster A synthesized scenario — double-charged switch"
```

---

## Task 4: Phase 3 — Cluster B tax / PRS

**Files:** `b-relief-stacking.md`, `b-prs-withdrawal-mechanics.md`, `b-prs-default-vs-self-select.md`, `b-prs-estate-nomination-hibah.md`, `b-self-employed-contribution-math.md`, `b-scenario-relief-stack.md` (synthesized)

All `cluster: tax`, `lang_status: en_only`. Concept entries `granularity: concept` with ≥4 facts. `source_ref` cites LHDN relief schedules / PPA (Private Pension Administrator) rules / SC PRS guidelines. Flag exact RM caps for Shoo confirmation.

- [ ] **Step 1: `b-relief-stacking.md`** — the RM3,000 PRS relief and how it stacks with EPF/life-insurance relief, SSPN, education, medical; which share a cap and which are separate; the LHDN line items. ≥4 facts. `related: [b-self-employed-contribution-math]`.

- [ ] **Step 2: `b-prs-withdrawal-mechanics.md`** — pre-55 8% penalty (tax on withdrawal), exemptions (death, permanent departure, healthcare, housing per current rules), the opportunity-cost frame of withdrawing early. ≥4 facts.

- [ ] **Step 3: `b-prs-default-vs-self-select.md`** — the regulatory default-option glide path by age band (growth/moderate/conservative) vs self-selected funds; how Public Mutual's PRS series maps; when default under-serves a young parent. ≥4 facts.

- [ ] **Step 4: `b-prs-estate-nomination-hibah.md`** — PRS nomination vs UT nomination, interaction with hibah and faraid for Muslim parents, what passes outside the estate. `source_ref` cites PPA nomination rules. ≥4 facts. (This entry's BM version later carries extra weight — note that.)

- [ ] **Step 5: `b-self-employed-contribution-math.md`** — for gig/self-employed parents: EPF i-Saraan voluntary vs PRS vs straight EPF voluntary; income brackets where each wins on tax + matching. ≥4 facts.

- [ ] **Step 6: `b-scenario-relief-stack.md`** (`source_type: synthesized`) — an *imagined* dual-income couple optimising their combined reliefs across PRS + SSPN + insurance. "Imagine a household…" framing. Illustrative figures.

- [ ] **Step 7: Reindex + verify** — search `{ query: "PRS relief RM3000 stacking EPF", scope: ["knowledge"], cluster: "tax" }`; confirm `b-relief-stacking.md`.

- [ ] **Step 8: Commit**
```bash
git add corpus/knowledge/b-*.md
git commit -m "feat(corpus): Cluster B tax/PRS entries (6)"
```

---

## Task 5: Phase 4 — Cluster C portfolio (concept entries)

**Files:** `c-reading-a-factsheet.md`, `c-fund-family-taxonomy.md`, `c-risk-metric-glossary.md`, `c-shariah-vs-conventional.md`, `c-currency-exposure.md`, `c-rebalance-without-charges.md`

All `cluster: portfolio`, `granularity: concept`, `source_type: public`, `lang_status: en_only`, ≥4 facts. `source_ref` cites PMB factsheets / fund prospectuses.

- [ ] **Step 1: `c-reading-a-factsheet.md`** — how to read a PMB factsheet like an analyst: what Sharpe, std dev, top-10 holdings, sector weights, and the benchmark line each actually tell you. ≥4 facts.

- [ ] **Step 2: `c-fund-family-taxonomy.md`** — PMB's actual fund classification (equity / balanced / fixed income / Shariah / regional / global) with representative fund codes per class. `related: [fund-pmittf, fund-pmgf, fund-pmbf, fund-pm-shariah-equity, fund-pm-bond]`. ≥4 facts.

- [ ] **Step 3: `c-risk-metric-glossary.md`** — Sharpe, std dev, beta, max drawdown, tracking error — defined and tied to the language on a PMB statement/factsheet. ≥4 facts.

- [ ] **Step 4: `c-shariah-vs-conventional.md`** — Shariah vs conventional pairs: screening criteria, fee differential, tracking error, when the Shariah variant is structurally advantaged. ≥4 facts.

- [ ] **Step 5: `c-currency-exposure.md`** — the hidden MYR/USD/regional currency bet inside global/regional PMB funds; how FX moves swamp fund alpha; where the factsheet shows (or hides) it. ≥4 facts.

- [ ] **Step 6: `c-rebalance-without-charges.md`** — the legal intra-family route to rebalance a PMB portfolio without re-paying sales charges; ties to `a-switching-matrix`. `related: [a-switching-matrix]`. ≥4 facts.

- [ ] **Step 7: Reindex + verify** — search `{ query: "Sharpe ratio factsheet PMB", scope: ["knowledge"], cluster: "portfolio" }`; confirm `c-reading-a-factsheet.md`.

- [ ] **Step 8: Commit**
```bash
git add corpus/knowledge/c-*.md
git commit -m "feat(corpus): Cluster C portfolio concept entries (6)"
```

---

## Task 6: Phase 4b — Fund-level instances

**Files:** `fund-pmittf.md`, `fund-pmgf.md`, `fund-pmbf.md`, `fund-pm-shariah-equity.md`, `fund-pm-bond.md` (use the exact fund codes/names Shoo actively recommends — adjust slugs to match real funds).

All `cluster: portfolio`, `granularity: fund`, `source_type: public`, `lang_status: en_only`. `source_ref` = the specific fund's latest factsheet + quarter. These are the *proof layer* — each is a structured one-fund fact sheet that concept entries cite.

- [ ] **Step 1: Per-fund template** — for each fund, body carries: full name + code, asset class, inception, benchmark, sales charge & annual fee (from `a-fee-schedule`), risk metrics (Sharpe/std dev/max drawdown — latest available, flagged for Shoo confirmation), top sectors/holdings shape, currency exposure note, and a one-line "what this fund is for" framing. **Figures are last-known public factsheet values; the blockquote states the quarter and that the consultant confirms current numbers.** If the user has a FundMaster Excel (from the fund-screener skill), prefer those figures and cite it in `source_ref`.

- [ ] **Step 2: Cross-link** — each fund's `related:` points back to `c-fund-family-taxonomy` and any concept entry that uses it as an example. Update `proof-asset-index.md` to list these fund entries.

- [ ] **Step 3: Reindex + verify** — search `{ query: "<one fund name>", scope: ["knowledge"], granularity: "fund" }`; confirm the fund entry returns with `granularity: "fund"`.

- [ ] **Step 4: Commit**
```bash
git add corpus/knowledge/fund-*.md corpus/knowledge/proof-asset-index.md
git commit -m "feat(corpus): fund-level instances (proof layer) + proof index update"
```

---

## Task 7: Final reindex, cleanup, integration check

- [ ] **Step 1: Remove the placeholder** — delete `corpus/knowledge/_example.md` (its README purpose is served now).
```bash
git rm corpus/knowledge/_example.md
```

- [ ] **Step 2: Full reindex** — call `mcp__corpus__reindex`. Record files + chunk count + any `skipped`. Expected: 0 skipped among `knowledge/*.md`.

- [ ] **Step 3: Filter smoke** — run these searches and confirm non-empty, correctly-tagged hits:
  - `{ query: "switching fee", scope: ["knowledge"], cluster: "mechanics" }`
  - `{ query: "PRS relief", scope: ["knowledge"], cluster: "tax" }`
  - `{ query: "Sharpe", scope: ["knowledge"], cluster: "portfolio" }`
  - `{ query: "imagine parent double charged", scope: ["knowledge"], source_type: "synthesized" }` → returns the scenario entries only
  - `{ query: "fund", scope: ["knowledge"], granularity: "fund" }` → returns only fund-level entries

- [ ] **Step 4: Hook-density audit** — for every `granularity: concept` entry, confirm ≥4 bulleted standalone facts. List any that fall short; fix before final commit.

- [ ] **Step 5: Honesty audit** — grep for accidental real-case language in synthesized entries:
```bash
grep -rliE "my client|our client|a client of" corpus/knowledge/ && echo "FOUND — fix" || echo "clean"
```
Expected: `clean`.

- [ ] **Step 6: Commit index + cleanup**
```bash
git add -A corpus/
git commit -m "chore(corpus): final reindex + remove _example placeholder"
```

---

## Self-Review Summary

**Spec coverage:**
- §3 Cluster A (mechanics) → Tasks 2–3 ✓
- §3 Cluster B (tax/PRS) → Task 4 ✓
- §3 Cluster C (portfolio) → Tasks 5–6 ✓
- §3 Primitives (glossary, compliance phrasebank, proof index) → Task 1 ✓
- §4 Artifact shape (frontmatter, both granularities) → every task; fund-level in Task 6 ✓
- §5 Sequencing (primitives → A → B → C) → task order ✓
- §6 Hook-extraction (≥4 facts) → doctrine #5 + Task 7 audit ✓
- §7 Proof discipline → doctrine #2 ✓
- §10 EN-first, public+synthesized only, trust+spot-check → doctrine #1,#3,#4 ✓

**Out of scope (correct):** BM bodies (later pass), staleness policy, downstream article/hook generation.

**Honesty guardrail:** doctrine #3 + Task 7 Step 5 prevent (a) fabricated precise figures presented as confirmed, and (b) synthesized scenarios masquerading as real cases. Shoo's PR review is the spot-check gate.
