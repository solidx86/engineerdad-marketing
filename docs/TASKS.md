# EngineerDad Marketing OS — Tracker

## Status (as of 2026-06-02)
- **ADR-030 (data-first claim binding) shipped** on `feat/data-first-claim-binding` — closes **B-038** (P0, mis-paired chartRef) and **B-036** (P2, figures leaking into concept visuals), both now structurally enforced by the C1 + P1 verifiers. Mode-C (narrative-flow drift) filed as the B-039 sibling.
- **Open**: 10 bugs — B-039 (P2, narrative-flow drift across multi-slide/scene creatives — ADR-030 Mode-C sibling); B-037 (P1, Reel renders strand after produce advances — `assetFiles` not persisted on success + no resume path for poll-timeout); B-005 (P1, IG immediate-publish; proper fix is E-024); B-010 (P1, dry-run fix landed, E2E unverified); B-015 (P3, superseded by ADR-023 path-aware substitution); B-016 (P1, verifier audit — content slice fixed, rest open); B-017 (P3, analytics test `DATABASE_URL` prefix); B-028 (P3, Reel/YT video assets — Reel side shipped, closes at E-004 G4; YT-Long open); B-030 (P1, article D2b fanout missing); B-031 (P2, Feed 4:5 not channelled to Meta-organic). Enhancements: see "Open enhancements" below (E-003/004/005/006/007/011/012/015–020/022/024/026/028/029-followup/032/033/036–048).
- **Next** — Phase 1 (calibration suite) is the umbrella-spec target. The HeyGen Reel pipeline merged 2026-05-30 (ADR-028) — closes E-004 for Reel 9:16 once 5 production Reels pass HG3 at ≥60% (G4 gate). Reel two-type visual scene model (ADR-029) merged 2026-05-30 on `feat/reel-visual-scenes` — `sceneType face|visual`, visual VO budget (face ≤30, visual ≤45), frames harness, reference designs.
- **Recently shipped** — Meta-paid manual posting pack + webapp migration (2026-05-30, `feat/meta-paid-posting-pack`): flag-gated `META_PAID_MODE=manual` (default) renders a per-run webapp pack at `/posting-pack/<runId>` instead of creating ads via API; HG4 removed (ADR-015 amendment); the IG organic pack moved to `/posting-pack/organic/<runId>` and the R2-HTML script retired. See [`DONE.md`](./archive/DONE.md).
- **Shipped-work history** → [`DONE.md`](./archive/DONE.md).

## Open bugs

### B-039 `v1.5` `P2` `agents` `orchestrator` — narrative-flow drift across a multi-slide/scene creative (composition coherence)
Filed 2026-06-02 as the Mode-C sibling deferred out of ADR-030. ADR-030 binds each *quantitative claim* to data (the *what's-on-this-slide-true* axis), but does not check *composition* — whether a Carousel's slides tell one connected story (no gap/non-sequitur between cards) or whether a Reel's scenes flow as a single argument. A creative can be fully data-bound yet read as disjointed slides. Out of scope for ADR-030 (which is chart-data-only by the user's explicit scoping). Candidate approach: a CD self-QA pass + a soft P1 flag for inter-scene narrative continuity (headline-to-headline coherence, no dangling setup/payoff). Lower priority than the data-integrity guards now shipped.

### B-037 `v1.5` `P1` `mcp` `orchestrator` — Reel renders strand after produce advances: `assetFiles` not persisted on success + no resume path for a poll-timeout
Surfaced 2026-06-01 during the run_1779895374 produce walk. Both reels rendered fine on HeyGen but neither reached the webapp ("no asset generated yet" at HG3). Two distinct defects:
- **(A) Persistence gap — `renderState: "Uploaded"` written with `assetFiles: []`.** Reel `5bd4a299-4154-4b46-9417-e89b576a75f1` (folder `9d695d39c2ac`): HeyGen completed (job `f73459fd…`, 50.96s); the worker's **return JSON contained the correct `assetFiles`** (proven via the step-result payload), so computation was fine — the loss is purely in DB persistence. Mechanism: `packages/store/src/crud.ts:118-119` hands `props` straight to drizzle `.set()` with **zero validation** (`patch = {...props, updatedAt}; db.update().set(patch)`). The reel worker's terminal write (`reel-render-worker.md` Step 5) sends `{ renderState, assetFiles, durationSeconds, subtitleUrl }`, but **`durationSeconds` and `subtitleUrl` are not columns** on CreativeVariants (schema has only `asset_files`, `render_state`, `render_started_at`), and timestamp columns throw `value.toISOString is not a function` on a string (the worker already hit this on `renderStartedAt` at Step 4a and reacted by re-issuing a stripped write). Likely the same throw recurred on the combined Step-5 write and the defensive re-issue set `renderState: Uploaded` but dropped `assetFiles`. **Not fully provable** — the worker's tool-call transcript isn't retained; only the step-result payload is. The webapp reads `assetFiles`, so a state-only flip renders nothing. NB: this is a single occurrence (`5bd4a299`); the second reel's empty `assetFiles` was a *different* cause — a genuine poll-timeout (defect B below), not this.
- **(B) No resume once P2-render is advanced.** `reel-render-worker.md` line 244 promises "next `/produce --run=<id>` pass resumes via `resumeFromJobId`" on poll-timeout — but the orchestrator verifies+advances P2-render as soon as the fanout returns refs (timeout exits non-fatally with a ref), so a later `plan()` returns the **HG3 gate**, never re-spawns the reel. Reel `d4b910aa` (job `1981533258…`) sat at `HegyenGenerating` with no mechanism to finish it. The "resume next pass" doctrine is only true if P2-render is *not yet advanced*; once it is, the timed-out reel is stranded.
- **Manual recovery applied 2026-06-01** (unblocks this run's HG3, not a fix): both jobs were `completed` on re-poll; downloaded MP4s → `mcp__asset-store__upload` → `store.update` `assetFiles` + `renderState: Uploaded` + duration. Both rows now carry HTTPS asset URLs.
- **Reproduced 2026-06-12** on run_1781193285 (both reels, defect A shape): HeyGen completed and both worker step-result payloads carried correct `assetFiles` (public R2 URLs, HTTP 200), but both pre-created Reel rows stayed `assetFiles: []` through P3-persist and P5-confirm to HG3. Note the payloads' `variantId` is the *render-unit folder id* (e.g. `f2ac0da2091c`), not the pre-created row UUID — id-mapping in the persist path is a candidate mechanism alongside the Step-5 write-shape theory. Manual recovery: copied `assetFiles` from the two step-result payloads into the rows via psql (matched by scriptId). Strengthens the case for fix (A)(3): an `Uploaded`/HG3-bound reel with empty `assetFiles` must fail verify.
- **Fix (A)**: three layers — (1) reconcile the Step-5 write with the schema: either add `duration_seconds`/`subtitle_url` columns or drop them from the worker prompt (currently phantom keys); (2) make `store.update` validate props against the table's real columns and reject unknown/ill-typed keys loudly instead of relying on drizzle silently dropping them / throwing mid-write; (3) add a produce verifier assertion that every `Uploaded` reel carries a non-empty `assetFiles`, so a state-only flip fails verify instead of reaching HG3.
- **Fix (B)**: either hold P2-render open while any unit is `HeygenGenerating` (re-spawn resume units on the next pass before advancing), or add a dedicated reel-resume step the orchestrator can re-enter post-advance. At minimum, correct the false "resumes next pass" claim in `reel-render-worker.md:244`.

### B-031 `v1.5` `P2` `shared` `agents` — Feed 4:5 not channelled to Meta-organic; organic copy + schedule missing
Surfaced 2026-05-28. `packages/shared/src/derive/specs.ts` assigns Feed (4:5) `channels: ["Meta-paid"]` only, but the downstream IG posting-pack script (`scripts/build-posting-pack.mjs:114`) treats every approved variant that isn't `Carousel 1:1` as IG-postable — explicitly including Feed 4:5. Because Feed never carries `Meta-organic` in its channels: (a) the organic-copy populator at deriveSpecs never fills `organic_caption_en/bm`, `organic_hashtags_ig/fb`, or `organic_language` for Feed variants; (b) `schedule.ts`'s S2-stamp filter `channels.includes("Meta-organic")` skips Feed, so `organic_scheduled_for` is null. Result: Feed posts arrive in the IG pack with "(empty)" caption, "(none)" hashtags, and "no date set". The `CADENCE` table in `packages/shared/src/derive/schedule.ts:39-43` already has Feed cadence slots (Mon/Wed/Fri MYT) — they're dormant because no Feed variant ever opts in. Fix: extend deriveSpecs to add `Meta-organic` to Feed's channels (single-image IG post — caption + hashtags + organic_language; FB carousel layout doesn't apply); ensure the organic-copy populator covers single-image Feeds; CADENCE will then start firing for Feed. Manual sibling-Carousel copy works for run_1779895374 but won't survive a fresh produce walk.

### B-030 `v1.5` `P1` `orchestrator` — Article path missing from D2b fanout
Surfaced 2026-05-28 during the run_1779895374 HG3→HG4 validation walk. D1-query selected 1 approved AuthorityArticle, but the D2b-route fanout emitted 10 units (6 Meta-paid + 2 YouTube + 2 Meta-organic) — no article unit. Either `planDistribution` is dropping articles when the variant fanout has rows, or article routing lives in a separate stage not yet implemented. Confirm by reading `packages/orchestrator/src/distribute/plan-distribution.ts` for the article codepath. Either fix the planner to emit one D2b unit per approved article, or document the article routing path (separate stage / direct write).
### B-028 `v1.0` `P3` `mcp` `media` — Reel + YT-Long variants have no rendered video assets
Surfaced 2026-05-28. The produce-stage render-worker renders stills only (Feed, Carousel) per `corpus/templates/worker-prompts/render-worker.md`. Reel and YT-Long variants are persisted as VariantSpec rows with empty `asset_files`. The heygen + kie-ai MCPs that turn scripts into video MP4s are not wired into P2-render. Consequence at distribute: YouTube worker calls `mcp__youtube__upload_video` with empty `file_url` and skips; Meta-paid Reel ads (when D2a is fixed) will similarly fail at creative upload. This is the long-deferred video pipeline (E-004) — the immediate blocker is making Reel/YT-Long variants legitimately skip at HG3 (or block their approval) rather than ship into distribute as unfulfillable.
- **Reel side**: addressed 2026-05-29 by the HeyGen Reel pipeline (E-004 rescope) — see `feat/heygen-reel-pipeline`. Closes for Reel 9:16 once E-004's G4 gate passes (≥60% HG3 approve rate over 5 production Reels).
- **YT-Long side**: filed as E-004a follow-up (same `reel-render-worker` HeyGen-native pipeline at 16:9).

### B-017 `v1.5` `P3` `infra` — `@engineerdad/analytics` test script missing `DATABASE_URL` prefix
The `"test"` script in `packages/analytics/package.json` runs `vitest run` without a prefixed `DATABASE_URL=...`, unlike `@engineerdad/store` and `@engineerdad/orchestrator`. The suite passes only because `truncatePg()` uses whatever `DATABASE_URL` is in the ambient environment. In CI or a fresh shell (no `.env.local` loaded), the analytics test suite will fail at the guard. Fix: add `DATABASE_URL=postgresql://engineerdad:engineerdad@localhost:5432/engineerdad_test vitest run` to match the other two DB-dependent packages.



### B-005 `v1.0` `P1` `mcp` — IG organic posts publish immediately; ADR-019 schedule-only doctrine unenforceable on IG
Discovered 2026-05-21 during run_1778486942 smoke-test step (d). `mcp-servers/meta-organic/src/tools/publish-image-post.ts` + `publish-carousel-post.ts` pass `scheduled_publish_time` to the IG `/media_publish` call — but Meta's IG Content Publishing API has **no** scheduled-post support. The parameter is silently ignored; the post goes live immediately. 3 IG posts published instantly during the test (4–7 days early) and were manually deleted by the user.
- **Doctrine impact**: ADR-019 constraint #1 ("no immediate publish path; `scheduled_publish_time` ≥ now+10min is the safety window") is **not enforceable on IG** — there is no server-side scheduled queue to hold the post, so no cancel window exists. FB native scheduling (`published=false` + `unpublished_content_type=SCHEDULED`) works correctly; the defect is IG-only.
- **Temporary mitigation** (built 2026-05-21; migrated to the webapp 2026-05-30): a read-only manual-posting aid so the user can post IG himself from the approved queue — now the per-run page `/posting-pack/organic/<runId>` (the old R2-HTML `scripts/build-posting-pack.mjs` is retired). Tracked inline; not a deferred item. B-005 stays open — the mitigation is a human workaround, not the automated schedule the bug needs (E-024).
- **Proper fix**: E-024 (always-on scheduler/executor). Until then, `/distribute --channels=meta-organic` must skip IG legs — FB-only.
- **Also revise**: ADR-019 to state the IG reality honestly + meta-organic IG `validateScheduledPublishTime` should reject (not silently pass) future times until E-024 lands.

### B-010 `v1.0` `P1` `infra` — distribute dry-run + channel-filter unreachable via the command surface
The distribute stage reads `dryRun` / `channelFilter` / `dailyBudgetMyr` off `run.params` (`packages/orchestrator/src/stages/distribute.ts:137` — `run.params as unknown as DistributeParams`), but `createRun` stores params only as `{ args: "<raw string>" }` (`packages/orchestrator/src/engine.ts:36`). Nothing parses that args string into typed params — a repo-wide grep finds zero `parseArgs` / `--dry` handling. So `params.dryRun` is always `undefined`: every distribution runs for real, and `/distribute --dry-run` / `--channels=` are silent no-ops.
- **Discovered**: 2026-05-22, manual test — attempted a `/distribute` dry-run while walking the rebuilt loop.
- **Impact**: the dry-run *safety preview* the `/distribute` command advertises does not exist; channel scoping cannot be applied. External exposure stays bounded — distribution is HG3-gated and Meta entities land PAUSED (ADR-015) — but a silently-ignored safety flag is a P1 silent-bug-class defect.
- **Fix**: parse the run-creation `args` string into typed params — a shared run-args parser at `createRun` (`--dry-run`, `--channels=a,b`, `--daily-budget=N`), or have the distribute stage parse `run.params.args`. The `as unknown as` double-cast is the marker; once params carry the real shape, the cast drops out.
- **Also check**: `channelFilter` + `dailyBudgetMyr` ride the same gap; audit whether any other stage casts `run.params` to a typed shape it never actually receives.
- **Status**: fix landed 2026-05-22 — `parseRunArgs()` (`packages/orchestrator/src/run-args.ts`) wired into `engine.plan()`; run params now carry typed `dryRun` / `channelFilter` / `dailyBudgetMyr`. Unit-tested (`run-args.test.ts`, 6 specs). End-to-end check (a real `/distribute --dry-run`) still pending.

### B-015 `v1.5` `P3` `infra` — A1-ingest `$insights` capture is shape-ambiguous
`analytics` A1-ingest emits `{ tool: "ingest_meta_insights", args: { rows: "$insights" } }`. `$insights` captures the prior `get_insights` call's result — but `get_insights` returns a `{ rows: [...] }` envelope, so a literal substitution yields `{ rows: { rows: [...] } }`, which `ingest_meta_insights` (it wants `rows: [...]`) rejects. The 2026-05-22 verification walk only got it right because the conductor unwrapped the envelope by judgement.
- **Discovered**: 2026-05-22 `/loop` verification walk (run_1779446750), A1-ingest.
- **Fix**: cleanest is `analytics.ts` emitting `args: "$insights"` for the ingest call — `get_insights`'s `{rows:[...]}` result already matches `ingest_meta_insights`'s input shape exactly, so the whole `args` *is* the captured result. Alternatively loop.md's `$`-capture text could specify envelope-unwrap.
- **Why P3**: a sensible conductor handles it and the 2026-05-22 walk passed; this is a robustness/precision nit, not a walk-blocker.

### B-016 `v1.5` `P1` `infra` — verifier audit: acceptance tests too thin to catch under-spec agent output
Each stage's `verify` is the orchestrator's *only* automated acceptance test — but several are structural-presence checks ("did the worker return an object / a non-empty array") rather than spec-conformance checks. A worker can hand back a Script with an empty `Script EN` body, a Brief missing its BM half, or a hook bank well under the §8 count, and `verify` passes it `ok: true`. The human gate is then the sole real backstop — which defeats the "verifiable + deterministic" premise of an agentic loop.
- **Origin**: 2026-05-22, run_1779446750 content stage. `verifyContent` passed an 18-hook bank against a hard ≥30 rule (`HookBankSchema.min(30)`, `zod.ts`) because it only checked "≥1 script exists". The content-writer self-reported the 18 honestly; nothing failed it.
- **Content slice already fixed** (2026-05-22): `verifyContent` now validates every hook bank — ≥30 hooks, all six registers present, ≥3 per register — from the return JSON's `registerCounts`; `verify-content.test.ts` (8 specs, TDD); `content-writer.md` §4a tightened so the agent skips a Brief it can't fully stock instead of shipping a short bank with a deferral note. This row tracks the **remaining verifiers**.
- **Scope**: audit every step `verify` — `verify-brief`, `verify-synthesize`, `verify-schedule`, `verify-experiment`, the produce/distribute verifiers, and the inline gate verifiers. For each ask: does it assert the artifact satisfies its spec rule, or just that *something* came back? Where `packages/shared/src/zod.ts` already encodes the rule (`.min()`, bilingual presence, required fields, required relations), run that schema through the verifier — several schemas are currently dead at the orchestrator boundary (`HookBankSchema.min(30)` was, until the content fix).
- **Known gaps to check specifically**: bilingual EN+BM both present and non-empty on every bilingual field (the "EN body silently missing" case); Brief↔Script relation set; proof-ratio arithmetic; all count/coverage rules.
- **Why P1**: silent-bug class — under-spec output clears automated acceptance and only a human gate catches it, and only if the human happens to notice.
- **No spec needed** — a mechanical per-verifier hardening pass; each verifier change TDD'd against a red test that feeds it under-spec output.

## Open enhancements

### E-033 `v1.5` `P3` `agent` `orchestrator` — Critic / evaluator step pattern for expert-judgement outputs
**The seam.** The automated verifier (`packages/orchestrator/src/verifiers/*.ts`) catches structural compliance — count, schema, presence, ratio. But several stage outputs require *expert judgement* the foreman cannot apply with a checklist alone: brain's strategic angle selection, creative-director's tonal coherence across 4 creatives, render-worker's visual layout quality, content-writer's hook punchiness. Where structural verification is insufficient today, the system leans on the human gate (HG1/HG2/HG3) as the catch-all. That pushes judgement load late in the cycle and doesn't scale as run volume grows.
**Industry pattern.** "LLM-as-judge" / "evaluator-optimizer" / "critic agent." Published by Anthropic in *Building Effective AI Agents* ("Evaluator-optimizer" workflow). LangGraph reflection loops, AutoGen critic agents, and Constitutional AI all instantiate it. The pattern is first-class enough that mature frameworks ship "judge" as a step kind alongside "tool call" and "LLM call."
**Shape.**
- New step kind `evaluate` in the orchestrator engine, with `step.evaluatorAgent` + `step.evaluationPrompt`. Conductor dispatches via `Task` exactly like a spawn (per ADR-023's reasoning-vs-mechanical split). Worker returns a verdict ref. Orchestrator's verifier consults the verdict alongside its structural check.
- Convention: only stages where structural verification is insufficient get an evaluator. Initial candidates — `synthesize` (brain), `brief` (brief-writer), `produce` (creative-director, render-worker).
- The orchestrator's verifier owns the decision to *invoke* a critic. Foreman calls in the master tradesperson; conductor dispatches.
- Composes cleanly with ADR-023's verify-folds-into-advance — the critic-Task is the conductor-resident counterpart to the orchestrator's mechanical work.
**Cross-references.**
- **ADR-023** (umbrella doctrine, *in progress on feat/adr-023*) — defines the conductor-thin posture this enhancement composes with. ADR-023 specifies *what the conductor does and doesn't do*; E-033 specifies *what the verifier can ask the conductor to do on its behalf*.
- **`docs/superpowers/specs/2026-05-24-brain-moe-critic-topology-design.html`** — concrete worked example: brain as mixture-of-experts + reconciling critic. Prefigures the general pattern at one stage (`synthesize`); E-033 generalizes to a step-kind that every stage can opt into.
- **B-016** (verifier audit) — the current structural-verify hardening pass. Once B-016 ships, the natural next layer is E-033's critic step for the cases where no structural rule can carry the load.
**Why P3.** Loop runs and decides without it. Human gates are the working backstop. Becomes a real lever once run volume grows enough that human-gate review-load is felt, or when a specific stage's outputs show repeated taste/strategy drift that the structural verifier misses cycle-over-cycle.
**Origin.** Surfaced 2026-05-24 during the ADR-023 conversation, when distinguishing what the foreman (orchestrator's verifier) can check vs. what only a peer expert can. The seam was already implicit in B-016 (some verifiers are too thin) and in the existing Brain v3 MoE-Critic design study.
**Needs a spec → plan cycle** before any build.

### E-032 `v1.5` `P2` `agents` — Reduce per-worker token cost on content-writer / creative-director
**The problem.** A single content-writer worker in C1-fanout consumed 60.6k tokens (E-029 Task 18 cold-start walk, 2026-05-23 PIATAF brief). Breakdown:
- Agent's reasoning + composition (33 hooks × bilingual + 3 scripts × bilingual) ≈ 15–20k — intrinsic, not reducible without changing the deliverable.
- Corpus reads (`mcp__corpus__get_compliance_block` ×2 + `mcp__corpus__search` ×N + `mcp__corpus__list_proof`) ≈ 12–15k — reducible via per-stage compliance-block caching + lighter search returns (titles + first 200 chars, with `mcp__corpus__get` for full content opt-in).
- `mcp__store__create(Scripts)` args (3 scripts × bilingual body) ≈ 10–12k — intrinsic (you have to send the body to write it).
- Agent system prompt + tool defs + spawn prompt ≈ 7k — partly reducible (agent prompt is ~226 lines; some sections are guidance the worker doesn't strictly need on every call).
- Initial `Read` of house-style + bilingual fragments ≈ 2–3k — reducible by injecting these into the spawn prompt directly so the worker doesn't burn a Read call.
**Not a blocker today** — each fanout worker gets a fresh 200k subagent window and the conductor only sees the return JSON (~5–6k). But across a full produce-stage walk (4 briefs × C1 + 12 scripts × P1) the cumulative token spend is significant.
**Scope.**
- Add a cached compliance-block read at the `corpus` MCP layer (single fetch, in-memory cache for the rest of the process).
- Add a `mode: "summary"` option to `mcp__corpus__search` returning titles + 1-line snippets; consumer opts in to `mcp__corpus__get` per file for the full markdown.
- Inline the house-style + bilingual fragments into the C1 spawn prompt so the worker doesn't re-read them per unit.
- Audit `.claude/agents/content-writer.md` for sections that can move from prompt-resident to lazy-load.

### E-029-followup `v1.5` `P2` `data` — Audit downstream emitters for enum-value drift
Several enum vocabularies were intentionally rewritten between `packages/notion-bootstrap/src/schemas.ts` and `packages/store/src/schema.ts` during E-029 — including `CHANNELS`, `META_CTA_TYPE`, `ORGANIC_LANGUAGE` (case change `EN→en`, `BM→ms`), `HYPOTHESIS_STATUS`, `DOMAIN`, `LEARNING_CONFIDENCE`, `LEARNING_STATUS`. The Postgres schema uses `text` columns with no CHECK constraint; membership is validated only by the CRUD layer (Task 5). Producers that still emit the old vocabulary will write valid-shape but semantically wrong values until the CRUD layer rejects them — and even then only via the MCP path.
- **Scope**: grep agent prompts (`.claude/agents/*.md`), MCP servers (`mcp-servers/**`), and orchestrator stages (`packages/orchestrator/src/stages/*`) for the literal old enum values. Replace with the canonical vocab in `packages/store/src/schema.ts`. Where the old → new mapping is lossy (e.g., dropped `META_CTA_TYPE` values like `WHATSAPP_MESSAGE`, `SHOP_NOW`), pick the closest surviving member or escalate.
- **Trigger**: as soon as Task 5's CRUD validator lands and starts rejecting writes during cold-start `/loop-once` (E-029 Task 18). The failures are the audit input.
- **Caught by**: spec reviewer + code quality reviewer on E-029 Task 3.

### E-003 `v1.5` `P1` `infra` — Production CAPI server (Cloudflare Worker)
Closes the conversion measurement loop. Currently relies on browser pixel alone (~60% recovery); server-side CAPI lifts to ~95%.
- **Origin**: Formerly Phase 8.1.
- **Scope**: 2 of 4 endpoints initially — `/track/contact` (automated, browser-pixel matched on engineerdad.my WhatsApp click) + `/track/purchase` (manual posting from Shoo's account-opening workflow). `Lead` + `CompleteRegistration` deferred until granularity is genuinely useful.
- **Reuses**: `mcp-servers/meta-ads/src/capi.ts` builder + `event_id` dedup pattern.
- **Browser-side groundwork done** (2026-05-09): GTM container `GTM-59DCNQSC` installed on engineerdad.my; GA4 (`G-V8626QNEQP`) migrated from standalone `analytics.js` to GTM Configuration tag; existing `whatsapp_click` event re-implemented as a GTM GA4 Event tag. Path B locked (adopt GTM rather than direct snippets).
- **Hard prerequisites still unmet**:
  - confirm `analytics.js` removed from site template (otherwise GA4 fires twice per pageview)
  - add Meta Pixel as a GTM tag with shared `event_id` UUID
  - build the Cloudflare Worker
  - **domain-verify `engineerdad.my`** in Business Manager (decision-locked in ADR-006).

### E-004 `v1.5` `P3` `media` — Video generation pipeline (HeyGen + chart-stitch)
**Rescoped 2026-05-29** per ADR-028 (`docs/decisions/028-heygen-native-scene-assembly.md`). Reading the brand corpus surfaced that kie.ai / Veo 3 generative B-roll is off-brand for EngineerDad; the brand's visual register is Shoo's face + the 18 chart YAMLs in `corpus/data/charts/`. Scope: HeyGen avatar (Shoo's Instant Avatar) for talking-head segments + `static-renderer` for chart frames + HeyGen-native multi-scene assembly (one `generate_reel` call). The local ffmpeg stitch path (`packages/media-stitch`) was deleted; see B-034.
- **Origin**: Formerly Phase 8.3 (kie.ai/ElevenLabs/stock-footage). Image phase split off and shipped 2026-05-10. Reel pipeline rescoped 2026-05-29; kie.ai / ElevenLabs / stock-footage all dropped from scope. Further rescoped 2026-05-29 to HeyGen-native multi-scene assembly (ADR-028) — `packages/media-stitch`, Docker/ffmpeg, and whisper are all deleted.
- **Status**: Reel 9:16 pipeline shipped across PRs 1–6 on `feat/heygen-reel-pipeline`. Ships behind `EDOS_REEL_PIPELINE` kill switch. Architecture: one `generate_reel` call per Reel; HeyGen concatenates scenes server-side (B-034).
- **Closes when**: 5 production Reels ship through HG3 with ≥60% approve rate (G4 gate).
- **Remaining sub-items** (forward-look, post-G4):
  - **E-004a — YT-Long 16:9 variant**: same `reel-render-worker` HeyGen-native infrastructure with aspect=16:9 and longer `targetSeconds`. Creative-director prompt extension needed.
  - **E-004b — YT-Short 9:16 (short-form vertical)**: same pipeline as Reel with a shorter `targetSeconds` cap. Trivial follow-up.
- **Prereqs** (already in `.env.example`):
  - `HEYGEN_API_KEY` — paid HeyGen account
  - `HEYGEN_AVATAR_ID` — Shoo's trained Instant Avatar id
  - `HEYGEN_VOICE_ID` — HeyGen voice id for EN narration

### E-005 `v1.5` `P3` `dashboard` — Visual analytics dashboard
Observable Framework or Evidence.dev over `data/engineerdad.sqlite`. Two starting pages: Creative Decay (line charts) + Cost-per-Angle (bar charts).
- **Origin**: Formerly Phase 8.2.
- **Why P3**: pure observability layer; PerformanceReports + Brain prose narration of decay/angle JSON are functionally adequate for a single-consultant operation. No loop logic depends on it.

### E-006 `v1.5` `P4` `infra` — Promote to Agent SDK cron / Cowork
Design-only in v1; current shape IS v2/v3 shape.
- **Origin**: Formerly Phase 8.4.
- **Scope (when triggered)**: `scripts/cron-loop-once.ts` (loads subagents via `query()`, reuses MCP servers) + Cowork integration (same MCP endpoints, long-lived instead of stdio). Approval Status gate stays the human control point.
- **Defer until E-003 + E-004 stabilise** — cadence isn't well-understood yet; needs a few real run cycles.

### E-007 `v1.5` `P2` `media` `infra` — asset-store R2 backend swap (skip local disk)
Replace the asset-store + static-renderer local-disk writes with direct Cloudflare R2 uploads, so the URL handed back from `mcp__asset-store__upload` is already a public HTTPS URL — no `file://`, no local mirror. **Narrowed 2026-05-25**: dropped Notion Asset Files auto-population item (Notion retired); dropped 2026-05-11 BM-headline + Gemini-cost-tracking items per ADR-014 (HTML template renders bilingual at design time; no per-image API cost under HTML+Playwright).
- **Origin**: Deferrals from E-004 image phase + ADR-014 static pipeline.
- **Scope**:
  - Replace `mcp-servers/asset-store/src/index.ts` AND `mcp-servers/static-renderer/src/render.ts` local-disk writes with Cloudflare R2 upload (`@aws-sdk/client-s3` against R2 endpoint). Adds env vars `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Returns HTTPS URL instead of local path. Zero changes to media-production agent or worker prompt — interface preserved.
  - Dev fallback: when R2 env vars are absent (no creds on the machine), fall back to today's local-disk path so offline dev still works. Production deploys always have the creds.
- **Bumped P3→P2 (2026-05-25)** — webapp is now a second consumer. The webapp design (2026-05-25 spec) needs a dev-only `/api/asset/[runId]/[variantId]/[scene]` route handler + a `resolveAssetUrl()` rewrite helper purely because `creative_variants.asset_files[].url` carries `file://` URLs in local dev. Once E-007 ships, both pieces become dead code and get deleted. Two consumers maintaining a workaround for the same gap is the rope being pulled.
- **Prereqs**: provision R2 bucket; create R2 token scoped to that bucket only.

### E-012 `v1.5` `P3` `schema` `agent` — AuthorityArticles missing BM-side fields for bilingual SEO
The AuthorityArticles DB has a `Title (BM)` and `Body BM` + `FAQ BM`, but the AEO/GEO packaging fields (Description, Keywords, Topic, Target Query, Hero Image Alt) are single-EN-only. When distribution fires the `lang: ms` `draft_article` call, it reads those same EN fields verbatim — so any BM article that ever ships would carry an English `<meta name="description">`, English keywords, English alt text. Currently dormant because the engineerdad-site MCP refuses `lang: ms` (BM phase not enabled site-side), but the gap will surface the moment BM ships.
- **Origin**: dry-run audit during run_1778486942 (2026-05-18) — user spotted that BM description = EN verbatim and asked to track.
- **Scope**:
  1. **Schema migration** — add to AuthorityArticles DB: `Description (BM)`, `Keywords BM` (multi_select), `Topic BM`, `Target Query BM`, `Hero Image Alt BM` (all rich_text except Keywords BM). Add `pnpm migrate:article-bm-fields` script following the `migrate:article-spec-fields` pattern.
  2. **media-production Step 8 update** — articles-pass currently fills the EN packaging fields fill-only-if-empty; extend to also fill the BM equivalents, drawing from `Body BM` / `FAQ BM` for derivation. Same fill-only-if-empty rule.
  3. **distribution agent update** — Article branch (4c) currently passes the single Description / Keywords / Hero Image Alt to both lang calls; switch the `lang: ms` payload to read the BM-suffixed fields with EN fallback (keeps existing live EN behavior unchanged).
  4. **content-gen update** (optional, light touch) — when authoring articles, populate `Topic BM` and `Target Query BM` alongside the EN equivalents so the SEO keyword research lands in the right language at write-time, not enrichment-time.
- **Why P3**: zero impact on the EN-only ship path that's live today. Becomes a real blocker the day BM articles go live on engineerdad-site.
- **Prereqs**: none code-side. Conceptually paired with whatever decision triggers BM enablement on engineerdad-site (the receiving end of the `lang: ms` call).

### E-011 `v1.5` `P3` `infra` — Webhook triggers for distribution (deferred)
Replace manual `/distribute` invocations with approval-driven triggers (on store/webapp approval-state changes).
- **Origin**: Plan session 2026-05-16, Phase F (deferred).
- **Scope**: a store/webapp approval-state change → small HTTP handler (Cloudflare Worker?) → invokes `/distribute` on approval-state changes. Removes manual command invocation.
- **Why P3 + deferred**: manual `/distribute` is sufficient at current volume. Defer until volume justifies the infrastructure cost.
- **Prereqs**: E-008, E-009, E-010 all live and stable (✓ as of 2026-05-17).

### E-015 `v1.5` `P3` `analytics` — YouTube Analytics ingestion
Add read-side tools to `mcp-servers/youtube/` (analytics.reports.query via YouTube Analytics API). Extend `ingest_youtube_insights` into `creative_signals`. Implement YT-channel `/reflect` grader (placeholder rules in organic-social-cadence-design spec §9.2). Spec to be written.

### E-016 `v1.5` `P3` `analytics` — AuthorityArticles analytics (GA4 + Search Console)
New `mcp-servers/site-analytics/`. GA4 service-account auth + Search Console OAuth. Ingest `sessions, users, avg_time_on_page, scroll_depth_pct, clicks_to_whatsapp, gsc_impressions, gsc_avg_position`. Implement AuthorityArticles `/reflect` grader. Spec to be written.

### E-017 `v1.5` `P3` `experiment-os` — Multi-channel test types
Extend `experiment-os` with `organic-format-volume`, `youtube-thumbnail-ab`, `article-topic-cluster` Test Type values. Factorial allocator for non-budget factors. Spec TBD; depends on E-015/E-016 minimum data.

### E-018 `v2` `P4` `analytics` — Cross-channel attribution model
Build the model that asks "did organic cadence X cause paid CPM lift Y?" Requires ≥60d of clean paid + organic data first. Spec deferred.

### E-019 `v1.5` `P3` `organic` — Per-platform organic captions
If engagement data shows IG vs FB diverge meaningfully on the same Variant, split Organic Caption EN/BM into Organic Caption IG/FB EN/BM (Option X in organic-social-cadence-design spec §1). Trigger: 2+ months of organic data where IG engagement_rate / FB engagement_rate ratio swings by >2× on same content.

### E-020 `v1.5` `P3` `organic` — Re-post same Variant in other language
Add `Organic Languages Posted` multi_select. Allow `/post-week` to pick a previously-published Variant if it has only been posted in one language and ≥90 days have passed. Spec deferred.

### E-022 `v1.5` `P3` `corpus` — Carousel 4:5 reference design render
The previous `carousel-1x1-calm-001-card1.png` reference was deleted on 2026-05-20 (file was 1080×1080; would have misled workers after Carousel default flipped to 4:5). Until a proper 1080×1350 carousel reference lands in `corpus/templates/reference-designs/`, worker prompt instructs adaptation from `feed-4x5-alert-chart-001.png` + standard carousel-card hierarchy. Render at minimum two carousel exemplars — one calm/education tone, one alert tone — to give workers a clear 4:5 target across the palette range.
Origin: F7a (Carousel 1:1 → 4:5 default flip, commit `3209c15`).

### E-024 `v1.5` `P2` `infra` `organic` — Always-on organic-post scheduler + executor
The proper fix for B-005. Meta gives IG no native organic scheduling, so a real schedule requires the OS's **first always-on component** — today everything is Claude Code sessions + stdio MCP servers that exist only while Claude Code runs.
- **Brainstorm parked 2026-05-21** — considered n8n as the scheduler + trigger layer. Established facts to carry forward:
  - n8n's `Wait` node is durable: a long wait serializes the paused execution to n8n's DB (not IO-blocked, no held socket), survives a host reboot, and resumes/catches-up on restart.
  - Two trigger models on the table — **poll** (n8n cron every ~5 min queries the store for due posts; the store stays single source of truth; self-healing) vs **push** (`/distribute` registers a per-post job via n8n webhook; precise timing; n8n DB carries job state). A push variant that holds only `{variantId, platform, fireAt}` and re-reads the store at fire-time converges with poll's freshness + cancel-safety.
  - **Host decided**: self-host on the Mac mini (`pmset` no-sleep). Free; risk is power/reboot gaps — poll model tolerates this best.
- **Open decisions for the spec**:
  1. poll vs push (vs the hold-the-ID hybrid)
  2. the executor — a small always-on HTTP "publish-worker" that imports meta-organic's existing `publishImagePost` / `publishCarouselPost` functions (they're already transport-decoupled plain async fns) + compliance pre-flight, vs n8n calling Meta Graph directly (rejected-leaning: duplicates logic, can't run the compliance scanner, violates ADR-005 thin-adapter)
  3. FB — keep Meta-native scheduling (works, gives Meta-side "Scheduled" visibility) or unify FB through the same path as IG for one code path
  4. ADR-019 revision — the safety/cancel window moves from Meta's server-side queue to the n8n hold; compliance must re-run at fire-time
- **Relation to E-011**: E-011 is "webhook-trigger `/distribute` on store/webapp approval changes." E-024 is the organic-scheduling-specific superset (it also owns the *executor* that fires at the scheduled minute). Resolve whether E-011 folds into E-024 when the spec is written.
- **Needs its own spec → plan cycle** before any build.

### E-026 `v1.5` `P3` `corpus` — Corpus audit pass (automated corpus-additions validator)
Automated validator that scans new/changed `corpus/**/*.md` files for frontmatter conformance, bilingual-section presence, and banned compliance phrases.
- **Origin**: Corpus extraction plan (2026-05-20). The plan's original "Phase 3 — Corpus-additions validator" was pulled out; the 2026-05-21 corpus-extraction iteration ran those checks as a manual review pass instead. (The plan + design HTML refer to this item as "E-023"; E-015..E-025 were already taken, so it takes the next-free `E-026` per the IDs-are-stable convention.)
- **Scope**: a script (or vitest spec) that, for each `corpus/**/*.md`, asserts — frontmatter carries `quote` / `attribution` / `permission_status` / `persona`; dated snapshots carry `dated_snapshot` + `snapshot_period`; designated bilingual files have both `## English` and `## Bahasa Malaysia`; no banned phrase from `corpus/compliance/banned-phrases.yaml` appears. Wire into `pnpm test` / pre-commit.
- **Why P3 + v1.5**: manual review is sufficient at current corpus-authoring volume; automate when corpus edits get frequent.
- **Prereqs**: none.

### E-028 `v1.5` `P3` `analytics` `schema` `agent` — hook-level learning: structured register on creatives + sub-register taxonomy
Hook performance is hard to learn from today. The *used* hook lands on a CreativeVariant only as free text inside `Meta Headline EN/BM` — there is no structured `Register` field — so `/reflect` and Brain cannot cleanly read "this variant ran a *curiosity* hook". And the bandit's `hook` arm (`ArmTagSchema`) only aggregates if fed a recurring value: a literal hook sentence is one-off (never reproduced run-to-run), so the learnable unit is the **register**, not the sentence.
- **Origin**: 2026-05-22 brainstorm on hook-bank storage (Approach D / the bloat fix). Established that the 30-hook candidate bank carries no learning signal — 26 of 30 hooks are never used; the signal is only on the ~4 *used* hooks.
- **Scope**:
  1. Add a structured `Register` field (select: fear/aspiration/curiosity/proof/identity/contrarian) to the CreativeVariants DB — creative-director already picks a hook+register per creative; persist the register as structured data, not buried in ad copy.
  2. Verify what `upsert_creative` feeds the `hook` bandit arm — it must be the **register** (low-cardinality, recurring), not the literal hook string, or the arm never learns. Fix if needed.
  3. `/reflect` reads register-level performance into Learnings ("fear hooks beat aspiration 2:1 on CPA for persona X").
  4. Close the loop on the *consumption* side. The creative-director currently picks its 4 hooks per Script by pure editorial judgement (`creative-director.md` Step 3, "Hook rotation") — it consults no performance data and cannot know that, e.g., fear hooks beat aspiration 2:1 last run. Once register performance is measured (items 1–3), feed it back into selection — Brain passes register-performance guidance in the creative-director spawn prompt, or the creative-director reads Learnings directly. Without this step the loop *measures* hook performance but never *acts* on it; selection stays taste-only, fresh every run regardless of what won.
- **Sub-register taxonomy (design-only, future sub-item)**: a finer cut — e.g. fear → time-running-out / not-enough / silent-erosion / future-regret / falling-behind (~3–5 per register). Two cautions from the brainstorm: (a) **cardinality** — 6×5 ≈ 30 buckets is too many bandit arms for a single-consultant low-volume operation, so sub-register should be a *descriptive tag Brain reads*, not a bandit arm; (b) **redundancy with `Angle`** — sub-registers partly restate the existing Brief `Angle`, so the durable low-cardinality learning cut is **register × angle** (both already dimensions). A good sub-register varies *independently* of the angle.
- **Why P3**: learning-quality improvement; the loop runs and decides without it. Valuable once enough runs exist for register-level aggregation to matter.
- **Needs a spec → plan cycle** before build.

### E-036 `v1.5` `P3` `agent` `orchestrator` `BlockedBy: Brain Initiative Phase 3` — Critic step in brief stage
**The seam.** Apply the generic `kind: "critic"` step (shipped in Brain Initiative Phase 3) to `verify-brief.ts`. The structural verifier admits Briefs that pass shape checks but may fail strategic alignment with the Decision Memo.

**Trigger to re-open**: ≥2 cycles where brief-writer emitted Briefs that passed structural verify but were rejected at HG1 for strategic mismatch (or vice versa).

**Origin**: Promoted from `docs/superpowers/specs/2026-05-26-brain-initiative-design.html` §11. Doctrine in ADR-026.

### E-037 `v1.5` `P3` `agent` `orchestrator` `BlockedBy: Brain Initiative Phase 3` — Critic step in produce stage
**The seam.** Apply the generic `kind: "critic"` step to `verify-produce.ts`. Creative Variants can pass derived-spec checks while still being tonally incoherent across the four creatives a Script decomposes into.

**Trigger to re-open**: ≥2 cycles where Creative Variants passed all derived spec checks but were rejected at HG3 for tonal incoherence.

**Origin**: Promoted from `docs/superpowers/specs/2026-05-26-brain-initiative-design.html` §11. Doctrine in ADR-026.

### E-038 `v1.5` `P3` `agent` `orchestrator` `BlockedBy: Brain Initiative Phase 3` — Critic step in distribute stage
**The seam.** Apply the generic `kind: "critic"` step to `verify-distribute.ts`. The dry-run path admits distributions that compile but might be paused-by-design when the underlying targeting / placement / asset config has a critic-detectable flaw.

**Trigger to re-open**: ≥1 cycle where distribution went out paused-by-design but a critic would have prevented the dry-run from being submitted at all.

**Origin**: Promoted from `docs/superpowers/specs/2026-05-26-brain-initiative-design.html` §11. Doctrine in ADR-026.

### E-039 `v2` `P3` `agent` `BlockedBy: Brain Initiative Phase 3` — Multi-factor experiment design (angle × persona)
**The seam.** The `experimentParams` schema shipped in Phase 0 accepts `factors: Array<{name, levels[]}>` from day one. Brain v3 (Phase 2) only emits a single-factor `"angle"` axis. When Brain v3 is stable across ≥10 cycles and the calibration suite shows a graduation-rate plateau, teach Brain to emit `angle × persona` (or similar two-axis) designs.

**Trigger to re-open**: Brain v3 stable across ≥10 cycles; calibration suite shows graduation_rate plateau (3 cycles with no graduation deltas).

**Origin**: Promoted from `docs/superpowers/specs/2026-05-26-brain-initiative-design.html` §11. Engine + verifier already accept the wider shape; this is a Brain-prompt-only upgrade.

### E-040 `v3.1` `P3` `agent` `BlockedBy: Brain Initiative Phase 3` — Cross-channel critic debate
**The seam.** Brain v3 (Phase 2) constrains the debate to intra-channel only. If the judge picks 3 Recommended Actions that don't fit together as a portfolio, add a Phase 4.5 cross-channel critic between R2 and the judge.

**Trigger to re-open**: Portfolio coherence flagged at HG1 in ≥3 consecutive cycles ("Brain picked 3 actions but they don't fit together").

**Origin**: Promoted from `docs/superpowers/specs/2026-05-26-brain-initiative-design.html` §11.

### E-041 `vfuture` `P3` `agent` `BlockedBy: Brain Initiative Phase 3` — DSPy-style auto-tuning of critic prompts
**The seam.** When the critic over-attacks (attacks the judge ignored AND the actual outcome landed in the original CI ≥40% across ≥20 cycles), the critic prompt itself needs tuning. Use DSPy or equivalent to learn the critic prompt from calibration scores.

**Trigger to re-open**: Critic over-attack rate ≥40% across ≥20 cycles.

**Origin**: Promoted from `docs/superpowers/specs/2026-05-26-brain-initiative-design.html` §11. Orthogonal infrastructure.

### E-042 `v1.5` `P2` `orchestrator` — Generalize experiment cell→variant join to `format` + `persona`
Carved out from B-023 (2026-05-28). `projectExpVariant()` currently populates only `factorTags.angle` from Brief. Future Brain experiments will likely add `format` (variant column directly) and `persona` (Brief column) as factor axes. Smallest delta: extend the helper to read `variant.format` and `brief.persona`, and add those fields to the X1-query Briefs/Variants projections. Re-open when Brain emits a multi-factor experiment in the wild.

### E-043 `v1.5` `P3` `orchestrator` `agents` — Add `hook_register` + `language` as experiment factors
Carved out from B-023 (2026-05-28). Two factor axes that need structural work before the projection pattern can cover them: `hook_register` requires the creative-director to record which emotional register each chosen hook belongs to (new variant column or a `hooks[]` jsonb on the variant); `language` is per-render not per-variant (each variant carries both EN + BM copy), so an experiment on language requires splitting `(variant × language)` into separate routing rows at distribute time. Re-open when Brain's hypothesis bank starts proposing register- or language-axis experiments.

### E-044 `v1.5` `P2` `analytics` `infra` — LLM token-usage metering & audit
No per-run / per-stage / per-agent capture of Claude token usage exists today (verified 2026-05-31). The codebase's "cost" surfaces are all marketing economics — `estCostMyr` (human production-cost estimate authored by creative-director), `analytics.meta_insights.spend` (Meta ad spend), `cost_per_angle` — none track LLM API cost. There is no OTEL / `CLAUDE_CODE_ENABLE_TELEMETRY` config; the Claude Code statusline token figures come from the harness, not from anything the OS persists or can query.
- **Origin**: surfaced 2026-05-31 during the reel/static asset-quality brainstorm (`docs/superpowers/specs/2026-05-31-reel-asset-quality-design.html`). That spec pins Opus on the N-wide P2-render fanout (D10) and bumps creative-director Sonnet→Opus (D8) — raising spend with **no instrument to measure the impact**. The increase is visible only in the Anthropic billing console, un-attributable to runs/stages/agents.
- **Scope**:
  1. Decide the capture point — workers/agents emit `log_event({ event_name: "llm_usage", payload: { runId, stage, agent, model, inputTokens, outputTokens, cacheReadTokens } })` (`analytics.events` already accepts arbitrary `payload_json`), vs. a usage column on `orchestrator.step_results`, vs. OTEL via `CLAUDE_CODE_ENABLE_TELEMETRY`.
  2. Map tokens → cost by model (Opus/Sonnet/Haiku rate table; cache-read discount).
  3. Analytics rollup tool (token + MYR/USD per run / stage / agent) + a webapp view.
- **Open question (verify empirically per the project's "verify, don't assume" rule)**: can a `Task`-spawned subagent read its own `message.usage`, or must usage capture live in the harness / OTEL layer that the OS can't reach from inside an agent? This determines whether option 1 is even feasible or whether OTEL is the only viable capture point.
- **Why P2**: cost/efficiency class. Becomes material the moment the Opus pins (asset-quality spec) ship; until then there is no way to answer "did Opus cost more, and was it worth it?" from stored data. Pairs naturally with E-032 (per-worker token-cost reduction), which is currently argued from a single hand-measured 60.6k-token sample — E-044 would make that measurable continuously.

### E-045 `v1.5` `P3` `agent` — Static/reel palette-emphasis (tone) coherence
The **static** render-worker re-infers tone itself: §2 reads `thumbnailBrief` and picks one of the five §5 palette-emphasis rows. The **reel** render-worker does not — it receives `paletteEmphasis` in the staged CreativePlan (decided upstream by the creative-director). So a static and a reel built from the **same script can diverge in tone** (the static's `thumbnailBrief` read vs the creative-director's `paletteEmphasis`).
- **Origin**: surfaced 2026-05-31 reviewing the render-worker prompts after the static-4x5 exemplar promotion (commit `d25b036`).
- **Fix options**: (a) feed the static worker the upstream `paletteEmphasis` and have it use that as the primary signal (fall back to `thumbnailBrief` only when absent); (b) have the creative-director author `paletteEmphasis` onto every Variant (static + reel) and make both workers consumers, never deciders. (b) is the cleaner end-state — single tone source per Variant, auditable cross-format.
- **Why P3**: observability/consistency, not a correctness bug — both paths stay inside the locked palette; the risk is only cross-format tonal drift within one script.

### E-046 `v1.5` `P2` `agent` `orchestrator` — Funnel-stage assignment has no owner; brief-writer picks TOFU/MOFU/BOFU by unguided judgement
Surfaced 2026-06-11 during the objection-corpus review pass (multi-agent review of `docs/superpowers/plans/2026-06-07-ut-objection-corpus.md`). The funnel stage on each Brief is decided by nothing: `brain.md` contains zero funnel mentions (the Decision Memo's `recommendedAngles` carry no funnel dimension); `brief-writer.md` Step 4 requires each Brief to declare `Funnel Stage — TOFU | MOFU | BOFU` but gives no assignment rule (contrast the budget bucket's explicit 8/3/1 distribution); `verify-brief.ts` validates only angle membership; the store column is free text (`funnelStage: text("funnel_stage")`, `packages/store/src/schema.ts:99`) — not even enum-constrained. Yet the decision is consequential downstream: content-writer picks format by stage (TOFU → Reel/Feed, MOFU → Carousel/YT-Short, BOFU → YT-Long) and CTA by stage, and once objection-corpus consumption is wired, the corpus tier (`funnel_tier: necessity | avoidance | substitution`) keys off it too — an arbitrary stage choice would launder into "principled" grounding.
- **Options discussed (decision deferred)**: **(A)** Brain owns a funnel mix in the Decision Memo (strategy-led; e.g. "6 TOFU / 4 MOFU / 2 BOFU this cycle", later informed by tier-level analytics); **(B)** fixed doctrine default in brief-writer like the 70/20/10 budget rule (e.g. 6/4/2, overridable when Brain's memo specifies a mix) — cheap, deterministic, but static; **(C)** angle-implied (objection-derived angles carry their tier's stage automatically; undefined for non-objection angles — incomplete alone). Leaning **B now, A as design intent**, with C falling out free once objection grounding lands.
- **Couples with**: the stage→tier grounding search in brief-writer Step 5 (`mcp__corpus__search({ cluster: "objection", funnel_tier: <mapped from the Brief's funnelStage> })`) — wire it alongside whichever option lands; and a `funnelStage` enum + mix check in `verify-brief.ts` at the same time.
- **Why P2**: silently shapes format, CTA, and (soon) corpus grounding on every run; the fix is small once the owner is chosen.

### E-047 `v1.5` `P2` `schema` `agent` `analytics` — Corpus-entry attribution lineage (`sourceCorpusEntries`) across Briefs/Scripts/Hypotheses/Learnings
Surfaced 2026-06-11 during the objection-corpus review pass. No structured field anywhere in `packages/store/src/schema.ts` records which corpus entry grounded a Brief, Script, CreativeVariant, Hypothesis, or Learning. Analytics can aggregate performance by `angle`, but never by corpus entry or funnel tier — so `/reflect` can never graduate a learning like "the EPF-coverage myth (d0-epf-will-cover-me) outperforms the affordability myth at TOFU", and there is no machine-readable provenance trail for compliance audits ("which entries grounded this ad?").
- **Scope**: add `sourceCorpusEntries: jsonb` (array of corpus entry/chart/dataset slugs) to briefs, scripts, creativeVariants, hypotheses, learnings; brief-writer/content-writer populate it from their grounding searches; `/reflect` reads it for entry-level and tier-level learning cuts. Consider a `corpus_entry` arm/tag on the analytics side (cardinality is fine: ≤ ~60 entries).
- **Interim zero-cost convention (already live)**: brief-writer cites corpus file paths in `sourceInsights` (text), and since `985ea23` (knowledge scope included in searches) d-entry paths accrue there naturally — raw provenance exists, just unqueryable.
- **Needs a spec → plan cycle** before build (pattern: E-028 — same "measure, then act on it" shape).

### E-048 `v1.5` `P3` `corpus` `agents` — Bilingual path for knowledge entries (`en_only` graduation) + phrasebank BM section
Surfaced 2026-06-11. The objection d-entries (and most `knowledge/` entries) ship `lang_status: en_only` with no mechanism, owner, or timeline graduating them to bilingual; `compliance-claim-phrasebank.md` has no `## Bahasa Malaysia` section. Mitigants verified during review: the operative wired compliance path (`get_compliance_block` → `sc-malaysia.md`) **is** already bilingual, and brief-writer/content-writer synthesize BM natively per `bilingual.md` ("natural BM, not literal translation") — so BM content generation is not blocked; the risk is consistency drift in compliance-sensitive BM phrasing, not absence.
- **Decision to record in an ADR**: (a) accept generation-time BM synthesis bound to the bilingual compliance block (status quo, documented); (b) scheduled BM pass over d-entries post-Phase-3 (`lang_status: en_only` → `both`); or (c) BM-translate only compliance-critical sections (steelman concessions + EPF/comparison language).
- **Also**: add a `## Bahasa Malaysia` section to `compliance-claim-phrasebank.md` for self-consistency with its stated "operative reference" purpose (polish; not wired into generation).

## Conventions

- **Severity**: `P0` (blocker for next run) • `P1` (data-quality / silent-bug class) • `P2` (cost/efficiency) • `P3` (observability) • `P4` (future state)
- **Milestone**: `v1.0` (must ship before declaring v1 done) • `v1.5` (next epoch)
- **Layer tags**: `agent` `mcp` `schema` `corpus` `infra` `media` `dashboard`
- **IDs are stable** — reference in commits / PRs, never renumber. Closed items move to `DONE.md` retaining their ID.
- **Filing new bugs/enhancements**: add a row here with the next free `B-NNN` / `E-NNN` ID. If the bug was discovered while completing another item, also note its origin in that item's commit message so the trail back to TASKS.md is durable.

## See also
- [`DONE.md`](./archive/DONE.md) — Phase 0–9 build history + 8.x fast-tracked fixes.
- [`docs/decisions/`](./decisions/) — Architectural decision records (ADR-001..ADR-020).
- [`docs/integrations/engineerdad-site-article-writer.md`](./integrations/engineerdad-site-article-writer.md) — Design spec for cross-repo article MCP (E-008 — shipped).
- [`mcp-servers/youtube/README.md`](../mcp-servers/youtube/README.md) — YouTube OAuth Playground setup (E-010 prerequisite).
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — current architecture (the source of truth for the system as built).
- [`docs/meta-credentials-setup.md`](./meta-credentials-setup.md) — Meta API token setup.
