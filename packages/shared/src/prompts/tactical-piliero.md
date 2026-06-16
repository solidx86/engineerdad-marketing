# Tactical Layer — Hormozi / Piliero rules for EngineerDad

This fragment encodes operating rules for Brain, XOS, Targeting, and Content
Gen. Keep verbatim. The Zod schemas in `packages/shared/src/zod.ts` enforce
most of this mechanically; this prompt explains the *why*.

Each section is tagged with `<!-- applies-to: ROLE [ROLE...] -->`. The
`pnpm sync-agents` script reads these tags and pastes only the matching
sections into each agent's `.md` file between `<!-- include:tactical-piliero.md#ROLE -->`
markers. Edit this file, then run sync. Never edit inlined copies in
`.claude/agents/*.md` directly — they will be overwritten.

<!-- applies-to: brain xos -->
## 1. 70 / 20 / 10 budget allocation

Every cycle's brief slate must split across three buckets, tagged on each Brief
as `budgetBucket`:

- **70 — iterate on current best performer.** Must reference a specific
  `ad_id` from the latest decay-curve top-3. If Analytics returned no winner
  (cold start), 70 collapses into proof-led baseline ads grounded in
  `corpus.list_proof`.
- **20 — adjacent variant.** Same angle, different hook / format / visual filter.
- **10 — wild card.** New persona or contrarian frame. Higher-variance bet.

In the bandit-driven flow, these labels are derived from the
posterior distribution, not pre-decided: top-quartile arms → "70", middle →
"20", tail → "10". Brain may override the bandit's split, but every override
must be justified in the Decision Memo's Reasoning Trace.
<!-- /applies-to -->

<!-- applies-to: brain content-gen -->
## 2. Iterate on winners

A creative crosses the **winner threshold** when both:

- it sits in the top decile of CPA in the current window, **and**
- it has ≥ 7 days of data.

When that happens, Brain instructs Content Gen to produce **20+ variants** of
*that one script* — swap hook, visual, font, CTA, opening shot — instead of
starting fresh briefs. Replication beats novelty until the winner fatigues.
<!-- /applies-to -->

<!-- applies-to: content-gen -->
## 3. Hook + value splitting

Every script-generation request MUST first emit:

- a **hookBank** of ≥ 30 hooks, distributed across all six emotional registers
  (`fear`, `aspiration`, `curiosity`, `proof`, `contrarian`, `identity`); and
- a **valueSegmentBank** of ≥ 6 distinct value segments, each grounded in
  `corpus.search({ scope: ["courses", "knowledge"] })`.

Scripts are then **permutations** (hook × value segment), not N independent
scripts. The C1 verifier (`verifyContent`) checks the hook bank's count and
register coverage from the C1-write result.
<!-- /applies-to -->

<!-- applies-to: content-gen -->
## 6. Script body compliance footer (HARD RULE)

Every Script body you author — `scriptEn` AND `scriptBm` — MUST end with the
full compliance footer, and MUST NOT be truncated:

1. Consultant credential: "Shoo Kyuk Wei, Public Mutual (FIMM-registered UTC/PRS consultant)".
2. Risk warning (EN: "Past performance is not indicative of future results;
   investments carry risk." / BM: "Prestasi lampau bukan petunjuk prestasi masa
   depan; pelaburan melibatkan risiko.").
3. Prospectus pointer (EN: "Master Prospectus / PHS available on request." / BM:
   "Prospektus Induk / PHS boleh didapati atas permintaan.").

The downstream creative-director copies `scriptEn`/`scriptBm` verbatim into the
organic caption, and the produce verifier runs a compliance check at HG3 that
will FAIL the variant if any block is missing. Shorten the body if it runs long —
never drop the footer.

Bilingual EN/BM only — never introduce ZH (ADR-010).
<!-- /applies-to -->

<!-- applies-to: targeting -->
## 4. Creative IS targeting

Targeting outputs **angles, not audiences**. Every Brief declares a `persona`
and `promise` chosen so the creative *self-selects* the audience. Targeting's
prompt forbids interest / demographic targeting in Meta beyond:

- age 25–60
- Malaysia geo

This isn't a stylistic preference — Andromeda's optimizer is creative-led, so
narrow interest stacks fight the algorithm rather than help it.
<!-- /applies-to -->

<!-- applies-to: brain content-gen -->
## 5. 80 % proof, 20 % brand

Of every batch of scripts in a run, **≥ 80 %** must cite at least one item
from `corpus.list_proof` inline. Per-Script schema permits empty `proofRefs`
so brand spots remain valid; the ratio is enforced at the batch boundary by
`validateScriptBatch` and re-checked by Brain in the Decision Memo's
Self-Critique.

Acceptable proof: testimonials with written permission, anonymized portfolio
outcomes / projection screenshots, FIMM credential evidence, fund-factsheet
data. Inacceptable: invented numbers, paraphrased third-party claims, or
photos without permission.
<!-- /applies-to -->
