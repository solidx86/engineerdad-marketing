# 013 — Multi-modal media-providers MCP family (video + image)

Status: Accepted
Date: 2026-05-10
Source: TASKS.md E-004 (scope expanded from video-only on 2026-05-10)

## Context

E-004's original scope (formerly Phase 8.3) wired the v1.5 media-providers MCP family to **video only** — the listed vendors (Veo 3, Kling, Runway, Hailuo, Sora) are all video-gen models accessed through the `kie-ai` aggregator. But the `media-production` agent has always declared **5 format variants per Script**, of which **3 are static images** (Feed 1:1, Feed 4:5, Carousel 1:1) and 2 are video (Reel 9:16, YT-Long 16:9). Shipping E-004 as originally scoped would automate only 40% of formats and leave the other 60% requiring human rendering — defeating the cost-saving purpose. The static-format gap was never explicitly flagged as a deferral; it was an oversight in the v1.5 spec.

User confirmed (2026-05-10) the abstraction must make provider-switching trivial — the OS must not be locked to any single image-gen vendor as the model landscape shifts.

## Decision

### Provider abstraction

Extend the `mcp-servers/media-providers/<vendor>/` interface from one method to two:

- **`generate_clip` / `get_clip_status`** — video, kept unchanged so existing video-vendor work (kie-ai) doesn't drift
- **`generate_image` / `get_image_status`** — new, parallel-shaped (synchronous in practice; status method preserved for interface symmetry)
- **`list_models()` extended** with a `modality: "video" | "image"` discriminator, plus optional `cost_per_image_usd` and `text2image` / `image_edit` capability tags. OS04 routes calls by reading this discriminator.

### Day-1 image vendor: Gemini Nano Banana

`mcp-servers/media-providers/gemini/` ships with two models surfaced:
- `gemini-2.5-flash-image` (Nano Banana) — $0.039/image standard, $0.0195 batch (~1024×1024)
- `gemini-3-pro-image-preview` (Nano Banana Pro) — $0.134/image (1K-2K standard), $0.24 (4K standard)

Chosen over Imagen 4 / Flux Pro / DALL-E because: (1) the Gemini API key path (`GEMINI_API_KEY`) is the same as future text-model usage so there's no separate billing relationship, (2) Nano Banana renders embedded multilingual text (EN+BM headlines) reliably — important since static formats burn the hook into the image, (3) synchronous API is ~80 LOC vs. kie-ai's polling pattern at ~150 LOC.

### Modality split is strict

Gemini is **image-only**. Video stays on kie-ai, which already aggregates Veo 3 — adding a direct Gemini video path would just duplicate that route and split the video-vendor abstraction in two. This preserves the user's stated kie.ai-for-video preference.

### No free-tier path

Verified live against Google's pricing page on 2026-05-10: **neither Nano Banana variant has a free tier for image generation**. Billing must be enabled on the Google AI project before any call. Rejected alternatives: (1) running Stable Diffusion locally for free — infra burden not worth ~$2/run savings; (2) deferring static-format automation until a free image-gen API appears — punts the 60% gap indefinitely.

### Cost guardrails

`corpus/media-policy.yaml` extended with `daily_image_gen_budget_usd: 10` (~250 standard Nano Banana images), and per-bucket `allowed_image_models` allowlists alongside the existing `allowed_video_tiers`. OS04 enforces the cap at the boundary; refuses generation with a clear error if exceeded.

## Consequences

- **All 5 format variants are now automatable in v1.5.** Image-gen at standard Nano Banana adds ~$2–3/run (~50 images at $0.039 each) — rounding error vs. the ~$30 video budget.
- **Provider-switching is one-package replacement.** Any future vendor (Imagen 4, Flux Pro, an open-weights local model) implementing the §13.1 `generate_image` interface drops in. OS04 model selection is data-driven via `media-policy.yaml` `allowed_image_models` per bucket — no agent prompt edits needed.
- **No free-tier escape hatch is documented.** If image-gen budget becomes a concern, the answer is batch tier (~50% cheaper) on the `"10"` wild-card bucket, not a fallback to a free model.
- **Image-gen failure has no automatic fallback.** Unlike video (where `stock-footage` fills in on kie-ai failure), a failed Gemini call marks the Variant `status: failed` and surfaces to humans. Re-prompt or skip is the documented recovery path — using stock photos for a static-image variant would be visually off-brand in ways stock B-roll for video isn't.
- **Zero changes to upstream agents.** Brain, Targeting, Content Gen, Notion schemas, and the compliance scanner are untouched. The modality fork lives entirely inside media-production + the new MCP packages.
- **TASKS.md E-004 LOC estimate revised** from ~135 lines (~2–3 sessions) to ~150 lines (~3–4 sessions) to absorb the gemini package + per-modality config.
