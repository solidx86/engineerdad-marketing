---
cluster: primitive
granularity: concept
source_type: public
source_ref: "corpus/proof/*, corpus/data/*"
verified_at: 2026-05-31
lang_status: en_only
---

# Proof Asset Index

> This is the map brief-writer uses to select a proof type for each Brief. For every Brief, match the proof type to the claim being made, locate the asset below, and pass its filename as a proof reference. Proof discipline: all proof references must resolve to real files in `corpus/proof/` or `corpus/knowledge/` — no invented figures, no paraphrased third-party claims.
>
> Fund-level entries (`fund-*.md`) are added in Task 6 as individual fund factsheet files are loaded. Verify file presence before citing in a campaign.

## English

### proof/* files

| Asset | Type | Location | Claims it can back |
|---|---|---|---|
| `epf-shortfall-cases.md` | Calculator output (worked scenarios) | `corpus/proof/epf-shortfall-cases.md` | EPF shortfall by age/salary; cost of closing the gap; "a million-ringgit EPF runs dry by 72" hook; latency-penalty quantification |
| `fund-universe-stats-snapshot.md` | Aggregate snapshot (MFR) | `corpus/proof/fund-universe-stats-snapshot.md` | Share of PMB retail funds clearing the weighted-alpha screen; category breakdown; 3-year alpha positivity; median drawdown — aggregate only, no individual fund named |
| `sector-geo-rotation-snapshot.md` | Aggregate snapshot (MFR) | `corpus/proof/sector-geo-rotation-snapshot.md` | Top sectors and geographies across the qualified universe; top holdings by fund count — aggregate only |

> Note: confirm the exact proof/* file inventory with `ls corpus/proof/` before a campaign — the rows above list the assets known at authoring time; others may exist.

### corpus/data/* files (machine-readable; cite via the proof files that narrate them)

| Asset | Type | Location | Claims it can back |
|---|---|---|---|
| `epf-sustainability-simulations.json` | Calculator output grid | `corpus/data/datasets/epf-sustainability-simulations.json` | EPF projected balance, monthly payout, gap, years-sustainable, monthly top-up across the age/salary/lifestyle grid; source data behind `epf-shortfall-cases.md` |
| `kwsp-ria-benchmarks.json` | KWSP benchmark data | `corpus/data/datasets/kwsp-ria-benchmarks.json` | Age-banded EPF balance benchmarks; source data behind the shortfall cases |

> Note: confirm the exact data/* inventory with `ls corpus/data/` before citing.

### knowledge/* entries (this expansion)

| Asset | Type | Location | Claims it can back |
|---|---|---|---|
| `a-fee-schedule.md` | Mechanics concept | `corpus/knowledge/a-fee-schedule.md` | PMB fee structure — sales charge, switching, redemption, AMF, trustee fee |
| `a-switching-matrix.md` | Mechanics concept | `corpus/knowledge/a-switching-matrix.md` | Intra- vs cross-family switching; the double-charge trap |
| `b-relief-stacking.md` | Tax concept | `corpus/knowledge/b-relief-stacking.md` | PRS RM3,000 relief stacking with other reliefs |
| `fund-public-regularsavings.md` | Fund-level proof | `corpus/knowledge/fund-public-regularsavings.md` | PUBLIC REGULARSAVINGS FUND (PRSF) — large domestic conventional equity; FVC 4; RM 3.57B AUM; financial-sector-heavy; benchmark comparison claims |
| `fund-public-ittikal-sequel.md` | Fund-level proof | `corpus/knowledge/fund-public-ittikal-sequel.md` | PUBLIC ITTIKAL SEQUEL FUND (PITSEQ) — large domestic Shariah equity; FVC 4; RM 4.54B AUM; Shariah-compliant portfolio construction claims |
| `fund-public-islamic-asia-tactical-allocation.md` | Fund-level proof | `corpus/knowledge/fund-public-islamic-asia-tactical-allocation.md` | PUBLIC ISLAMIC ASIA TACTICAL ALLOCATION FUND (PIATAF) — Shariah mixed-asset / tactical; FVC 5; RM 3.75B AUM; tactical allocation category claims |
| `fund-public-bond.md` | Fund-level proof | `corpus/knowledge/fund-public-bond.md` | PUBLIC BOND FUND (P BOND) — domestic conventional fixed income; FVC 2; RM 1.55B AUM; lower-volatility / capital-preservation claims; lower sales charge comparison |
| `fund-public-asia-ittikal.md` | Fund-level proof | `corpus/knowledge/fund-public-asia-ittikal.md` | PUBLIC ASIA ITTIKAL FUND (PAIF) — regional Shariah equity (Asia); FVC 5; RM 5.82B AUM (largest in snapshot); multi-currency exposure claims; technology sector concentration claims |

### objection-cluster entries + datasets/charts (UT objection corpus)

New grounding assets for the `cluster: objection` entries. Datasets carry per-row citations and `verification_status`; charts carry `caption_en/ms` + `source_citation`. Listed here so proof-selection can discover them from the index, not only from each entry's `related:` line.

| Asset | Type | Location | Claims it can back |
| --- | --- | --- | --- |
| `etf-cost-comparison.json` | Cost-stack dataset (sourced) | `corpus/data/datasets/etf-cost-comparison.json` | DIY-ETF vs UT all-in cost; SPY/QQQ TER; US 30% dividend withholding (no MY treaty); USD estate-tax exposure >USD60k; backs d2-fees-vs-etf-ter, d2-buy-us-stocks-direct |
| `us-vs-my-returns.json` | Returns dataset (sourced) | `corpus/data/datasets/us-vs-my-returns.json` | QQQ/SPY USD vs MYR-adjusted returns (5y/10y standard periods); FBM KLCI comparator; backs d2-qqq-spy-crush-my-funds |
| `sales-charge-by-channel.json` | Channel-cost dataset (sourced) | `corpus/data/datasets/sales-charge-by-channel.json` | Max sales charge by channel (agent 5.0% / PMO / EPF-MIS 3% / i-Invest 0.5%); i-Invest eligibility caps; backs d1-sales-charge-instant-loss, d2-sales-charge-robbery, d2-just-use-epf-iinvest |
| `robo-fee-tiers.json` | Fee dataset (sourced, variable) | `corpus/data/datasets/robo-fee-tiers.json` | StashAway / Versa / UT annual fee; no-sales-charge robo advantage; PRS-relief wrapper gap; backs d2-robo-does-it-cheaper |
| `asb-asnb-returns.json` | Returns + positioning dataset (sourced) | `corpus/data/datasets/asb-asnb-returns.json` | ASB declared FY2021-25; FD/ASB/EPF/equity risk-tier positioning; EPF §27 floor; backs d1-cant-beat-fd-asb-epf |
| `spiva-behaviour-gap.json` | Evidence dataset (sourced, edition-dated) | `corpus/data/datasets/spiva-behaviour-gap.json` | SPIVA active-underperformance by horizon/region; Morningstar behaviour gap (1.2pp/yr); Malaysia weighted-alpha counterpoint; backs d2-active-underperforms, d2-just-dca-the-index |
| `regulatory-facts.json` | Regulatory facts dataset (public) | `corpus/data/datasets/regulatory-facts.json` | SC/FIMM oversight; trustee-custody model; PIDM-not-covered; backs d1-ut-is-a-scam, d1-can-lose-everything |
| `my-cpi-inflation.json` | Inflation series dataset (DOSM) | `corpus/data/datasets/my-cpi-inflation.json` | Malaysian headline CPI series + named-window averages; backs d0-saving-is-enough and the re-grounded general-inflation chart (general-inflation-vs-savings-real-value) |
| `true-cost-stack-ut-vs-etf.yaml` | Chart spec (bar, sourced) | `corpus/data/charts/true-cost-stack-ut-vs-etf.yaml` | Stacked all-in cost, UT vs DIY ETF |
| `usd-return-vs-myr-adjusted.yaml` | Chart spec (bar, sourced) | `corpus/data/charts/usd-return-vs-myr-adjusted.yaml` | Headline USD vs MYR-adjusted return vs KLCI |
| `sales-charge-by-channel.yaml` | Chart spec (bar, sourced) | `corpus/data/charts/sales-charge-by-channel.yaml` | Max sales charge across four purchase channels |
| `robo-vs-ut-cost-feature.yaml` | Chart spec (bar, sourced) | `corpus/data/charts/robo-vs-ut-cost-feature.yaml` | Annual management fee, two robos vs a UT |
| `risk-return-positioning.yaml` | Chart spec (scatter, compliance-framed) | `corpus/data/charts/risk-return-positioning.yaml` | Risk×return positioning of FD/ASB/EPF vs an equity-UT band — category-error correction, not a ranking |
| reuse charts | Existing chart specs (cited by d-entries) | `corpus/data/charts/{coffee-to-compound,compounding-30y,start-age-penalty,general-inflation-vs-savings-real-value,target-by-budget,epf-savings-by-age,epf-baseline-tiers}.yaml` | Compounding / start-age penalty / inflation-real-value / budget-target / EPF age-band & baseline visuals reused across the d0–d2 entries |
| `d0-*.md` (5) | Objection entries — Tier-0 necessity | `corpus/knowledge/d0-*.md` | "investing is optional / can't afford / start later / for the rich / EPF will cover me" — TOFU necessity corrections |
| `d1-*.md` (11) | Objection entries — Tier-1 avoidance | `corpus/knowledge/d1-*.md` | scam/churn/can-lose-everything/sales-charge-loss/can't-beat-FD-ASB-EPF/locked-in/need-a-lot/past-performance/EPF-already-invests/too-complicated/Shariah — MOFU avoidance corrections |
| `d2-*.md` (8) | Objection entries — Tier-2 substitution | `corpus/knowledge/d2-*.md` | ETF-TER/DCA-the-index/QQQ-SPY/sales-charge-robbery/robo-cheaper/EPF-i-Invest/US-stocks-direct/active-underperforms — BOFU substitution corrections |

### Citation discipline

- `source_type: synthesized` entries must be framed as "imagine / scenario / example" in all downstream content. Never present as a real client case.
- Public-record entries require attribution to the original public source plus the standard past-performance caveat.
- Aggregate snapshots are dated — always cite the snapshot period and note figures may have changed.
- Owned survey data requires citation of sample size and date; never project the sample to a national claim.
