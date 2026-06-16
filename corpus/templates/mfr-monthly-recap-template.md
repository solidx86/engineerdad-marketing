---
quote: "Every Monthly Fund Review post follows the same skeleton — methodology first, leaderboard never, compliance always."
attribution: "EngineerDad author guide — MFR monthly recap structure"
permission_status: public
persona: all
---

# MFR Monthly Recap Template

> Structural template for the monthly Monthly Fund Review (MFR) carousel, reel, or article. It fixes the section order, the required numbers, the disclaimer block, and the call-to-action shape so every month's recap is consistent and verifiable. Pairs with `corpus/courses/mfr-framework.md` (the philosophy) and `corpus/courses/weighted-alpha-scoring.md` (the rubric). EN only — author-facing.

> Note — an earlier draft of this template included an "Anomaly" section sourced from `corpus/proof/fund-anomaly-cases.md`. That artifact is deferred from this iteration. When it lands, insert the Anomaly section between "Aggregate state" and "Sector / geo pulse".

## Section order

A recap runs these sections in this order. Carousel: roughly one card per section. Reel: same beats, compressed. Article: same headings.

### 1. Hook

One line that states the month's headline result and nothing else. Pattern: *"Of [N] Public Mutual retail funds, [X] cleared the screen in [Month Year]."* The number is the hook; the rest of the post unpacks it. Pull the figure from `corpus/proof/fund-universe-stats-snapshot.md` (item 6).

### 2. Methodology recap

Restate the weighted-alpha rubric in plain language — the five-horizon weighting (YTD 5% · 1Y 15% · 3Y 40% · 5Y 25% · 10Y 15%), what "qualified" means, why three-year performance dominates. Plain English every month; assume a first-time reader. Source: `corpus/courses/weighted-alpha-scoring.md` (item 5).

### 3. Aggregate state

The month's universe statistics — qualified count and rate, distribution by category, share with positive three-year alpha, drawdown picture. Aggregate only; never a per-fund leaderboard. Source: `corpus/proof/fund-universe-stats-snapshot.md` (item 6).

*(When item 7 lands, the Anomaly section is inserted here — see the note above.)*

### 4. Sector / geo pulse

Where the qualified universe is collectively tilting — top sectors, top geographies, most-held names. Frame as a description of the universe, never as a prompt to tilt a personal portfolio. Source: `corpus/proof/sector-geo-rotation-snapshot.md` (item 8).

### 5. Compliance disclaimer block

The verbatim compliance block, every month, no exceptions. Pull it at synthesis time via `corpus.get_compliance_block` (it unions the SC Malaysia, FIMM, and Public Mutual rules and includes the consultant credential, the risk warning, and the prospectus / PHS pointer). Never paraphrase it.

### 6. CTA

A consultation-shaped close — never "buy this fund". The MFR names no fund as a recommendation, so the CTA invites a conversation, not a purchase. Pattern: *"Want the methodology applied to your own holdings? DM 'MFR' for a free unit-trust portfolio review."*

## Standing rules

- The recap reports a methodology with a leaderboard as a by-product — never a "top funds to buy" list.
- No fund is named as a recommendation; no competitor fund is named at all.
- No forward projection of fund returns. Past alpha does not predict future alpha.
- Numbers are quoted from the dated snapshot files, not recomputed in prose.
- The compliance block is verbatim and present in every recap.
