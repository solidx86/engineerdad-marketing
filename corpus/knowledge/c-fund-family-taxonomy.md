---
cluster: portfolio
granularity: concept
source_type: public
source_ref: "PMB Master Prospectus 2025 fund classification table; PMB fund range overview as published on publicmutual.com.my as of 2026-05-31"
verified_at: 2026-05-31
lang_status: en_only
related: [fund-public-regularsavings, fund-public-ittikal-sequel, fund-public-asia-ittikal, fund-public-islamic-asia-tactical-allocation, fund-public-bond, c-reading-a-factsheet]
---

# PMB Fund Family Taxonomy

> Figures reflect publicly published PMB factsheets as of 2026-05-31; fund-specific values change quarterly — verify against the current factsheet. Not personalised advice.

## English

### Why taxonomy matters before fund selection

Public Mutual Berhad manages one of Malaysia's largest retail unit trust fund families, with over 150 individual funds across multiple asset classes, geographic mandates, and Shariah compliance structures. For a parent building a long-horizon portfolio, the first question is never "which fund?" — it is "which **category** of fund fits this sleeve of my plan?" Misidentifying the category leads to mismatched risk, wrong benchmark expectations, and incorrect fee assumptions.

### The primary asset-class categories

| Category | Core characteristic | Typical mandate |
|---|---|---|
| **Equity** | ≥ 70% equities | Growth; long-horizon (7+ years typical) |
| **Balanced** | ~40–60% equities / ~40–60% bonds | Moderate growth; medium-horizon (5–7 years) |
| **Mixed-asset** | Variable equity/bond ratio; manager-discretionary | Tactical or life-stage blend |
| **Fixed-income / Bond** | ≥ 70% bonds / sukuk / fixed-income instruments | Income or capital preservation; shorter horizons |
| **Money market** | Near-100% short-term instruments (< 365 days) | Liquidity; capital preservation; very short-horizon |

### The Shariah overlay

Within every asset-class category above, PMB offers Shariah-compliant variants screened under the SC Shariah Advisory Council guidelines. Shariah funds are **not** a separate asset class — they are the same asset-class categories (equity, balanced, fixed-income, etc.) with a permissibility filter applied to holdings. The practical differences (tracking error, purification, fee) are documented in `c-shariah-vs-conventional.md`.

### The geographic dimension

PMB funds also span three geographic scopes:

| Scope | Meaning |
|---|---|
| **Domestic** | Portfolio invested primarily in Malaysian securities (FBM KLCI universe and local bonds) |
| **Regional** | Portfolio invests across Asia or Asia-Pacific ex-Japan; introduces multi-currency exposure |
| **Global** | Portfolio spans multiple continents; USD and multi-currency exposure is dominant |

A parent building a children's education fund in USD-denominated fees (e.g., planning for overseas university) should understand that a domestic equity fund gives MYR-denominated returns — a global or USD-oriented fund may better match the liability currency, albeit with FX risk of its own.

### Representative fund-code placeholders

Specific fund details (fees, performance, holdings) are catalogued in the individual `fund-*.md` entries (Task 6). The placeholders below illustrate the taxonomy structure only:

| Placeholder | Category | Geographic scope | Shariah? |
|---|---|---|---|
| `fund-pmittf` | Equity | Domestic (Malaysia) | No |
| `fund-pmgf` | Equity | Global | No |
| `fund-pmbf` | Balanced | Domestic | No |
| `fund-pm-shariah-equity` | Equity | Domestic | Yes |
| `fund-pm-bond` | Fixed-income | Domestic | No |

*Actual fund codes and classes are named in the individual fund entries and verified against the current PHS.*

### PRS as a parallel structure

Private Retirement Scheme (PRS) funds offered through PRS providers (Public Mutual is one) mirror the same equity/balanced/conservative taxonomy, but are governed by the Private Pension Administrator (PPA) and carry different contribution, withdrawal, and tax-relief rules. For the purposes of this taxonomy, PRS funds are catalogued separately under the `b-` cluster entries.

### Four things most investors get wrong about the PMB fund family

- **"Balanced" does not mean "low risk"** — a balanced fund holds meaningful equity exposure (typically 40–60%). In a severe equity bear market, a balanced fund can lose 15–25% of NAV. The category label describes the asset mix, not the downside protection.
- **Money-market funds are not savings accounts** — they are uninsured unit trust funds. Capital is not guaranteed by PIDM. The near-zero volatility is a feature of the underlying instruments (short-dated, high-credit), not a contractual guarantee.
- **A Shariah fund and its conventional sibling are different mandates, not different risk levels.** Shariah screening can lead to a meaningfully different portfolio — sometimes more concentrated in specific sectors — which may produce tracking error against the conventional benchmark.
- **Regional and global funds are a different risk dimension, not just a higher-return tier.** They introduce currency exposure (MYR/USD/regional) that domestic funds do not carry; the headline return in a given year can be dominated by the USD/MYR exchange rate move, not the underlying equity market.

*Framing:* The taxonomy is the vocabulary. A consultant who can explain the five-by-three matrix (five asset classes × three geographic scopes, with a Shariah overlay) in plain language demonstrates structural command of the product range before any specific fund discussion begins.
