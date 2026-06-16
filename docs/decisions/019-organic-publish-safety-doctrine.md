# 019 — Organic-publish safety doctrine: schedule-only, never immediate

**Status:** Accepted (2026-05-19)

**Context:** Slice A of the organic-social-cadence spec adds publishing to IG Business + FB Page via `mcp-servers/meta-organic/`. Unlike paid Meta (`status=PAUSED` hard-wired per ADR-015) or YouTube (`privacyStatus=unlisted` per ADR-015), organic posts have no draft state — once the Graph API publish call returns, the post is public to followers and the algorithm. A buggy agent, a re-run, or a misconfigured idempotency key could expose unreviewed content immediately.

**Decision:** Four constraints hard-wired at the `mcp-servers/meta-organic/` layer:

1. **No immediate publish path.** Every `publish_*` tool requires `scheduled_publish_time` ≥ `now + 10 minutes`. There is no `--allow-immediate` parameter — not gated, doesn't exist in any tool's input schema. Refuses with `immediate_publish_disabled`.
2. **Validate window.** `scheduled_publish_time` ≤ 75 days in future (Meta's hard cap). Refuses with `out_of_schedule_window`.
3. **Compliance pre-flight.** The same scanner used for paid (`packages/shared/src/compliance.ts`, citing `corpus/compliance/{sc-malaysia,fimm,public-mutual}.md`) runs on every caption before any publish call. Fails closed.
4. **Idempotency key.** Each publish call carries `(Variant ID, platform)` as idem key; double-fires return the existing post ID rather than duplicating.

**Consequence:** A post only lands instantly if a human manually edits `Organic Scheduled For` in Notion to exactly `now + 10min` — and even then Meta queues it server-side. The human always has a 10-minute window to cancel via Meta's UI before it goes live. This mirrors the ADR-015 spirit ("write-API may create/edit but never activate") adapted to organic, where the analog of `PAUSED` is `scheduled_publish_time >= now+10min`.

**Alternatives considered:**

- *Immediate publish guarded by an extra approval bit.* Rejected: any approval gate that can be bypassed by a bug is not a safety doctrine. Removing the parameter entirely is the only fail-closed posture.
- *Mirror paid's PAUSED model literally with a Notion-side "Activate" gate.* Rejected: organic posts have no platform-side draft state to "activate"; only scheduling.

**Implementation refs:**
- `mcp-servers/meta-organic/src/validation.ts` — `validateScheduledPublishTime` (constraints 1+2)
- `mcp-servers/meta-organic/src/compliance.ts` — `preflightCompliance` (constraint 3)
- `mcp-servers/meta-organic/src/tools/publish-*-post.ts` — invoke validation + compliance before any network call

---

## Amendment (2026-05-21) — Instagram has no scheduled-publish API (B-005)

Discovered during the run_1778486942 smoke test (step d). Meta's **Instagram Content Publishing API** (`/{ig-user-id}/media_publish`) has **no scheduled-post capability**: a `scheduled_publish_time` passed to it is silently ignored and the post goes live immediately. Three IG posts published instantly during the test, 4–7 days early.

**Doctrine impact.** Constraint #1 ("no immediate publish path") and the 10-minute cancel window it guarantees **cannot be enforced for Instagram** through the API — there is no server-side scheduled queue for the post to wait in, so there is nothing to cancel. The analog to ADR-015's `PAUSED` simply does not exist on the IG publishing surface.

This amendment does **not** weaken the doctrine. Constraints #1–#4 remain fully in force for **Facebook Page** posts, where native scheduling does exist and works correctly:
- FB feed photos — `/feed` + `attached_media` + `unpublished_content_type=SCHEDULED` (see B-007).
- FB Reels — `/video_reels` finish phase + `video_state=SCHEDULED` (see B-009).

**Resolution — fail closed at the MCP surface.** Rather than let `meta-organic` accept an IG publish call it cannot honour safely, IG publishing is **disabled at the tool boundary**. `publish_image_post` / `publish_carousel_post` / `publish_video_post` reject `platform: "ig"` with `ig_publish_disabled` before any network call (`mcp-servers/meta-organic/src/ig-guard.ts`). This is stronger than rejecting inside `validateScheduledPublishTime`: IG has no publish path through this server at all, so no caller — `/distribute` or otherwise — can trigger a silent immediate publish.

**Human-in-the-loop substitute for IG.** Approved IG-bound Variants are published manually: the webapp posting-pack page (`/posting-pack/organic/<runId>`) renders the approved organic queue as a read-only pack a human posts from the Instagram app at the intended time, then pastes the post ID back to clear it from the queue. Human review is preserved; the schedule is enforced by the human, not the API. (The legacy `scripts/build-posting-pack.mjs` R2-HTML aid was retired 2026-05-30.)

**Proper fix — E-024.** The always-on scheduler/executor will hold each IG post and fire an *immediate* `media_publish` at the scheduled minute from a self-hosted job, restoring a real schedule (and a real pre-fire cancel window) for IG. When E-024 lands, delete `ig-guard.ts` and its three call sites in `index.ts`.

**Updated implementation refs:**
- `mcp-servers/meta-organic/src/ig-guard.ts` — IG tool-surface disable (B-005)
- `apps/webapp/src/app/posting-pack/organic/[runId]/page.tsx` — manual IG posting aid (`/posting-pack`); replaced the retired `scripts/build-posting-pack.mjs`
