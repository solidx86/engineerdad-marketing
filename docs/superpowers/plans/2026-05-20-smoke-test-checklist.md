# Organic Social Cadence v1 — Smoke Test Checklist

**Branch:** `feat/organic-social-cadence` (33 commits ahead of main)
**Status when leaving:** all code shipped + tests green + migrations applied. Only the live end-to-end smoke test (Task 8.3 step 6) remains — needs you present.

---

## What's already verified autonomously

- ✅ `pnpm -r build` — clean across all 12 packages
- ✅ `pnpm test` — 33 files, **183 tests**, all pass
- ✅ `pnpm sync:agents:check` — 0 of 8 agents needing sync
- ✅ Live Notion migrations applied (idempotent): 14 fields on CreativeVariants + Channel on Hypotheses (3 legacy rows back-filled)
- ✅ Live SQLite migration applied: `creative_signals` table on `data/engineerdad.sqlite`

## Pre-flight — populate env vars

Edit `.env` at repo root and fill these (newly required by Phase 2 + Phase 3):

```
# Meta organic (IG Business + FB Page)
META_ORGANIC_PAGE_ID=
META_ORGANIC_IG_USER_ID=
META_ORGANIC_ACCESS_TOKEN=

# HeyGen (AI avatar renders for Reels)
HEYGEN_API_KEY=
HEYGEN_AVATAR_ID=
HEYGEN_VOICE_ID=
```

- Page ID + IG Business User ID + long-lived Page access token: Graph API Explorer (token must include `pages_manage_posts`, `pages_read_engagement`, `instagram_content_publish`, `instagram_basic`).
- HeyGen IDs: train your avatar (mixed EN+BM source video ~2min) + voice clone (mixed EN+BM audio ~3min) in HeyGen web UI on Creator tier ($29/mo). Note the IDs.

## Restart Claude Code

After editing `.mcp.json` (Phase 2.10 + 3.2 added `meta-organic` + `heygen`) and `.env`, **restart Claude Code** so the new MCPs load.

## Smoke test sequence (Task 8.3 Step 6, a–g)

### (a) HeyGen probe — verify avatar/voice render

In Claude Code:

> "Use `mcp__heygen__generate_video` to render a 5-second BM clip with avatar_id from env, voice_id from env, input_text='Hai, ini Shoo dari EngineerDad', language=ms, aspect_ratio=9:16. Don't save the result — just confirm we get a jobId, then call `mcp__heygen__get_video_status` to poll once."

Expected: jobId returned, status `"processing"` on first poll. Cost: ~$0.30.

### (b) /post-week dry-run

Pre-req: ensure ≥5 CreativeVariants in live Notion with `Channels ∋ Meta-organic`, `HG3 Status = Approved`, `Asset Files != ∅`. Should come from a prior `/loop-once` batch.

Run:
```
/post-week --reel=skip
```

(`--reel=skip` avoids the HeyGen cost on this smoke run.)

Expected: 4 Notion CreativeVariants rows flip to `Organic Status = Drafted`, `Organic Scheduled For` populated (Tue 7pm carousel + Mon/Wed/Fri 8/8/6pm images). Summary returned.

### (c) /distribute dry-run

In Notion, manually approve all 4 (set `Organic Status = Approved`).

Run:
```
/distribute --channels=meta-organic --dry-run
```

Expected: planner walks the routing logic; no Graph calls made; clean report.

### (d) Real /distribute (controlled — actually schedules posts)

```
/distribute --channels=meta-organic
```

Expected: 4 scheduled posts appear in Meta Business Suite UI (FB Page → scheduled posts; IG → Creator Studio scheduled). `IG Post ID` + `FB Post ID` back-filled in Notion.

**Verify in Meta UI**, then **cancel each manually** to avoid actual publication — OR call `mcp__meta-organic__cancel_scheduled_post({ postId })` for each.

### (e) Idempotency check

Re-run:
```
/distribute --channels=meta-organic
```

Expected: rows with populated IDs are skipped; no new posts created.

### (f) Insights ingest (optional — needs a real published post)

For a real test, manually publish ONE of the cancelled posts via Meta UI, wait an hour for impressions, then:

```
Call mcp__analytics__ingest_meta_organic_insights with variants=[{variantId, igPostId, fbPostId}].
```

Expected: `creative_signals` rows populated. Verify via:

```bash
sqlite3 data/engineerdad.sqlite "SELECT * FROM creative_signals LIMIT 10;"
```

### (g) /reflect channel-routing probe

In Notion, create a test Hypothesis row with `Channel = Meta-organic`. Run:

```
/reflect
```

Expected: per-channel grader fires; returns `Inconclusive` (no organic data yet) — that's the correct response.

---

## After smoke test passes

1. **Merge to main:**
   ```bash
   git checkout main
   git merge --no-ff feat/organic-social-cadence -m "merge: organic social cadence v1"
   git push origin main
   ```

2. **Or open a PR** if you want review history:
   ```bash
   gh pr create --base main --title "Organic Social Cadence v1 (Slice A)" --body "$(cat docs/superpowers/specs/2026-05-19-organic-social-cadence-design.md | head -80)"
   ```

3. **Mark TASKS.md "Blocked on humans" smoke-test item resolved.**

---

## Rollback if smoke test fails

```bash
git checkout main
git branch -D feat/organic-social-cadence  # only if you're certain
```

The live Notion migrations are additive-only; rolling back the code leaves the new fields harmlessly empty. The `creative_signals` SQLite table can stay (it's empty until something writes to it).
