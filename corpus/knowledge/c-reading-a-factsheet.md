---
cluster: portfolio
granularity: concept
source_type: public
source_ref: "PMB fund factsheets (published quarterly); PMB Master Prospectus 2025 benchmark and performance disclosure sections; FIMM investor-education guidelines"
verified_at: 2026-05-31
lang_status: en_only
related: [c-risk-metric-glossary, c-fund-family-taxonomy]
---

# Reading a PMB Factsheet Like an Analyst

> Figures reflect publicly published PMB factsheets as of 2026-05-31; fund-specific values change quarterly — verify against the current factsheet. Not personalised advice.

## English

### Why the factsheet rewards careful reading

A PMB fund factsheet compresses a quarter's worth of portfolio data into two pages. Most investors glance at the trailing-return table and stop there. An analytical reader instead works through six distinct data layers — each of which reveals something the return table hides.

### Layer 1 — Trailing returns vs benchmark

The performance table shows 1-year, 3-year, 5-year (and sometimes 10-year) returns for the fund alongside its benchmark index. The most important number is **not** the fund's absolute return — it is the **active return** (fund return minus benchmark return). A fund that returned 12% when its benchmark returned 15% is not a 12% story; it is a −3% story. The benchmark line is the analyst's north star.

- **What it tells you:** whether the manager added or subtracted value relative to passive exposure over the measurement period.
- **What it hides:** the benchmark choice matters. Some PMB factsheets benchmark equity funds against the FBM KLCI (domestic large-cap); a global equity fund benchmarked against FBM KLCI is an almost meaningless comparison. Always check that the benchmark is appropriate for the fund's stated mandate.

### Layer 2 — Sharpe ratio

The Sharpe ratio expresses how much return the fund delivered per unit of total volatility, measured as:

> Sharpe = (Fund Return − Risk-Free Rate) / Standard Deviation

A higher Sharpe means more return per unit of risk. On a PMB factsheet, the risk-free rate proxy is typically the Malayan Banking overnight rate or equivalent short-term instrument.

- **What it tells you:** efficiency of the risk-reward exchange over the measurement window.
- **What it hides:** Sharpe is backward-looking and collapses to meaninglessness over short windows (< 3 years). It also treats upside volatility and downside volatility as equally undesirable — an investor who only cares about downside loss may prefer Sortino ratio, which PMB factsheets typically do not publish.
- **Cross-asset trap:** never compare Sharpe ratios across asset classes (e.g., a bond fund vs an equity fund) — the denominator (standard deviation) is structurally lower for bonds, inflating the ratio regardless of manager skill.

### Layer 3 — Standard deviation

Standard deviation (SD) measures the dispersion of the fund's monthly or annual returns around its mean. A PMB factsheet typically shows the 3-year annualised SD.

- **What it tells you:** historical return variability — a rough proxy for how "bumpy" the ride has been.
- **What it hides:** SD treats all volatility symmetrically (up and down). A fund with occasional large positive months will show a high SD even if drawdowns are modest. SD also says nothing about skew — whether the tail events lean toward large gains or large losses.

### Layer 4 — Top-10 holdings and sector weights

The top-10 holdings section lists the fund's largest individual positions; the sector weights section aggregates those into industry buckets (e.g., financials, technology, consumer). Together they reveal **concentration risk** and **factor exposure** that the headline return cannot.

- **What it tells you:** whether you are implicitly doubling up on a sector you already hold elsewhere (e.g., buying a PMB equity fund that is 30% financials when your EPF is also heavily weighted toward Malaysian banks).
- **What it hides:** the factsheet shows the portfolio as of the quarter-end valuation date — turnover between reporting dates is not visible. A manager who repositioned heavily before quarter-end can present a "clean" top-10 that does not reflect what drove performance during the quarter.

### Layer 5 — Geographic allocation

For any fund with a regional or global mandate, the geographic allocation table shows how much of the portfolio sits in each country or region. This matters because it determines your **FX exposure** and **country-risk concentration** at the portfolio level.

- **What it tells you:** whether the fund's mandate (e.g., "Asia Pacific ex-Japan") is actually reflected in the portfolio — sometimes a fund marketed as regional carries over 60% in one country.
- **What it hides:** the factsheet shows end-of-period weights. Tactical overweights taken during the quarter, and the currency hedging decisions applied to each geography, are typically not disclosed at the factsheet level — they require reading the fund's annual or semi-annual report.

### Layer 6 — Expense ratio / total cost

A complete PMB factsheet includes the fund's **expense ratio** (effectively the annual management fee plus trustee fee, expressed as a percentage of NAV). This is the annual drag applied before any published return figure.

- **What it tells you:** the ongoing cost of ownership — not the one-time sales charge but the perpetual, compounding drag.
- **What it hides:** the published return on the factsheet is **already net of the expense ratio** — so the gross return (what the underlying assets earned before fees) is higher than what the investor received. This makes it impossible to separate manager skill from the fee burden using the factsheet alone.

### Four things most investors miss on a PMB factsheet

- **The benchmark line is the analyst's north star.** Absolute returns are almost meaningless without knowing what the market delivered over the same period — a 6% return in a year the benchmark rose 12% is underperformance by 6 percentage points.
- **Standard deviation is not a safety rating.** A bond fund with an SD of 2% and an equity fund with an SD of 14% are not comparable on this metric alone; comparing them produces nonsense numbers, not insight.
- **Top-10 holdings are a lag indicator.** The quarter-end snapshot shows you where the manager was, not where they are now — high-turnover funds can look very different intra-quarter.
- **Published returns are net of the annual management fee and trustee fee, but gross of the sales charge.** If you paid a 5.0% sales charge on entry (verified ceiling for equity funds), your personal return is further reduced by that charge on a prorated basis for however long you hold — the factsheet's return figure does not capture your personal holding cost.

*Framing:* Reading all six layers in sequence takes less than ten minutes per fund. The investor who does this is already better informed than most consultants' clients — and the conversation that follows is about strategy, not product features.
