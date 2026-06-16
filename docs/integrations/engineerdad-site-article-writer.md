# Design Spec — engineerdad-site `article-writer` (Skill + MCP Wrapper)

Status: Draft v2 — ready for implementation in engineerdad-site
Date: 2026-05-17
Caller: Marketing OS `media-production` agent (programmatic) + human (ad-hoc in engineerdad-site Claude Code)
Doctrine: ADR-015 (write-API safety), ADR-016 (OS produces specs, not artifacts), ADR-017 (distribution orchestrator + adapter MCPs)
Architecture: **Option C** — a Claude Code skill in engineerdad-site (the brain) + a thin MCP server wrapping it via the Claude Agent SDK (the programmatic entry point).

This document is the **interface contract** between Marketing OS and the engineerdad-site article-writer. Both repos must conform to it.

---

## 1. Purpose

Materialize an article in the engineerdad-site repo, committed on a draft branch but **not** deployed. Two invocation paths share one skill:

- **Programmatic** — Marketing OS's `media-production` agent (after HG2 article approval) calls the MCP with a structured spec
- **Ad-hoc** — Human in a Claude Code session inside engineerdad-site invokes the skill with natural language (market news, current events, opportunistic content)

The skill is the source of truth for **how** articles get written; the MCP is just the programmatic doorway into it.

---

## 2. Architecture

```
                  [Two invocation paths, one skill]

┌─────────────────────────────┐         ┌─────────────────────────────────┐
│ Marketing OS                │         │ Human at engineerdad-site repo  │
│ media-production agent      │         │ Claude Code session (cwd=site)  │
│                             │         │                                 │
│ calls mcp__engineerdad_     │         │ types natural-language request: │
│  site__draft_article({...}) │         │ "write an article about ..."    │
└─────────────┬───────────────┘         └────────────────┬────────────────┘
              │                                          │
              │ stdio MCP                                │ Claude Code skill router
              │                                          │ matches article-writer
              ▼                                          │ skill description
┌─────────────────────────────┐                          │
│ MCP server                  │                          │
│ engineerdad-site/mcp/       │                          │
│   article-writer/           │                          │
│                             │                          │
│ Uses @anthropic-ai/claude-  │                          │
│  agent-sdk to spawn an      │                          │
│  agent session with         │                          │
│  article-writer skill       │                          │
│  loaded                     │                          │
└─────────────┬───────────────┘                          │
              │                                          │
              └────────────────────┬─────────────────────┘
                                   │
                                   ▼
              ┌──────────────────────────────────────────┐
              │ article-writer SKILL                     │
              │ engineerdad-site/.claude/skills/         │
              │   article-writer/SKILL.md (+ context/*)  │
              │                                          │
              │ Same skill, same behavior, regardless    │
              │ of how invoked.                          │
              │                                          │
              │ Tools available (allowlist):             │
              │   Read, Write, Edit, Bash, Grep, Skill   │
              │                                          │
              │ Steps:                                   │
              │ 1. Parse input (structured or NL)        │
              │ 2. Derive fields (slug, dates, paths)    │
              │ 3. Read template + existing articles     │
              │ 4. Write body HTML (uses brand voice +   │
              │    AEO/GEO + site patterns)              │
              │ 5. Render full HTML into _template       │
              │ 6. Update sitemap.xml, llms.txt, the     │
              │    article-index pages                   │
              │ 7. git checkout -b draft/article-<slug>  │
              │ 8. git add + commit (no push)            │
              │ 9. Report branch + commit                │
              └──────────────────────────────────────────┘
```

---

## 3. Input contract — flexible

The skill is **input-flexible**. It accepts three valid input shapes; the MCP uses one, the human uses another, both work.

### 3.1 Structured shape (canonical — what the MCP sends)

```ts
type ArticleSpec = {
  // Required
  slug:            string                  // kebab-case, validated /^[a-z0-9]+(-[a-z0-9]+)*$/
  lang:            "en" | "ms"
  title:           string
  description:     string                  // ≤160 chars ideal
  topic_tag:       string                  // short uppercase, e.g. "EDUCATION FUND"
  reading_time:    string                  // e.g. "6 min read" / "6 minit bacaan"
  keywords:        string[]                // plain strings
  brief_markdown:  string                  // the main article body in markdown
                                           // — h2/h3 headings, paragraphs, lists,
                                           //   blockquotes, tables, inline emphasis,
                                           //   inline links via [text](url)
  faq_markdown:    string                  // FAQ in markdown — convention:
                                           // ### Question text
                                           // Answer paragraph(s).
                                           // (variable count; skill parses into items)
  og_image:        string                  // https URL
  date_published:  string                  // ISO YYYY-MM-DD

  // Optional
  date_modified?:  string                  // defaults to date_published
  hero_image_url?: string                  // if present, hero block renders <img>;
                                           // if absent, hero block is removed
  hero_image_alt?: string                  // defaults to title
  related_slugs?:  string[]                // optional curated inter-link hints;
                                           // skill ALSO discovers links via Grep
}
```

### 3.2 Natural-language shape (what humans type ad-hoc)

```
"Write an article about [topic]. Key facts: [facts]. Target query: [query].
Lang: [en|ms, default en]. [Any other context.]"
```

The skill extracts/derives what it can, asks the human for clarification only on **truly** ambiguous fields, and applies defaults for everything else (see §3.4).

### 3.3 Mixed shape (NL with some explicit fields)

```
"Write a BM article (lang=ms) titled 'Penjelasan Belanjawanku 2026' about
the latest BNM household-budget benchmark. Key facts: ..., target query:
'belanjawanku 2026 keluarga'."
```

### 3.4 Skill's extraction + defaulting rules

When a field isn't explicitly provided, the skill applies these rules:

| Field             | Rule                                                              |
|-------------------|-------------------------------------------------------------------|
| `slug`            | Kebab-case from title; lowercase; strip non-alphanumeric          |
| `lang`            | Detect from prompt language; default `en`                         |
| `title`           | Extract from prompt; if absent, derive from topic                 |
| `description`     | Compose 1–2 sentences from the brief; ≤160 chars                  |
| `topic_tag`       | Inferred from topic; uppercase                                    |
| `reading_time`    | Compute from final word count (≈250wpm); EN/BM phrasing per lang  |
| `keywords`        | Extract from brief + target_query                                  |
| `og_image`        | Default to site OG (`https://engineerdad.my/assets/og-default.png`) |
| `date_published`  | Today (UTC) in ISO format                                         |
| `date_modified`   | Same as `date_published`                                          |
| `hero_image_url`  | Absent → hero block removed                                       |
| `related_slugs`   | Skill uses Grep across `/articles/` to find candidate links       |

When the skill defaults a high-stakes field (slug, lang, title), it MUST surface the choice in its final report so the human can correct on the next run if wrong.

---

## 4. Skill behavior contract

End-to-end, the skill performs these steps every invocation. The skill's prompt (SKILL.md body, user authors) describes the *quality* of each step; this section describes the *interface* — what MUST happen.

### 4.1 Parse + validate

- Extract the spec fields per §3 (any input shape).
- Apply defaults per §3.4 for missing fields.
- Validate: `slug` regex, `lang` enum, `og_image` is HTTPS, `date_published` is ISO.
- If a required-but-undefaultable field is missing, surface a clear question to the user and halt — do not invent data.

### 4.2 Read context

- Read `/articles/_template.html` (the canonical scaffold).
- Read recent articles for brand-voice grounding (suggested: 2–3 most-recent ones in the same `lang`).
- Read `/articles/index.html` and `/ms/articles/index.html` to know what exists (for inter-linking + index updates).
- Read `/sitemap.xml` (current state, will be modified).
- Read `/llms.txt` (current state, will be modified).

### 4.3 Write the body HTML

- Convert `brief_markdown` → HTML body following the rules in SKILL.md (allowed tags: `h2`, `h3`, `p`, `ul`, `ol`, `li`, `blockquote`, `strong`, `em`, `a`, `code`, `table`/`thead`/`tbody`/`tr`/`th`/`td`, `figure`, `img`, `br`).
- Apply site-specific affordances per SKILL.md doctrine: inline tables with engineerdad palette where comparison serves the reader, callout patterns where a key takeaway warrants emphasis, etc. The skill body defines when/how.
- Insert internal links to other engineerdad-site pages where natural (the skill grounds in §4.2's read of `/articles/` and may also reference `/tools/`, `/about.html`, `/the-pulse.html`).
- Parse `faq_markdown` into a list of `{question, answer}` items. Variable count, minimum 1.

### 4.4 Render the full HTML file

- Read `_template.html`. Substitute all `{{placeholder}}` tokens.
- **Remove** the `<meta name="robots" content="noindex,nofollow">` line that exists to prevent the scaffold from being indexed.
- Replace the example body block (inside `<div class="article-body">`) with the rendered body HTML from §4.3.
- Handle hero image block (per §3.4): render `<img>` if `hero_image_url` present, else remove the entire `<div class="article-hero-image">` block.
- Render FAQ in two places, lockstep identical:
  - Visible: `<details class="faq-item">` blocks under `.faq-list` (one per FAQ item)
  - JSON-LD: `FAQPage.mainEntity` array (same count, same order, same text)
- Substitute bilingual UI strings per `lang` (per the EN/MS map; see §4.5).
- Remove all `<!-- TEMPLATE: ... -->` scaffold comments.
- Write to `/articles/<slug>.html` (en) or `/ms/articles/<slug>.html` (ms).

### 4.5 Bilingual UI string map (skill holds these internally)

The template has English UI strings hardcoded in non-placeholder positions. The skill substitutes based on `lang`:

| Slot                   | EN                                              | MS                                                              |
|------------------------|-------------------------------------------------|-----------------------------------------------------------------|
| CTA title              | "Ready to start your child's journey?"          | "Bersedia merancang masa depan anak anda?"                      |
| CTA subtitle           | "Book a free 30-minute consultation. No sales pressure — just clarity." | "Tempah konsultasi 30 minit secara percuma. Kita akan kira angka anda dan pilih dana yang sesuai. Tiada tekanan jualan." |
| CTA button             | "Get in touch"                                  | "Hubungi kami"                                                  |
| TOC label              | "On this page"                                  | "Di halaman ini"                                                |
| Share label            | "Share"                                         | "Kongsi"                                                        |
| Author label           | "Author"                                        | "Penulis"                                                       |
| Author role            | "Licensed UTC &amp; PRS Consultant<br>Public Mutual Berhad" | "Perunding UTC &amp; PRS Berlesen<br>Public Mutual Berhad" |
| About link label       | "More about me →"                               | "Lebih lanjut tentang saya →"                                   |
| FAQ eyebrow            | "Common Questions"                              | "Soalan Lazim"                                                  |
| FAQ heading            | "Frequently Asked Questions"                    | "Soalan Yang Sering Ditanya"                                    |
| FAQ intro              | "Answers to common questions on this topic."    | "Jawapan kepada soalan biasa tentang topik ini."                |
| Home / Articles / Back | "Home" / "Articles" / "Back to all articles"    | "Laman Utama" / "Artikel" / "Kembali ke semua artikel"          |

Recommended approach: update `_template.html` to use placeholders for all these (e.g., `{{cta_title}}`), and the skill substitutes uniformly per §4.4. Alternative: post-process the EN strings for `lang=ms`. Skill author picks.

### 4.6 Update sitemap.xml

- Add reciprocal `<url>` entries: one for the EN URL, one for the MS URL.
- Each `<url>` includes `<xhtml:link rel="alternate" hreflang="...">` entries pointing to its sibling and to `x-default`.
- Insert in alphabetical order of `<loc>`, or following the existing pattern in the file.

### 4.7 Update llms.txt

- Add a bullet under `## Articles` (en) or `## Articles (Bahasa Malaysia)` (ms).
- Bullet format: follow the existing pattern in llms.txt.

### 4.8 Update articles/index.html (or ms/articles/index.html)

- Add an `<a class="article-card">` entry following the existing pattern.
- Insert near the top (newest-first) unless the existing pattern is different.
- Update the corresponding ItemList entry in any structured-data block on the index page.

### 4.9 Git operations

- Create a new branch: `git checkout -b draft/article-<slug>` (suffix `-ms` if lang=ms and a collision would occur).
- Stage only the files this run modified: the new article HTML, `sitemap.xml`, `llms.txt`, the index page. NOT `_template.html`. NOT any other articles.
- Commit: `draft(article): <slug> (<lang>)`.
- **Push the branch to `origin`** with `git push -u origin draft/article-<slug>`. Push is allowed for `draft/article-*` branches only — never `main`, never force-push.
- **Open a draft PR on GitHub** using the `gh` CLI (`gh pr create --draft --base main --head draft/article-<slug> ...`). The PR is the human's surface for review/edits/merge; the skill does not merge.
- If the branch already exists (idempotent re-run with same slug), check it out instead of creating new, and amend the commit with the latest content. Re-push with `--force-with-lease` (the one allowed force variant, scoped to `draft/article-*`). If a draft PR already exists for this branch, reuse it (no duplicate PR); otherwise open a fresh one. Surface the amend in the report.
- If the `gh` CLI step fails (auth missing, network, repo permissions), surface a clear error and return `PR_FAILED` (§10.5) — the commit + push may have succeeded; the report still includes `branch` and `commit`, and `pr_url` is omitted.

### 4.10 Report

Return a structured report to the caller (programmatic) or print a summary (ad-hoc):
- Branch name
- Commit sha
- PR URL (when the draft PR was opened or reused; omitted on `PR_FAILED`)
- File paths modified
- Any defaults applied (so the human can audit)
- Any clarifications still needed (rare — should be zero in healthy runs)

**Caller-side back-fill expectation.** The PR URL is the actual review surface — a human at HG3 needs a clickable jump-off to GitHub. Callers are expected to surface `pr_url` to their review system. In Marketing OS, the `distribution` agent writes it to `AuthorityArticles.PR URL EN` or `AuthorityArticles.PR URL BM` (url field) on the corresponding row, alongside the existing `Delivered At` / `Delivered To` stamp. When `pr_url` is absent (`PR_FAILED`), the field is left empty — the row still gets `Delivered At` if any language delivered, and the human opens the PR by hand.

---

## 5. MCP tool signature & output

The MCP wraps the skill for programmatic invocation. The wrapper is thin: validate the structured input, spawn an agent session via Claude Agent SDK with the skill allow-listed, return the structured result.

### 5.1 Tool registration (in engineerdad-site MCP server)

```ts
mcp__engineerdad_site__draft_article(spec: ArticleSpec) → DraftResult
```

| Aspect      | Value                                                                |
|-------------|----------------------------------------------------------------------|
| Server name | `engineerdad_site`                                                   |
| Tool name   | `draft_article`                                                      |
| Transport   | stdio (v1; HTTP later if relocated)                                  |
| SDK         | `@anthropic-ai/claude-agent-sdk` (spawns the session) + `@modelcontextprotocol/sdk` (exposes the tool) |
| Concurrency | Sequential — one session at a time per MCP process                   |

### 5.2 Output shape

```ts
type DraftResult = {
  ok:             true
  slug:           string             // echoes spec.slug
  lang:           "en" | "ms"
  branch:         string             // e.g. "draft/article-children-fund-malaysia"
  commit:         string             // 40-char hex sha
  pr_url?:        string             // GitHub draft-PR URL; omitted if PR step failed
                                     //   (commit + push may still have succeeded)
  files_modified: string[]           // absolute paths of all modified files
  defaults_applied: string[]         // human-readable notes, e.g. "slug derived from title"
  no_change:      boolean            // true if re-run with no diff
}
```

On failure, the MCP throws. Marketing OS interprets the throw as "do not mark DELIVERED."

---

## 6. Safety contract — what MUST be enforced

The skill has broad tool access (Read, Write, Edit, Bash, Grep) — which is what enables it to discover inter-links, read brand voice from existing articles, and update multiple files. The safety contract narrows this at the MCP and skill levels:

1. **Push is allowed only to `draft/article-*` branches; never to `main`; never force-push (except `--force-with-lease` on the same `draft/article-*` branch during idempotent re-run); never deploy.** The skill pushes the draft branch to `origin` and opens a draft PR via `gh` so the human can review/edit/merge — but the surface area is narrow. Enforce by: skill's SKILL.md explicitly forbids any push whose target is not `draft/article-*`, any push to `main`, and any plain `--force` (only `--force-with-lease` on the matching draft branch is allowed); test fixtures assert that no push command runs against `main` and no deploy command runs at all.
2. **No modification to `_template.html`** — the template is the contract.
3. **No deletion of any file** — additive only.
4. **No modification to other articles** in `/articles/` or `/ms/articles/` — only the new file is written.
5. **No deploy command** (`firebase deploy`, `npx firebase`, etc.) — deploy stays manual.
6. **All writes must land on the `draft/article-<slug>` branch**, never on `main` directly. If the agent finds itself on `main` at the start of a run, it must checkout a draft branch before writing.
7. **No writes outside the engineerdad-site repo root.** Path-traversal via slug is prevented by the `slug` regex (§3.1).
8. **No HTTP egress to the public internet** for content (the agent should not "research" by browsing — its grounding comes from the corpus and from existing articles in-repo). Fetching the `og_image` is the one allowed exception, and only for validation that the URL resolves.

The skill's SKILL.md must restate these as explicit rules in its instructions, so the LLM has them in context every invocation.

---

## 7. File layout (engineerdad-site repo)

```
engineerdad-site/
  .claude/
    skills/
      article-writer/
        SKILL.md                   ← THE SKILL — user authors
        context/
          brand-voice.md           ← supporting material referenced from SKILL.md
          aeo-geo-patterns.md      ← FAQ/HowTo schema, target-query patterns
          inter-link-policy.md     ← when/how to link to /tools/, /about.html, other articles
          format-affordances.md    ← when to use tables vs callouts vs blockquotes
  mcp/
    article-writer/
      package.json                 ← deps: @anthropic-ai/claude-agent-sdk, @modelcontextprotocol/sdk, zod
      tsconfig.json
      src/
        index.ts                   ← MCP server; registers draft_article tool
        session.ts                 ← spawns Claude Agent SDK session with skill allow-listed
        schema.ts                  ← Zod validation of ArticleSpec at the MCP boundary
      test/
        fixtures/
          a-structured-en.json     ← canonical programmatic input
          b-structured-ms.json     ← BM variant with hero image
          c-natural-language.txt   ← the same article expressed as a human prompt
        session.test.ts            ← runs the SDK session, asserts branch + commit + files
        safety.test.ts             ← asserts no git push, no _template.html edit, no deploy
```

---

## 8. SKILL.md — required shape (user authors content)

The skill author writes the body of SKILL.md (this is where the brand voice, AEO/GEO doctrine, layout patterns, etc. live). The skill MUST have:

### 8.1 Frontmatter

```yaml
---
name: article-writer
description: |
  Use this skill to write authority articles for engineerdad.my. Triggers
  on requests to draft, write, publish, or update an article — including
  ad-hoc market news, evergreen authority pieces, and articles fed in
  programmatically via the article-writer MCP. Produces the HTML article,
  updates sitemap.xml, llms.txt, and the articles index, and commits to a
  draft branch named draft/article-<slug>. Never pushes; never deploys.
---
```

The `description` is what Claude Code's skill router matches against — needs to be specific enough to trigger on relevant prompts ("write an article," "draft a news piece," etc.) and clear enough that the MCP path also activates it deterministically.

### 8.2 Required sections in the body

The body of SKILL.md should cover (sections the user authors):

1. **Inputs accepted** — restate §3 with examples; emphasize input-flexibility.
2. **Output produced** — restate §4 + §5; emphasize draft-branch isolation.
3. **Brand voice + tone** — what engineerdad sounds like. Cross-reference `context/brand-voice.md`.
4. **AEO/GEO requirements** — JSON-LD Article + BreadcrumbList + FAQPage; FAQ visible HTML must match JSON-LD exactly; `inLanguage` matches `<html lang>`. Cross-reference `context/aeo-geo-patterns.md`.
5. **Layout affordances** — when to use inline-styled tables (e.g., comparison data), when blockquotes serve, when not to over-format. Cross-reference `context/format-affordances.md`.
6. **Inter-linking policy** — what to link, how often, anti-patterns (don't over-link in body). Cross-reference `context/inter-link-policy.md`.
7. **Bilingual handling** — when MS, ALL UI strings switch per §4.5; never half-translate.
8. **Multi-file updates** — explicit list: sitemap.xml entries, llms.txt bullet, index.html article-card. Each with a tiny template the skill can follow.
9. **Git workflow** — checkout a `draft/article-<slug>` branch, commit, never push.
10. **Safety rules** — restated from §6 in plain language ("Never run `git push`. Never edit `_template.html`. Never deploy. Never modify other articles. Always work on a draft branch.").
11. **Default rules** — restate §3.4.
12. **Report format** — what the skill returns at the end (for programmatic + ad-hoc).

The skill author iterates on this file like a living document. Edits don't require a rebuild — Claude Code reads SKILL.md fresh each session.

### 8.3 Supporting context files

The `context/` directory holds supporting material the skill references. Each is a separate markdown file because:
- Smaller files = easier to iterate on without re-reading the whole SKILL.md
- Specific files can be loaded by the skill on-demand (the agent uses Read tool with specific paths)
- Cross-links from SKILL.md to context files make the structure browsable

Suggested initial set:
- `context/brand-voice.md` — extracted from engineerdad-site CLAUDE.md or hand-written; single source of truth
- `context/aeo-geo-patterns.md` — FAQ schema rules, structured-data conventions, target-query patterns
- `context/inter-link-policy.md` — when/how to link; anti-patterns
- `context/format-affordances.md` — table styles, callout patterns, the semiconductor article's valuation table as an exemplar

User adds/edits these over time as the skill matures.

---

## 9. Test fixtures

Three fixtures to validate the skill + MCP after build.

### 9.1 Fixture A — Programmatic structured input (EN)

`test/fixtures/a-structured-en.json`:

```json
{
  "slug": "test-minimal-article",
  "lang": "en",
  "title": "A Minimal Test Article",
  "description": "A short article used to validate the article-writer end-to-end.",
  "topic_tag": "TEST",
  "reading_time": "2 min read",
  "keywords": ["test", "validation", "mcp"],
  "brief_markdown": "## Why this exists\n\nThis article validates the article-writer skill + MCP.\n\n## What it tests\n\n- File written to the right path\n- All placeholders substituted\n- FAQ rendered in both visible and JSON-LD\n- Committed to a draft branch\n",
  "faq_markdown": "### What is this article?\n\nA test article used to validate the article-writer.\n\n### Why does it exist?\n\nTo verify the skill + MCP produce a valid HTML file and commit it correctly.",
  "og_image": "https://engineerdad.my/assets/og-default.png",
  "date_published": "2026-05-17"
}
```

Expected (asserted by `session.test.ts`):
- File at `engineerdad-site/articles/test-minimal-article.html`
- All `{{placeholder}}` substituted
- No `<meta name="robots" ...>` line in output
- Hero block removed (no `hero_image_url`)
- 2 `<details>` in `.faq-list`, 2 entries in `FAQPage.mainEntity` JSON-LD — identical Q/A
- Branch `draft/article-test-minimal-article` exists, contains the commit
- `sitemap.xml` has the new entries
- `llms.txt` has the new bullet
- `articles/index.html` has the new article-card
- No `_template.html` modification
- No `git push` invoked (mock-asserted)
- Return: `{ ok, slug, lang, branch, commit, files_modified, defaults_applied: [], no_change: false }`

### 9.2 Fixture B — Programmatic structured input (MS with hero image and 5 FAQs)

`test/fixtures/b-structured-ms.json`:

```json
{
  "slug": "ujian-artikel-bm",
  "lang": "ms",
  "title": "Ujian Artikel Bahasa Malaysia",
  "description": "Artikel ujian untuk mengesahkan article-writer menyokong BM dengan betul.",
  "topic_tag": "UJIAN",
  "reading_time": "3 minit bacaan",
  "keywords": ["ujian", "bm", "mcp"],
  "brief_markdown": "## Bahagian pertama\n\n...",
  "faq_markdown": "### Q1?\nA1.\n\n### Q2?\nA2.\n\n### Q3?\nA3.\n\n### Q4?\nA4.\n\n### Q5?\nA5.",
  "og_image": "https://engineerdad.my/assets/og-default.png",
  "hero_image_url": "https://engineerdad.my/assets/articles/test-hero.webp",
  "date_published": "2026-05-17"
}
```

Expected:
- File at `engineerdad-site/ms/articles/ujian-artikel-bm.html`
- `<html lang="ms">`; `og:locale: ms_MY`; `inLanguage: "ms"` in JSON-LD
- Breadcrumb home `/ms/`, articles `/ms/articles/`
- All UI strings from §4.5 use MS values
- Hero `<img src="...test-hero.webp" alt="Ujian Artikel Bahasa Malaysia" width="1600" height="900">` rendered
- 5 visible FAQ + 5 JSON-LD entries, lockstep identical
- Branch `draft/article-ujian-artikel-bm`
- `ms/articles/index.html` updated (not the EN one)
- `sitemap.xml` and `llms.txt` updated with the MS entry

### 9.3 Fixture C — Natural-language input (ad-hoc)

`test/fixtures/c-natural-language.txt`:

```
Write an article about how Malaysian parents should think about
inflation-protected savings for their children's education. Key
facts: education inflation in Malaysia has averaged 4–5% annually
over the past decade; PRS funds offer some inflation hedge; unit
trusts with foreign equity exposure also help. Target query:
"inflation protected savings malaysia children education".
```

Expected (assertions are looser since the skill defaults much of the input):
- A file is created somewhere under `/articles/<slug>.html`
- `slug` is reasonable (e.g., `inflation-protected-savings-malaysia-children-education` or similar — derived from title/topic)
- `lang` defaulted to `en`
- `date_published` is today
- `og_image` defaulted to site OG
- Branch created
- Skill's report includes `defaults_applied` listing the derivations (so human can audit)

### 9.4 Negative tests

The skill/MCP MUST refuse and surface clear errors for:

- `slug: "Invalid Slug With Spaces"` → regex validation fails
- `slug: "../../etc/passwd"` → regex validation fails
- `lang: "zh"` → enum validation fails
- `og_image: "http://insecure.example.com/x.png"` → not HTTPS
- A prompt asking the skill to push to remote → skill refuses, surfaces the safety rule
- A prompt asking the skill to delete an existing article → skill refuses

---

## 10. Implementation notes

### 10.1 Claude Agent SDK setup (MCP side)

The MCP's `session.ts` spawns a session:

```ts
import { createAgentSession } from '@anthropic-ai/claude-agent-sdk'

const session = await createAgentSession({
  cwd: '/Users/solid/Code/engineerdad-site',
  allowed_tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Skill'],
  allowed_skills: ['article-writer'],
  system_prompt_addendum:
    "You are being invoked programmatically via the article-writer MCP. " +
    "Use the article-writer skill to process the input spec. Return a " +
    "structured JSON result in your final message matching the DraftResult shape.",
  input: JSON.stringify(spec),  // the validated ArticleSpec
  model: 'claude-sonnet-4-6'    // or whatever the user prefers
})

const result = await session.run()
const draftResult = parseDraftResult(result.finalMessage)
return draftResult
```

The exact SDK API may differ; user verifies against the Agent SDK docs at build time.

### 10.2 Dependencies

- `@anthropic-ai/claude-agent-sdk` — spawns Claude Code agent sessions programmatically
- `@modelcontextprotocol/sdk` — MCP server framework
- `zod` — input validation
- Node `fs`, `path`, `child_process` — for any non-SDK direct file/git work

### 10.3 Registration in Marketing OS

After the MCP is built, Marketing OS adds it to `.mcp.json`:

```json
{
  "mcpServers": {
    "engineerdad_site": {
      "command": "node",
      "args": ["/Users/solid/Code/engineerdad-site/mcp/article-writer/dist/index.js"],
      "type": "stdio"
    }
  }
}
```

Marketing OS's `media-production` agent then declares `mcp__engineerdad_site__draft_article` in its tools list.

### 10.4 Cost & latency expectations

A full agent-session invocation for an article will likely consume:
- 10–30k input tokens (reading template, recent articles, sitemap, index pages, context files, the skill itself)
- 4–10k output tokens (the article body + multi-file diffs + the structured report)
- 30–90 seconds wall-clock
- $0.10–$0.50 in API cost (model-dependent)

These are rough estimates; first 5 real runs will calibrate.

### 10.5 Error categories

| Error                                  | Code in thrown Error.message              |
|----------------------------------------|--------------------------------------------|
| Spec validation failure                | `VALIDATION_FAILED: <field>: <reason>`    |
| SDK session failed to start            | `SESSION_INIT_FAILED: <reason>`           |
| Skill produced incomplete output       | `SKILL_INCOMPLETE: <missing>`             |
| Git command failed                     | `GIT_FAILED: <stderr>`                    |
| `gh` CLI step (push or PR open) failed | `PR_FAILED: <stderr>`                     |
| Safety rule violation (skill attempted) | `SAFETY_VIOLATION: <which>`              |
| Filesystem write failed                | `WRITE_FAILED: <path>: <reason>`          |

---

## 11. Open decisions (user confirms before/during implementation)

1. **MCP source location.** Suggested `/Users/solid/Code/engineerdad-site/mcp/article-writer/`. Confirm at build start.
2. **Template UI-string approach.** Recommended: extend `_template.html` to add placeholders for the bilingual UI strings (§4.5). Alternative: skill post-processes EN→MS. Confirm during build.
3. **Skill model choice.** Default suggestion: `claude-sonnet-4-6` (cheaper, fast enough). For higher-stakes articles, switch to `claude-opus-4-7`. Decide at session-spawn time, possibly configurable per ArticleSpec.
4. **Branch naming when `lang=ms`.** Recommended `draft/article-<slug>` regardless of lang (slug is unique across languages). Alternative: `draft/article-<slug>-ms`. Confirm.
5. **Idempotent re-run behavior.** When `draft/article-<slug>` already exists: recommended behavior is checkout existing branch, regenerate, amend the commit. Alternative: throw and require explicit `force=true` flag. Confirm.
6. **Context file initial population.** `brand-voice.md`, `aeo-geo-patterns.md`, etc. — user authors these from existing engineerdad-site CLAUDE.md or hand-writes. Empty-file stubs at v1 are acceptable; iterate.

---

## 12. Cross-references

- ADR-015 — safety doctrine; the skill enforces §6 invariants explicitly.
- ADR-016 — establishes why the skill + MCP live in engineerdad-site, not Marketing OS.
- ADR-017 — establishes the orchestrator pattern; Marketing OS's `media-production` is the orchestrator that calls this MCP among others.
- TASKS.md E-008 — umbrella enhancement entry for this work.
- TASKS.md E-013 — push-and-PR back-fill: AuthorityArticles `PR URL EN/BM` columns + distribution agent wiring (store side of `pr_url`).
- Marketing OS store schema: `packages/store/src/schema.ts` (AuthorityArticles).
- Marketing OS distribution agent: `.claude/agents/distribution.md` §4c.3 (PR URL back-fill).
- Plan source: `~/.claude/plans/purring-crafting-perlis.md` Phase E.
- Site template: `/Users/solid/Code/engineerdad-site/articles/_template.html`.
- Reference real article (acceptable body-HTML deviation): `/Users/solid/Code/engineerdad-site/articles/semiconductor-unit-trust-malaysia.html`.
- Claude Agent SDK: external docs at build time.
