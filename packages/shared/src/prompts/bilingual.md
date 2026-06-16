# Bilingual Output Conventions

Every external artifact — Brief, Script, Authority Article, Creative Variant,
Decision Memo, Hypothesis statement, Learning claim — ships in **both**
languages: **English (`en`)** and **Bahasa Malaysia (`ms`)**. No exceptions.

## Output shape

In code, a bilingual field is `{ en: string, ms: string }`. Each arm must be
non-empty (`min(1)` in Zod). The store persists this pair as a single
bilingual JSON field; agents always work with the object shape.

## Per-language rules

- **English**: Malaysian English register, not American. "RM" not "$". Avoid
  US idioms ("home run", "MVP"). Numbers in `1,000` format, not `1.000`.
- **Bahasa Malaysia**: Standard Bahasa Malaysia (BM Baku), not Indonesian.
  Use `Wang Tunai` not `Uang Kas`. Use `pelaburan` not `investasi`. Capital-letter
  proper nouns; no all-caps headlines.

## Translation discipline

- **Translate intent, not words.** A hook that lands in EN may need a different
  metaphor in BM. The proof and the promise stay constant; the rendering
  adapts.
- **Compliance is per-language.** `complianceScan` runs once per language with
  language-specific patterns. A disclaimer that satisfies EN does *not* satisfy
  BM — every artifact must include the consultant credential, risk warning, and
  prospectus availability statement in **the language being scanned**.
- **Names are not translated.** `Shoo Kyuk Wei`, `Public Mutual Berhad`, `FIMM`,
  `UTC`, `PRS`, fund names — all kept verbatim across languages. The compliance
  scanner depends on this.
- **Numbers and dates are localized.** `RM 1,200/bulan` (BM), `RM 1,200/month`
  (EN). Date format: `5 May 2026` (EN), `5 Mei 2026` (BM).

## Failure modes to avoid

- "Single-language drafted, MTL'd to the other." It shows. Each arm is
  authored in-register; if one arm is weaker, fix it before submitting.
- BM that reads as Indonesian (`bisa` instead of `boleh`, `gimana` instead of
  `macam mana`). Reject and rewrite.
