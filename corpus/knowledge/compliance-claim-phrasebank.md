---
cluster: primitive
granularity: concept
source_type: public
source_ref: "SC Malaysia guidelines on advertising; FIMM Code of Ethics 4th ed.; corpus/compliance/public-mutual.md"
verified_at: 2026-05-31
lang_status: en_only
---

# Compliance Claim Phrasebank

> This file is the operative reference for content-writer when drafting hooks and scripts in fear/aspiration/proof registers. Every claim in an EngineerDad asset must map to a row in the **Claimable** list or be absent. Every phrase in the **Banned** list is a hard blocker. Cross-reference `corpus/compliance/public-mutual.md` for verbatim disclaimer text and `corpus/compliance/sc-malaysia.md` + `corpus/compliance/fimm.md` for the regulatory anchors.
>
> Figures reflect publicly published PMB/LHDN schedules as of 2026-05-31; consultant to confirm current values before any campaign launch.

## English

### Claimable

**Past performance with attribution**
- Pattern: `"[Fund name / category] returned [X]% over [period] as reported in the [month/year] Public Mutual [Master Prospectus / PHS / Fund Fact Sheet]."`
- Required accompanying caveat (verbatim): `"Past performance of a fund is not a reliable indicator of its future performance."` (cross-ref `corpus/compliance/public-mutual.md`)
- Do not state or imply the return will recur. Do not cherry-pick a favourable period.
- Benchmark comparisons are permitted if: (a) it is the fund's own published benchmark, (b) the period is disclosed, (c) composition differences are noted.

**Tax relief — PRS**
- Pattern: `"PRS contributions of up to RM3,000 per year qualify for personal income tax relief — verify the active year with LHDN before acting."`
- Source: LHDN personal relief schedule.
- Do not state an exact RM tax-saved figure without anchoring to the investor's marginal rate (individual and unknown in a public post).
- Acceptable: `"For a taxpayer in the 24% bracket, a RM3,000 PRS contribution reduces tax payable by up to RM720 — subject to your actual tax position; verify with LHDN or a tax adviser."` (figures as of 2026-05-31; consultant to confirm current rates)

**FIMM credential disclosure**
- Required on every public post: licensed Unit Trust Consultant + licensed PRS Consultant, representative of Public Mutual Berhad, with FIMM registration number (see `corpus/proof/credentials.md`).

**Illustrative compounding projections**
- Pattern: `"At an assumed [X]% annual return, RM[Y]/month from birth compounds to approximately RM[Z] at age 18. This is an illustrative model, not a forecast or guaranteed outcome."`
- The assumed return must be disclosed as an assumption, not a promise.
- Supporting caveat: `"Actual fund returns vary; past performance does not indicate future results."`

**Fear/urgency framing — latency penalty (compliant version)**
- Pattern: `"The cost of delaying by five years is approximately RM[X] of end-of-horizon value, based on [specific illustrated scenario]."`
- Source the RM figure to a named illustrative model or data file.
- Do not use "invest now before it is too late" (see Banned). Compliant substitute: state the compounding cost as a factual observation, not a pressure tactic.

**Survey statistics (owned data)**
- Pattern: `"In an EngineerDad survey of [N] Malaysians, [X]% [reported] [finding]."`
- Always state N. Never round up. Never project to a national claim.

**Fund-universe aggregate stats**
- Pattern: `"In [month/year], [X] of [total] Public Mutual retail funds cleared the EngineerDad weighted-alpha screen — a [Y]% qualified rate."` (see `corpus/proof/fund-universe-stats-snapshot.md`)
- State: "This is an educational research signal, not a buy recommendation. Past screen performance does not indicate future results."
- Do not name or rank individual funds in a public post.

**Prospectus pointer (required on product references)**
- Verbatim from PMB Advertising Disclaimer: `"Investors are advised to read and understand the contents of the relevant prospectus / supplemental prospectus (if any) / information memorandum, disclosure documents and the product highlights sheet (PHS) before investing. The registration / lodgement with the SC does not amount to nor indicate that the SC has recommended or endorsed the fund(s)."`

---

### Banned / Non-claimable

**Guaranteed returns or capital protection on equity / mixed-asset funds**
- Banned: `"guaranteed"`, `"secure"`, `"risk-free"`, `"zero risk"`, `"no risk"`, `"warranty"`, `"promise"`, `"safe"` — unless the product contractually guarantees a return (PMB equity and mixed-asset funds do not). Banned in every language, including BM.

**Capital protection claims on non-capital-guaranteed funds**
- Where principal or rate of return is not guaranteed, content must NOT state that the risk of losing principal is "low or nil." Do not say "your investment is protected", "low chance of loss", "you won't lose your capital."

**Urgency / FOMO pressure**
- Banned: `"Invest now before it is too late"`, `"Buy now before it's too late"`, `"Hurry, offer period ends"`, `"This is the best time to invest"`, `"This golden opportunity only happens once"`.
- Rationale: investors must not be pressured into acting within a time frame that impedes their own research and due diligence.

**Superlatives without a verified independent basis**
- Banned: `"best performing fund"`, `"#1 fund"`, `"most popular"`, `"top-rated"` — unless backed by a named, independent, third-party ranking within a reasonable validity period.

**Get-rich-quick / overzealous return framing**
- Banned: `"Your investment will grow from strength to strength"`, `"Greater wealth awaits you"`, `"You too can be rich with one simple step"`.

**Specific fund recommendations in a public channel**
- Public-channel content must not name a specific fund and prompt action ("invest in X now", "buy this fund"). Specific recommendations require a documented one-on-one Suitability Assessment.

**Forecast of specific Scheme performance**
- A UTC may not predict or project a *named fund's* future return.

**Titles not held**
- Banned unless the relevant licence is held separately: `"Financial Planner"`, `"Financial Advisor"`, `"Investment Advisor"`, `"Investment Consultant"`.

**Head-to-head comparisons with named competitor funds**
- Do not compare a PMB fund against a named competitor's fund in a public post.

**SC logo / endorsement implication**
- Never use the SC logo or imply SC endorsement. Include the boilerplate disclaimer above.

**"Save" / "savings" when describing unit trust / PRS investments**
- Avoid "save" / "savings" — these are investment vehicles, not savings deposits; the language creates false equivalence with capital-certain accounts.
