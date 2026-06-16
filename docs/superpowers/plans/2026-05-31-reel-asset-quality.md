# Reel & Static Asset Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve rendered asset readability/UI-UX by (a) collapsing the reel scene model from three types to two (`face | visual`) across both the authoring and HeyGen-substrate layers and dropping `emphasize`, (b) adding a format-aware on-frame text-density doctrine + a worker self-critique rubric to the brand contract and both worker prompts, and (c) pinning the render workers + creative-director to Opus.

**Architecture:** Schema/code merge first (zod + worker-input + heygen-wrapper, all TDD), then prompt-layer doctrine (brand-contract §8/§9, both worker prompts), then the Opus pins (a new `render-worker` agent + creative-director frontmatter), then fixtures + ADR rewrite, then a full build/sync/verify pass. Density and the "no numbers on concept visuals" rule are enforced by worker self-critique + the HG3 human gate — they are NOT machine-scanned (on-frame text lives in the PNG, not the DB).

**Tech Stack:** TypeScript, Zod, Vitest, pnpm workspaces, Drizzle (Postgres), Markdown agent/worker prompts, Playwright static-renderer MCP, HeyGen wrapper MCP.

**Source spec:** `docs/superpowers/specs/2026-05-31-reel-asset-quality-design.html`

---

## Decisions locked (from the spec)

- **D2/D3:** `sceneType` and HeyGen `kind` both → `["face","visual"]`. `face-over-chart` deleted. A `visual` is *data* (`chartRef` set) or *concept* (`visualBrief` set) — XOR by field presence.
- **D4:** `emphasize` dropped everywhere.
- **D5:** brand-contract gains §8 (density) + §9 (self-critique rubric).
- **D6:** on-frame text reuses existing fields; worker may condense. Reel support line = `explains` (≤12 words, newly rendered on-frame). Static body block = condensed `body` (~30–45 words).
- **D7:** reel QA = mechanical §9 + 1 free pre-HeyGen retry, skip `ui-ux-pro-max`. Static keeps 1-retry + aesthetic pass.
- **D8:** creative-director `model: sonnet → opus`.
- **D9:** rewrite ADR-029 in place.
- **D10:** new `render-worker` agent (`model: opus`); P2-render fanout points at it.

## Pre-flight (run once before Task 1)

- [ ] **Confirm branch + clean tree.** Run: `git -C /Users/solid/Code/engineerdad-marketing status --short | grep -v 'data/assets\|tmp/'` — expected: empty (only test-artifact dirs are untracked, which is fine).
- [ ] **Confirm DB points at a sandbox, not live.** Run: `grep DATABASE_URL .env.local` — expected: a URL containing `_test` or `engineerdad_sb_`. If absent, run `pnpm db:sandbox` first (CLAUDE.md: tests hard-stop on a non-sandbox DB).
- [ ] **Confirm the agent-frontmatter tools rule (spec open question).** Read `.claude/agents/brain.md` and `.claude/agents/creative-director.md` frontmatter: every existing agent enumerates `tools:` explicitly (none omit it). **Therefore the new `render-worker` agent MUST enumerate its tools** (Task 12) — do not rely on "omit = all". This resolves the spec's plan-time verification note.

## File Structure

**Schema / code (build + Claude Code restart required):**
- `packages/shared/src/zod.ts` — `ReelSceneTypeEnum` → two-value; refinements → XOR-by-field-presence; remove `emphasize`.
- `packages/shared/src/zod.test.ts` — two-type + XOR cases; drop `emphasize`/`face-over-chart` cases.
- `packages/shared/src/derive/specs.ts` — remove `emphasize` from the scene type.
- `packages/orchestrator/src/produce/reel-worker-input.ts` — `sceneType: "face"|"visual"`; drop `emphasize`.
- `packages/orchestrator/src/stages/produce.ts:447` — fanout `worker: "general-purpose"` → `"render-worker"`.
- `packages/orchestrator/src/stages/produce.test.ts` — add P2-render worker-name assertion; refresh reel fixture.
- `mcp-servers/heygen-wrapper/src/heygen.ts` — `kind: "face"|"visual"`; image branch on `visual`.
- `mcp-servers/heygen-wrapper/src/index.ts` — `generate_reel` scene `kind` enum → two-value; description.
- `mcp-servers/heygen-wrapper/src/__tests__/heygen.test.ts` — two-value `kind` cases; drop `face-over-chart`.

**Prompt / doctrine (no restart — read at runtime):**
- `corpus/templates/brand-contract.md` — add §8 + §9.
- `corpus/templates/worker-prompts/reel-render-worker.md` — normal-path QA pass, wire `explains`, two-type, drop `emphasize`.
- `corpus/templates/worker-prompts/render-worker.md` — point §5.5 at §9, add format-aware density.

**Agents (restart required):**
- `.claude/agents/render-worker.md` — NEW (model: opus + tools shell).
- `.claude/agents/creative-director.md` — two-type, drop `emphasize`, format-aware on-frame guidance, `model: opus`.

**Fixtures / harness / ADR:**
- `scripts/fixtures/reel-worker/{chart-emphasis,concept-visual,mixed-reel}.json` — two-type; drop `emphasize`.
- `scripts/smoke-reel.mjs` — sceneType strings (verify-first: may be stale, imports deleted media-stitch).
- `docs/decisions/029-reel-visual-scenes.md` — rewrite in place.
- `ARCHITECTURE.md` / `TASKS.md` Status line — sync the `sceneType face|chart|visual` mention to `face|visual`.

---

## Phase 1 — Two-type schema merge (zod)

### Task 1: `ReelShotlistSceneSchema` → two-type + XOR, drop `emphasize`

**Files:**
- Modify: `packages/shared/src/zod.ts:164-210`
- Test: `packages/shared/src/zod.test.ts:192-290`

- [ ] **Step 1: Rewrite the reel test block to the two-type model (failing test).**

In `packages/shared/src/zod.test.ts`, replace the entire `describe("ReelShotlistSchema", …)` block (starts at line 192) with the version below. It drops `emphasize`, removes the `chart` enum value + the `face-over-chart` case, and adds the XOR cases (data visual / concept visual / both-null reject / both-set reject).

```typescript
// ── ReelShotlistSchema (per ADR-029, two-type face|visual model) ──
describe("ReelShotlistSchema", () => {
  type SceneOverrides = {
    scene?: string;
    voiceover?: string;
    onScreenText?: string;
    chartRef?: string | null;
    visualBrief?: string | null;
    explains?: string | null;
    shotNotes?: string;
    sceneType?: "face" | "visual";
    estimatedSeconds?: number;
  };
  const validScene = (o: SceneOverrides = {}) => ({
    scene: "1",
    voiceover: "Start early and let time do the work.",
    onScreenText: "Start at 30",
    chartRef: null,
    visualBrief: null,
    explains: null,
    shotNotes: "tight on face",
    sceneType: "face" as const,
    estimatedSeconds: 4,
    ...o,
  });
  const dataVisual = () =>
    validScene({ scene: "2", sceneType: "visual", chartRef: "compounding-30y",
      visualBrief: null, explains: "early start wins", estimatedSeconds: 8 });
  const conceptVisual = () =>
    validScene({ scene: "2", sceneType: "visual", chartRef: null,
      visualBrief: "Two-column split: Saver vs Investor; widening gap arrow.",
      explains: "waiting has a cost", estimatedSeconds: 7 });
  const validShotlist = {
    format: "Reel" as const,
    hook: { en: "Hook EN", ms: "Hook BM" },
    shotlistEn: [validScene(), dataVisual(), validScene({ scene: "3" })],
    targetSeconds: 25,
    faceFirstHook: true,
  };

  it("accepts a valid 3-scene Reel (face → data-visual → face)", () => {
    expect(() => ReelShotlistSchema.parse(validShotlist)).not.toThrow();
  });

  it("accepts a concept visual (visualBrief set, chartRef null)", () => {
    expect(() => ReelShotlistSceneSchema.parse(conceptVisual())).not.toThrow();
  });

  it("accepts a data visual (chartRef set, visualBrief null)", () => {
    expect(() => ReelShotlistSceneSchema.parse(dataVisual())).not.toThrow();
  });

  it("rejects a visual with NEITHER chartRef nor visualBrief (XOR)", () => {
    expect(() =>
      ReelShotlistSceneSchema.parse(
        validScene({ sceneType: "visual", chartRef: null, visualBrief: null }),
      ),
    ).toThrow();
  });

  it("rejects a visual with BOTH chartRef and visualBrief (XOR)", () => {
    expect(() =>
      ReelShotlistSceneSchema.parse(
        validScene({ sceneType: "visual", chartRef: "compounding-30y",
          visualBrief: "a split screen" }),
      ),
    ).toThrow();
  });

  it("rejects a face scene carrying a chartRef", () => {
    expect(() =>
      ReelShotlistSceneSchema.parse(validScene({ sceneType: "face", chartRef: "compounding-30y" })),
    ).toThrow();
  });

  it("rejects the retired 'chart' sceneType", () => {
    expect(() =>
      ReelShotlistSceneSchema.parse(
        validScene({ sceneType: "chart" as unknown as "visual", chartRef: "compounding-30y" }),
      ),
    ).toThrow();
  });

  it("rejects the retired 'face-over-chart' sceneType", () => {
    expect(() =>
      ReelShotlistSceneSchema.parse(
        validScene({ sceneType: "face-over-chart" as unknown as "visual" }),
      ),
    ).toThrow();
  });

  it("accepts face scene with null chartRef and null visualBrief", () => {
    expect(() => ReelShotlistSceneSchema.parse(validScene({ sceneType: "face" }))).not.toThrow();
  });

  it("rejects face voiceover exceeding 30 words", () => {
    const longVo = Array(31).fill("w").join(" ");
    expect(() =>
      ReelShotlistSceneSchema.parse(validScene({ sceneType: "face", voiceover: longVo })),
    ).toThrow();
  });

  it("accepts visual voiceover up to 45 words", () => {
    const vo = Array(45).fill("w").join(" ");
    expect(() =>
      ReelShotlistSceneSchema.parse(dataVisual()).voiceover !== undefined &&
        ReelShotlistSceneSchema.parse({ ...dataVisual(), voiceover: vo }),
    ).not.toThrow();
  });

  it("rejects targetSeconds below 15 / above 60 / non-integer", () => {
    expect(() => ReelShotlistSchema.parse({ ...validShotlist, targetSeconds: 10 })).toThrow();
    expect(() => ReelShotlistSchema.parse({ ...validShotlist, targetSeconds: 75 })).toThrow();
    expect(() => ReelShotlistSchema.parse({ ...validShotlist, targetSeconds: 22.5 })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm vitest run packages/shared/src/zod.test.ts -t "ReelShotlistSchema"`
Expected: FAIL — the current schema still has the 3-value enum + `emphasize`; cases like "rejects a visual with NEITHER" and "rejects the retired 'chart' sceneType" fail because `chart` is still valid and no XOR rule exists.

- [ ] **Step 3: Rewrite the schema to two-type + XOR, remove `emphasize`.**

In `packages/shared/src/zod.ts`, replace the block from `export const ReelSceneTypeEnum` (line 164) through the end of `ReelShotlistSceneSchema` (the closing `;` at line 210) with:

```typescript
export const ReelSceneTypeEnum = z.enum(["face", "visual"]);

const reelWordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export const ReelShotlistSceneSchema = z
  .object({
    scene: z.union([z.number(), z.string().min(1)]),
    voiceover: z.string(),
    onScreenText: z.string(),
    chartRef: z.string().nullable(),
    // A `visual` is data-backed (chartRef) XOR concept (visualBrief).
    visualBrief: z.string().nullable().optional(),
    // `explains` is the one-line takeaway; rendered on-frame as the support
    // line for visual scenes (brand-contract §8). null on face.
    explains: z.string().nullable().optional(),
    shotNotes: z.string(),
    sceneType: ReelSceneTypeEnum,
    estimatedSeconds: z.number().positive(),
  })
  // VO budget: face ≤30, visual ≤45 (Reel pacing).
  .refine(
    (s) => reelWordCount(s.voiceover) <= (s.sceneType === "face" ? 30 : 45),
    { message: "voiceover exceeds the per-scene word budget (face ≤30, visual ≤45)" },
  )
  // face ⇒ no chartRef, no visualBrief.
  .refine(
    (s) => s.sceneType !== "face" || (s.chartRef === null && (s.visualBrief ?? null) === null),
    { message: "'face' scenes must have null chartRef and null visualBrief" },
  )
  // visual ⇒ exactly one of chartRef / visualBrief (XOR).
  .refine(
    (s) => {
      if (s.sceneType !== "visual") return true;
      const hasChart = s.chartRef !== null;
      const hasBrief = typeof s.visualBrief === "string" && s.visualBrief.trim().length > 0;
      return hasChart !== hasBrief;
    },
    {
      message:
        "'visual' scenes need exactly one of chartRef (data visual) or visualBrief (concept visual)",
    },
  );
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm vitest run packages/shared/src/zod.test.ts -t "ReelShotlistSchema"`
Expected: PASS (all cases).

- [ ] **Step 5: Grep for any remaining `emphasize` reference in shared.**

Run: `grep -rn "emphasize" packages/shared/src` — expected: no matches. (If any remain, remove them.)

- [ ] **Step 6: Commit.**

```bash
git add packages/shared/src/zod.ts packages/shared/src/zod.test.ts
git commit -m "feat(schema): collapse reel sceneType to face|visual (XOR data/concept), drop emphasize"
```

---

### Task 2: Remove `emphasize` from the `CreativeUnit` scene type (derive/specs.ts)

**Files:**
- Modify: `packages/shared/src/derive/specs.ts:28-31`
- Test: `packages/shared/src/derive/specs.test.ts` (existing — must still pass)

- [ ] **Step 1: Delete the `emphasize` field from the scene interface.**

In `packages/shared/src/derive/specs.ts`, find the scene shape (around lines 28–31) containing:

```typescript
  estimatedSeconds?: number;
  visualBrief?: string | null; // free-form concept-visual brief; visual scenes only
  explains?: string | null;    // one-line takeaway the narration must land
  emphasize?: string | null;   // what to spotlight/annotate; chart scenes only
```

Remove the `emphasize` line so it reads:

```typescript
  estimatedSeconds?: number;
  visualBrief?: string | null; // concept-visual brief; concept visual scenes only
  explains?: string | null;    // one-line takeaway; rendered on-frame for visual scenes
```

- [ ] **Step 2: Build shared to confirm types still compile.**

Run: `pnpm --filter @engineerdad/shared build`
Expected: clean build (no reference to the removed field).

- [ ] **Step 3: Run the specs unit tests.**

Run: `pnpm vitest run packages/shared/src/derive/specs.test.ts`
Expected: PASS (the fixture at `specs.test.ts:42` uses `estCostMyr`, not `emphasize`, so no change needed there; if any test references `emphasize`, delete that property).

- [ ] **Step 4: Commit.**

```bash
git add packages/shared/src/derive/specs.ts
git commit -m "refactor(shared): drop emphasize from CreativeUnit scene type"
```

---

## Phase 2 — Projection (orchestrator worker input)

### Task 3: `ReelWorkerInput` → two-type, drop `emphasize`

**Files:**
- Modify: `packages/orchestrator/src/produce/reel-worker-input.ts:29-39, 77-87`
- Test: `packages/orchestrator/src/produce/reel-worker-input.test.ts` (existing — must still pass)

- [ ] **Step 1: Update the interface scene shape.**

In `reel-worker-input.ts`, change the `scenes` array element type (lines 29–39):

```typescript
  scenes: Array<{
    scene: string;
    voiceover: string;
    onScreenText: string;
    chartRef: string | null;
    sceneType: "face" | "visual";
    estimatedSeconds: number;
    visualBrief: string | null;
    explains: string | null;
  }>;
```

(Removed `emphasize`; `sceneType` is now two-value.)

- [ ] **Step 2: Update the projection map.**

In the `reelWorkerInput()` function, change the `scenes` mapping (lines 77–87) to drop `emphasize`:

```typescript
    scenes: unit.shotlistEn.map((s) => ({
      scene: String(s.scene),
      voiceover: s.voiceover,
      onScreenText: s.onScreenText,
      chartRef: s.chartRef,
      sceneType: s.sceneType ?? "face",
      estimatedSeconds: s.estimatedSeconds ?? s.durationSec ?? 5,
      visualBrief: s.visualBrief ?? null,
      explains: s.explains ?? null,
    })),
```

- [ ] **Step 3: Build orchestrator + run the projection test.**

Run: `pnpm --filter @engineerdad/orchestrator build && pnpm vitest run packages/orchestrator/src/produce/reel-worker-input.test.ts`
Expected: PASS. If the test asserts `emphasize` on a projected scene, delete that assertion; if it asserts `sceneType: "chart"`, change to `"visual"` with `chartRef` set.

- [ ] **Step 4: Commit.**

```bash
git add packages/orchestrator/src/produce/reel-worker-input.ts packages/orchestrator/src/produce/reel-worker-input.test.ts
git commit -m "refactor(orchestrator): reel-worker-input two-type sceneType, drop emphasize"
```

---

## Phase 3 — HeyGen wrapper `kind` merge (face|visual)

### Task 4: `generateReel` kind → two-value, image branch on `visual`

**Files:**
- Modify: `mcp-servers/heygen-wrapper/src/heygen.ts:91-123`
- Modify: `mcp-servers/heygen-wrapper/src/index.ts:80-99`
- Test: `mcp-servers/heygen-wrapper/src/__tests__/heygen.test.ts:206-250`

- [ ] **Step 1: Rewrite the heygen.test.ts generateReel cases (failing test).**

In `heygen.test.ts`, replace the three `generateReel` cases (the "builds a multi-scene…", "treats face-over-chart…", and "throws if a chart scene is missing chart_url" cases, ~lines 209–250) with:

```typescript
  it("builds a multi-scene video_inputs payload with caption + per-scene shapes", async () => {
    const fetchMock = mockFetchOk({ data: { video_id: "vid_1" } });
    const res = await generateReel({
      avatar_id: "av1", voice_id: "vo1", aspect_ratio: "9:16",
      scenes: [
        { kind: "face",   voiceover: "Hook line." },
        { kind: "visual", voiceover: "Visual line.", chart_url: "https://x/frame.png" },
      ],
    });
    expect(res.jobId).toBe("vid_1");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.video_inputs).toHaveLength(2);
    const face = body.video_inputs[0];
    expect(face.character).toMatchObject({ type: "avatar", avatar_id: "av1", fit: "cover" });
    expect(face.background).toEqual({ type: "color", value: "#0a1628" });
    const visual = body.video_inputs[1];
    expect(visual.character).toBeUndefined();
    expect(visual.voice.input_text).toBe("Visual line.");
    expect(visual.background).toEqual({ type: "image", url: "https://x/frame.png", fit: "cover" });
  });

  it("throws if a visual scene is missing chart_url", async () => {
    mockFetchOk({ data: { video_id: "vid_2" } });
    await expect(
      generateReel({
        avatar_id: "av1", voice_id: "vo1", aspect_ratio: "9:16",
        scenes: [{ kind: "visual", voiceover: "x" }],
      }),
    ).rejects.toThrow(/requires chart_url/);
  });
```

> Note: keep the test's existing `mockFetchOk` helper name if it differs — match whatever the file already uses for the fetch mock (the original cases reference `fetchMock`/`mockFetch...`). Do not invent a new helper.

- [ ] **Step 2: Run to verify it fails.**

Run: `pnpm vitest run mcp-servers/heygen-wrapper -t "generateReel"`
Expected: FAIL — `kind: "visual"` is rejected by the current `"face"|"chart"|"face-over-chart"` type / runtime.

- [ ] **Step 3: Update `ReelSceneInput` + the mapping in heygen.ts.**

In `mcp-servers/heygen-wrapper/src/heygen.ts`, change the interface (lines 91–96):

```typescript
export interface ReelSceneInput {
  kind: "face" | "visual";
  voiceover: string;
  /** Required for visual scenes: the uploaded full-frame image (chart/concept) URL. */
  chart_url?: string;
}
```

The mapping at lines 114–122 already branches `if (s.kind === "face")` then falls through to the image case — that logic is correct for two values. No change needed to the branch body; only the `face-over-chart` value disappears from the type.

- [ ] **Step 4: Update the `generate_reel` tool schema + description in index.ts.**

In `mcp-servers/heygen-wrapper/src/index.ts`, change the `kind` enum (line 87) and description (line 81):

```typescript
  "generate_reel",
  "Submit a multi-scene HeyGen reel render in one call. video_inputs is built per scene: kind:'face' = avatar fit:'cover' over a colour bg; kind:'visual' = full-frame image background (chart_url required — any rendered PNG, chart or concept), no avatar. caption defaults true (SRT sidecar). Returns { jobId } for polling via get_video_status.",
  {
    avatar_id: z.string(),
    voice_id: z.string(),
    aspect_ratio: z.enum(["9:16", "16:9", "1:1"]),
    scenes: z.array(z.object({
      kind: z.enum(["face", "visual"]),
      voiceover: z.string(),
      chart_url: z.string().optional(),
    })).min(1),
    caption: z.boolean().optional(),
    background_color: z.string().optional(),
  },
```

- [ ] **Step 5: Build + run the wrapper tests.**

Run: `pnpm --filter @engineerdad/heygen-wrapper build && pnpm vitest run mcp-servers/heygen-wrapper`
Expected: PASS. (If the package filter name differs, use the name in `mcp-servers/heygen-wrapper/package.json`.)

- [ ] **Step 6: Commit.**

```bash
git add mcp-servers/heygen-wrapper/src/heygen.ts mcp-servers/heygen-wrapper/src/index.ts mcp-servers/heygen-wrapper/src/__tests__/heygen.test.ts
git commit -m "feat(heygen): rename reel scene kind chart|face-over-chart -> visual (image background)"
```

---

## Phase 4 — Brand contract doctrine (§8 density + §9 self-critique)

### Task 5: Add §8 Text density by format to the brand contract

**Files:**
- Modify: `corpus/templates/brand-contract.md` (append after §7, before EOF)

- [ ] **Step 1: Append §8.** Add this section to the end of `corpus/templates/brand-contract.md`:

```markdown
## 8. Text density by format

**Principle:** match on-frame words to whether a voiceover exists. Reels are narrated → the frame is a visual aid with a *concise* support line, not a paragraph. Feed/Carousel are silent → the frame must fully self-explain, so they carry a short body block. **Over budget → trim words, never shrink type below §4a.** Counts are whitespace-split tokens, per language (EN and BM frames each independently in budget).

| Surface | Mandatory on frame | Discretionary text budget | Notes |
|---|---|---|---|
| **Reel `face`** | logo | none (avatar fills frame) | copy lives in HeyGen captions |
| **Reel `visual` — data** (chartRef set) | the chart/table/graph, YAML `caption_en`, full `source_citation`, logo | headline ≤ 6 words + 1 support line ≤ 12 words | **numbers OK** (vetted); single-stat callout lives here; support line = the scene's `explains` |
| **Reel `visual` — concept** (visualBrief set) | logo | headline ≤ 6 words + 1 support line ≤ 12 words + ≤ 2 labels ≤ 3 words each | **no numbers** (compliance boundary, not density); support line = `explains`; labels qualitative |
| **Feed** | logo (+ chart caption/citation if charted) | headline + body block: 2–3 lines, ~30–45 words total | self-explains, no VO; body = condensed `body` field |
| **Carousel card** | kicker, `N / total` indicator, logo | 2-line headline + body block: 2–3 lines, ~30–45 words | card 1 (hook hero) may be headline-only; cards 2..N carry the body |

- "Headline" = the hook / `onScreenText` in `var(--font-head)` at the §4a floor.
- Reel mandatory chart caption + `source_citation` are NEVER counted against the headline/support budget and NEVER truncated.
- The reel support line is the lever against wordiness: one line, ≤12 words — if it grows into a paragraph, it belongs in the voiceover.
- Feed/Carousel body is deliberately richer (no VO) but still concise + self-explanatory — ~45 words is the ceiling, and it must pass the §4a squint + §4b no-overlap checks.
```

- [ ] **Step 2: Verify the section renders (markdown sanity).**

Run: `grep -n "## 8. Text density" corpus/templates/brand-contract.md` — expected: one match.

- [ ] **Step 3: Commit.**

```bash
git add corpus/templates/brand-contract.md
git commit -m "docs(brand-contract): add §8 format-aware text-density doctrine"
```

---

### Task 6: Add §9 Self-critique rubric to the brand contract

**Files:**
- Modify: `corpus/templates/brand-contract.md` (append after §8)

- [ ] **Step 1: Append §9.**

```markdown
## 9. Self-critique rubric (every render worker runs this)

After rendering a PNG, `Read` it and write a one-line, evidence-cited observation for EACH item below. A "looks good" with no evidence is not acceptable. Any fail → fix and re-render within the retry budget.

1. **No overlap** — no text-on-text, text-on-chart, or headline-descender collisions. Cite the §4b vertical-clearance gaps you relied on.
2. **No edge clip** — quote the bottom-most line in full; if it ends mid-sentence it is clipped. Reels additionally respect the safe-area: top ~14% / bottom ~20% / right ~12% clear of the Reels UI.
3. **Density within §8 for this surface** — count the on-frame words for this format; if over budget, trim words (never shrink type below §4a).
4. **Legibility** — meets the §4a minimum sizes at the ~37% squint test.
5. **Hierarchy / contrast** — one clear focal point; palette-correct contrast (no grey-on-navy, etc.).

**Retry budget:** HARD CAP of 1 retry per scene/frame. A second failure is the signal — record it honestly in `qa_notes`/`warnings` and move on; the conductor decides whether to re-spawn. Do not author a third render.
```

- [ ] **Step 2: Verify.**

Run: `grep -n "## 9. Self-critique" corpus/templates/brand-contract.md` — expected: one match.

- [ ] **Step 3: Commit.**

```bash
git add corpus/templates/brand-contract.md
git commit -m "docs(brand-contract): add §9 self-critique rubric (shared by both render workers)"
```

---

## Phase 5 — Worker prompts

### Task 7: Reel worker — normal-path QA, wire `explains`, two-type, drop `emphasize`

**Files:**
- Modify: `corpus/templates/worker-prompts/reel-render-worker.md`

- [ ] **Step 1: Update the input shape + role to two-type.** In the `## Inputs` JSON example and the `## Your role` text, remove the `emphasize` field and change all `sceneType` language. Replace the role bullet 1 and the scene example so a `visual` scene is described as "data (chartRef set) or concept (visualBrief set)". Specifically:
  - In the example JSON `scenes[0]`, delete the `"emphasize": null` line.
  - Replace every occurrence of the `chart`/`visual` two-track description with the two-type model: `face` = avatar; `visual` = full-frame image, where `chartRef` set ⇒ render that vetted chart YAML (numbers OK), `visualBrief` set ⇒ concept frame (no numbers).

Run this to find every site to edit: `grep -n "emphasize\|sceneType\|chart\b\|visual\b" corpus/templates/worker-prompts/reel-render-worker.md`

- [ ] **Step 2: Rewrite Step 2 (frame building) for the two-type fork + on-frame `explains` + §8/§9.** Replace the `**\`chart\` scenes:**` and `**\`visual\` scenes:**` subsections of "Step 2" with a single `**\`visual\` scenes (data or concept):**` block:

```markdown
**`visual` scenes (data or concept — fork on field presence):**

First read `corpus/templates/brand-contract.md` §1, §4a, §4b, §8, §9 — they bind this frame.

- **Data visual** (`chartRef` is non-null):
  1. `Read corpus/data/charts/<chartRef>.yaml`. Note `chart_type`, `labels`, `series` (with `semantic_role`), `caption_en`, `source_citation`.
  2. Build the Chart.js 4.x config with `buildChartConfig(yaml, tokens, { lang: "en" })` from `corpus/templates/partials/chartjs-config.js`; embed Chart.js via CDN; emit the `window.__chartsReady` signal (same mechanics as `render-worker.md` §4/§7).
  3. Render `caption_en` and the full `source_citation` (≥24px, not truncated) unchanged. **Never change the YAML's numbers.** Numbers are allowed on a data visual (the figures are vetted).
- **Concept visual** (`visualBrief` is non-null, `chartRef` null):
  1. Compose a brand-compliant self-contained HTML frame from `scene.visualBrief` + `scene.explains` + `scene.onScreenText`, bound by §6 (palette-only colors, the two allowed fonts, logo present, no animation).
  2. **HARD RULE: no numbers/stats on the frame.** If the brief implies a statistic, that is a creative-director bug; append to `warnings[]` and render the qualitative point only.

**On-frame text budget (brand-contract §8) — both kinds:** a headline ≤6 words (from `onScreenText`) + **one support line ≤12 words derived from `scene.explains`** (condense if longer — the full explanation stays in the voiceover). Concept visuals may add ≤2 short labels (≤3 words). Do not dump `explains`/`visualBrief` prose onto the frame.

Respect the reel safe-area (§ Reel safe-area).
```

- [ ] **Step 3: Add the normal-path visual-QA pass.** After the "Render each frame" code block in Step 2 (before Step 3 "Upload chart frames to HeyGen"), insert:

```markdown
### Step 2.5. Visual QA (mandatory — runs in the NORMAL path, not just frames-only)

For every frame you rendered, `Read` the PNG and score it against brand-contract **§9** (overlap, edge-clip/safe-area, §8 density, §4a legibility, hierarchy/contrast). Write a one-line evidence-cited observation per item.

**Retry budget — HARD CAP of 1 retry per frame.** This QA happens BEFORE the HeyGen upload, so a retry is a free local re-render (no HeyGen spend). If a frame fails §9 on first render, fix and re-render once. If it still fails, append `{ sceneIndex, error: "<which §9 item failed>" }` to `warnings[]` and proceed with the best render — do NOT author a third.

Do NOT invoke the `ui-ux-pro-max` skill here — reel frames are simple full-frame compositions and the mechanical §9 pass is sufficient (keeps token cost down across the fanout).
```

- [ ] **Step 4: Update Step 4 (generate_reel mapping) to two-value kind.** Replace the `.map` in the `generate_reel` call so non-face scenes map to `kind: "visual"`:

```javascript
      scenes: input.scenes.map((s, i) => s.sceneType === "face"
        ? { kind: "face", voiceover: s.voiceover }
        : { kind: "visual", voiceover: s.voiceover, chart_url: chartUrl[i] })
```

Also update the surrounding prose ("face → kind:'face'; chart/visual → kind:'chart'") to "face → kind:'face'; visual → kind:'visual'".

- [ ] **Step 5: Update the Frames-only harness mode + Hard rules + Reference designs prose.** Remove `emphasize` from the Hard rules; change "Concept visuals carry no numbers" rule to reference the `visualBrief` fork; ensure "Never invent chartRefs" stays. In the frames-only block, change "every chart/visual frame" to "every visual frame".

- [ ] **Step 6: Verify no stale tokens remain.**

Run: `grep -n "emphasize\|face-over-chart\|sceneType.*chart\|kind:.chart" corpus/templates/worker-prompts/reel-render-worker.md`
Expected: no matches (the only `chart` left should be `chartRef`, `chart_url`, `corpus/data/charts`, `buildChartConfig`, Chart.js).

- [ ] **Step 7: Commit.**

```bash
git add corpus/templates/worker-prompts/reel-render-worker.md
git commit -m "feat(reel-worker): normal-path §9 QA, on-frame explains support line, two-type visual, drop emphasize"
```

---

### Task 8: Static worker — point §5.5 at §9, add format-aware density

**Files:**
- Modify: `corpus/templates/worker-prompts/render-worker.md`

- [ ] **Step 1: Point §5.5 Part A at the shared rubric.** In `render-worker.md` §5.5 Part A, add a leading line: "Score against brand-contract **§9** (the shared self-critique rubric) — every item gets a one-line evidence-cited observation." Keep the existing mechanical checklist as the concrete expansion. Keep Part B (`ui-ux-pro-max`) unchanged.

- [ ] **Step 2: Add the format-aware density check.** In §5.5 Part A, add a checklist item:

```markdown
- **Density within §8 (format-aware)**: Feed/Carousel carry a body block of ~30–45 words (2–3 lines) condensed from the scene's `body` — rich enough to self-explain without a voiceover, but not a wall of text. Count the on-frame words; if a card exceeds ~45 discretionary words, condense the `body` (do not shrink type below §4a). The compliance footer is NOT rendered on the frame (it rides the published caption), so excerpting `body` for the frame is safe.
```

- [ ] **Step 3: Add a §4 composition note about the body block.** In the "Compose HTML(s)" section, add to the Feed/Carousel inventory: "supporting body copy (≥36px): a 2–3 line block (~30–45 words) condensed from `scene.body` per brand-contract §8 — the silent-format self-explanation."

- [ ] **Step 4: Verify.**

Run: `grep -n "§9\|§8\|body block" corpus/templates/worker-prompts/render-worker.md`
Expected: matches in §5.5 + compose section.

- [ ] **Step 5: Commit.**

```bash
git add corpus/templates/worker-prompts/render-worker.md
git commit -m "feat(static-worker): cite §9 rubric + add §8 format-aware density (Feed/Carousel body block)"
```

---

## Phase 6 — Agents (Opus pins)

### Task 9: creative-director — two-type, drop `emphasize`, format-aware on-frame, model→opus

**Files:**
- Modify: `.claude/agents/creative-director.md`

> **sync:agents note:** the sections you edit (frontmatter `model:`, Step 3.5, return-shape JSON) are NOT inside `<!-- include:… -->` blocks (those only wrap the shared `bilingual.md`/`house-style.md` fragments). So edit `creative-director.md` directly. Run `pnpm sync:agents:check` after (Task 14) to confirm includes are still in sync.

- [ ] **Step 1: Bump the model.** Change frontmatter line 4 from `model: sonnet` to `model: opus`.

- [ ] **Step 2: Rewrite Step 3.5 to the two-type model.** In `.claude/agents/creative-director.md` "Step 3.5 — Reel-specific shotlist", replace the `sceneType` bullet list and the `emphasize` bullet with:

```markdown
- **`sceneType`** — one of:
  - `face` — HeyGen avatar (Shoo) fills the frame, talking. Hooks, anecdotes, confessionals, CTAs. The first AND last scene MUST be `face`.
  - `visual` — full-frame visual, voiceover only. Exactly one of:
    - **data visual** — set `chartRef` to a vetted chart id (leave `visualBrief` null). Use when the data IS the argument; numbers are allowed (they come from the vetted YAML).
    - **concept visual** — set `visualBrief` to a concrete free-form description (leave `chartRef` null). Use for non-numeric explanation (comparison, flow, metaphor, labelled diagram). **HARD RULE: no numbers/stats** — anything quantitative must be a data visual.
- **`explains`** — REQUIRED on every `visual` scene: the one-line takeaway the voiceover lands AND the worker renders on-frame as a ≤12-word support line. `null` on `face`.
- **`visualBrief`** — REQUIRED on concept visuals; `null` otherwise.
```

Delete the `**emphasize**` bullet entirely. Update the "Multiple visual scenes" paragraph: "A Reel MAY contain up to 3 `visual` scenes" (drop the `chart`/`visual` enumeration).

- [ ] **Step 3: Add the on-frame text-density guidance.** In Step 3a (Storyboard) or a new note under Step 3.5, add:

```markdown
**On-frame text density (brand-contract §8).** Author with the render budget in mind:
- **Reel** scenes: keep `onScreenText` a ≤6-word headline; put the explanation in `voiceover` and the one-line takeaway in `explains` (≤12 words). The frame is a visual aid — the voice carries the meaning. Do NOT pack sentences into `onScreenText`.
- **Feed / Carousel** (no voiceover): the on-frame body is the scene's `body`/`voiceover` segment, condensed by the render worker to ~30–45 words. Write `body` so a ~30–45 word excerpt self-explains the card. `onScreenText` stays the short card headline (≤8 words).
```

- [ ] **Step 4: Update the return-shape JSON examples.** In both the `## Return shape (strict)` block and the Single-Script result-shape block, delete `"emphasize": …` from every scene example and change `"sceneType": "chart"` → `"sceneType": "visual"` (keeping `chartRef` set on the data-visual example) and ensure the concept example has `chartRef: null` + a `visualBrief`.

- [ ] **Step 5: Verify no stale tokens.**

Run: `grep -n "emphasize\|sceneType.*chart\|model: sonnet" .claude/agents/creative-director.md`
Expected: no matches.

- [ ] **Step 6: Commit.**

```bash
git add .claude/agents/creative-director.md
git commit -m "feat(creative-director): two-type reel model, §8 on-frame density, drop emphasize, model->opus"
```

---

### Task 10: New `render-worker` agent (model: opus)

**Files:**
- Create: `.claude/agents/render-worker.md`

- [ ] **Step 1: Create the agent shell.** The body is thin — the procedure lives in the corpus worker-prompt files. The `tools:` list is the union of what both procedure files use (verified from their tool inventories: Read, Write, Bash + the static-renderer / asset-store / heygen / store / orchestrator MCPs). Frontmatter must enumerate tools (pre-flight confirmed every agent does).

```markdown
---
name: render-worker
description: Opus-pinned render worker for the produce stage (P2-render). Renders one CreativeVariant — static (Feed/Carousel) via HTML→PNG, or Reel via HeyGen multi-scene assembly. The full procedure lives in corpus/templates/worker-prompts/{render-worker,reel-render-worker}.md; the spawn prompt names which one to follow. Pinned to Opus because the work is spatial (overlap detection + layout repair) and editorial (on-frame text density) — see ADR-029 / the 2026-05-31 asset-quality spec.
model: opus
tools: Read, Write, Bash, mcp__static-renderer__render_html_to_png, mcp__asset-store__upload, mcp__heygen__upload_asset, mcp__heygen__generate_reel, mcp__heygen__get_video_status, mcp__store__update, mcp__orchestrator__read_step_result, mcp__orchestrator__write_step_result
---

# Render worker

You render ONE CreativeVariant end-to-end. You don't coordinate with sibling workers.

**Your FIRST action** (ADR-024): the spawn prompt carries a `stepResultId` ref, not your inputs. Call:

```
mcp__orchestrator__read_step_result({ stepResultId: "<sr_... from your prompt>" })
```

Then read the worker-prompt file your spawn prompt names and follow it EXACTLY:
- **Static (Feed / Carousel):** `corpus/templates/worker-prompts/render-worker.md`
- **Reel:** `corpus/templates/worker-prompts/reel-render-worker.md`

Those files are the source of truth for the brand contract, chart embedding, the §9 self-critique pass, the asset-store upload, and the claim-check return shape. Do not improvise around them.
```

- [ ] **Step 2: Verify the agent is well-formed.**

Run: `head -6 .claude/agents/render-worker.md` — expected: frontmatter with `model: opus` and a `tools:` line.

- [ ] **Step 3: Commit.**

```bash
git add .claude/agents/render-worker.md
git commit -m "feat(agents): add Opus-pinned render-worker agent (P2-render); procedures stay in corpus"
```

---

### Task 11: Point P2-render fanout at `render-worker` + assert it

**Files:**
- Modify: `packages/orchestrator/src/stages/produce.ts:447`
- Test: `packages/orchestrator/src/stages/produce.test.ts` (add assertion near line 188)

- [ ] **Step 1: Add the failing worker-name assertion.** In `produce.test.ts`, inside the existing test that builds P2-render with `EDOS_REEL_PIPELINE=off` (the one asserting `step.units` length 2 around line 187), add after the `if (step.kind !== "fanout")` guard:

```typescript
      expect(step.worker).toBe("render-worker");
```

- [ ] **Step 2: Run to verify it fails.**

Run: `pnpm vitest run packages/orchestrator/src/stages/produce.test.ts -t "P2-render"`
Expected: FAIL — `step.worker` is still `"general-purpose"`.

- [ ] **Step 3: Swap the worker name.** In `packages/orchestrator/src/stages/produce.ts`, the `p2Render` build returns (line ~445–448):

```typescript
    return {
      kind: "fanout",
      stepId: "P2-render",
      worker: "render-worker",
      units: [...staticUnits, ...reelUnits],
    };
```

- [ ] **Step 4: Run to verify it passes.**

Run: `pnpm --filter @engineerdad/orchestrator build && pnpm vitest run packages/orchestrator/src/stages/produce.test.ts -t "P2-render"`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/orchestrator/src/stages/produce.ts packages/orchestrator/src/stages/produce.test.ts
git commit -m "feat(produce): P2-render dispatches the Opus-pinned render-worker agent"
```

---

## Phase 7 — Fixtures, harness, ADR, docs

### Task 12: Refresh the 3 reel fixtures to the two-type shape

**Files:**
- Modify: `scripts/fixtures/reel-worker/chart-emphasis.json`
- Modify: `scripts/fixtures/reel-worker/concept-visual.json`
- Modify: `scripts/fixtures/reel-worker/mixed-reel.json`

- [ ] **Step 1: Rewrite each fixture's scenes** — every `"sceneType": "chart"` → `"sceneType": "visual"` (keep its `chartRef`), every `"sceneType": "visual"` stays (keep its `visualBrief`, ensure `chartRef: null`), and **delete every `"emphasize": …` property**. Example for `mixed-reel.json` scene 2 (the data visual):

```json
{ "scene": "2", "voiceover": "Start at 30 instead of 40 and by retirement the early starter has about three times as much, same monthly amount.", "onScreenText": "By year 30", "chartRef": "compounding-30y", "sceneType": "visual", "estimatedSeconds": 9, "visualBrief": null, "explains": "early start wins on time, not amount" }
```

And scene 3 (the concept visual) keeps `chartRef: null`, `sceneType: "visual"`, its `visualBrief`, and an `explains`; delete `emphasize`.

- [ ] **Step 2: Rename `chart-emphasis.json` → `data-visual.json`** (the name now misleads — `emphasize` is gone):

```bash
git mv scripts/fixtures/reel-worker/chart-emphasis.json scripts/fixtures/reel-worker/data-visual.json
```

- [ ] **Step 3: Validate the fixtures parse against the new schema.** Quick check via the harness (it builds the spawn prompt and would choke on malformed JSON):

Run: `pnpm run test:reel-frames data-visual` and `pnpm run test:reel-frames mixed-reel`
Expected: each prints the "REEL FRAMES-ONLY HARNESS" banner + a `Task()` call (no JSON parse error). Do NOT paste/run the Task yet — that's the manual verification in Task 16.

- [ ] **Step 4: Grep for stragglers.**

Run: `grep -rn "emphasize\|\"chart\"" scripts/fixtures/reel-worker/`
Expected: no matches.

- [ ] **Step 5: Commit.**

```bash
git add scripts/fixtures/reel-worker/
git commit -m "test(fixtures): reel fixtures to face|visual shape, drop emphasize, rename chart-emphasis->data-visual"
```

---

### Task 13: smoke-reel.mjs — verify-first, then update or quarantine

**Files:**
- Inspect/Modify: `scripts/smoke-reel.mjs`

- [ ] **Step 1: Check whether the script is already dead.** It references local ffmpeg stitching + `@engineerdad/media-stitch`, which ADR-028/B-034 deleted.

Run: `grep -n "media-stitch\|StitchSpec\|stitch" scripts/smoke-reel.mjs` and `ls packages/media-stitch 2>&1`
Expected: if `packages/media-stitch` does NOT exist (likely), the script is already non-runnable.

- [ ] **Step 2a: If media-stitch is gone (script dead):** do the minimal cosmetic rename for grep-cleanliness only — change `sceneType: "chart"` → `sceneType: "visual"` and the cut `type: "chart"` → `type: "visual"` in the `SCENES`/cut mapping — and add a one-line header comment: `// NOTE (2026-05-31): stale — references the deleted @engineerdad/media-stitch (ADR-028/B-034). Kept for reference; the live frames-only harness is scripts/test-reel-frames.mjs.` Do not attempt to make it run.

- [ ] **Step 2b: If media-stitch still exists (script live):** update `sceneType`/cut `type` strings to `"visual"` and run `pnpm tsx scripts/smoke-reel.mjs` only if you have a sandbox + `HEYGEN_*` creds (it costs money) — otherwise skip the run and note it.

- [ ] **Step 3: Commit.**

```bash
git add scripts/smoke-reel.mjs
git commit -m "chore(smoke-reel): two-type sceneType strings (+ stale-note if media-stitch removed)"
```

---

### Task 14: Rewrite ADR-029 in place

**Files:**
- Modify: `docs/decisions/029-reel-visual-scenes.md`

- [ ] **Step 1: Rewrite the decision to the two-type model.** Keep the Context section's "why three types existed" narrative (preserves history), but rewrite the title, Decision, and Consequences:
  - Title: `# ADR-029: Reel two-type visual scene model (face | visual)`
  - Add a `**Superseded portion:**` note: the original three-value `face|chart|visual` enum is collapsed to `face|visual`; `emphasize` is removed; the HeyGen-wrapper `kind` is aligned to `face|visual` (the dead `face-over-chart` deleted).
  - Decision table: two rows — `face` (avatar) and `visual` (full-frame image; data when `chartRef` set, concept when `visualBrief` set; XOR).
  - Per-scene fields table: `visualBrief` (concept visuals), `explains` (all visuals — rendered on-frame as the ≤12-word support line). Remove the `emphasize` row.
  - Add a short subsection referencing brand-contract §8 (density) + §9 (self-critique) and the Opus pins (render-worker agent + creative-director).
  - Update "Consequences": the enum change now propagates to zod, `ReelWorkerInput`, the heygen-wrapper `kind`, both worker prompts, the creative-director prompt, fixtures, and `produce.ts` (worker name).

- [ ] **Step 2: Verify.**

Run: `grep -n "face | visual\|emphasize\|§8\|§9" docs/decisions/029-reel-visual-scenes.md`
Expected: title/decision mention `face | visual`; no surviving `emphasize` as a live field (only in the historical-context note if you keep it).

- [ ] **Step 3: Commit.**

```bash
git add docs/decisions/029-reel-visual-scenes.md
git commit -m "docs(adr-029): rewrite to two-type face|visual model, drop emphasize, add §8/§9 + Opus pins"
```

---

### Task 15: Sync ARCHITECTURE.md + TASKS.md status mentions

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `TASKS.md` (Status header line referencing `sceneType face|chart|visual`)

- [ ] **Step 1: Find the stale mentions.**

Run: `grep -rn "face|chart|visual\|sceneType face" ARCHITECTURE.md TASKS.md`

- [ ] **Step 2: Update each** `sceneType face|chart|visual` → `sceneType face|visual` and any "chart/visual VO budget" → "visual VO budget (face ≤30, visual ≤45)".

- [ ] **Step 3: Commit.**

```bash
git add ARCHITECTURE.md TASKS.md
git commit -m "docs: sync sceneType face|chart|visual -> face|visual mentions"
```

---

## Phase 8 — Build, sync, full verification

### Task 16: Full build + test sweep + manual render check

**Files:** none (verification only)

- [ ] **Step 1: Stop any running `next dev`** to avoid the `.next` chunk collision (CLAUDE.md). Run: `lsof -ti:3030 | xargs -r kill` (ignore if nothing is listening).

- [ ] **Step 2: Sequential workspace build.**

Run: `pnpm -r build`
Expected: clean (sequential — never `--parallel`, per CLAUDE.md).

- [ ] **Step 3: sync:agents check.**

Run: `pnpm sync:agents:check`
Expected: PASS (the creative-director edits were outside `<!-- include -->` blocks; the new render-worker agent has no includes).

- [ ] **Step 4: Full test suite.**

Run: `pnpm -r test`
Expected: PASS. Watch specifically: `@engineerdad/shared` (zod two-type), `@engineerdad/orchestrator` (produce worker-name + reel-worker-input), `@engineerdad/heygen-wrapper` (kind).

- [ ] **Step 5: Repo-wide stale-token sweep.**

Run: `grep -rn "emphasize\|face-over-chart" packages/ mcp-servers/ corpus/ .claude/ scripts/fixtures/ | grep -v node_modules | grep -v /dist/`
Expected: no matches (historical mention inside ADR-029 Context is acceptable if you kept it — confirm it reads as history, not a live field).

- [ ] **Step 6: Restart Claude Code** (required for the new/changed agent model + the rebuilt heygen-wrapper + orchestrator MCPs to load). After restart, confirm MCPs are healthy: `claude mcp list` (or the project's equivalent) shows heygen + orchestrator + static-renderer registered.

- [ ] **Step 7: Manual render check (the real quality gate).** Run the fixture harness and paste each printed `Task()` into this conversation:

```
pnpm run test:reel-frames data-visual --copy
pnpm run test:reel-frames concept-visual --copy
pnpm run test:reel-frames mixed-reel --copy
pnpm run test:worker <a Feed fixture> --copy
```

For each rendered PNG, confirm against §8/§9: no overlaps, within the format's word budget (reel sparse + ≤12-word support line from `explains`; Feed/Carousel a 30–45-word body block), safe-area respected, legible at squint. The worker should now emit evidence-cited §9 QA notes in its return JSON.

- [ ] **Step 8: Final commit (if any doc tweaks fell out of verification).**

```bash
git add -A
git commit -m "chore: asset-quality verification pass (build/sync/test green)"
```

---

## Self-Review (completed by plan author)

**Spec coverage:** D2/D3 (Tasks 1,3,4,7,9,12,14) · D4 emphasize-drop (1,2,3,4,7,9,12,14) · D5 §8/§9 (5,6) · D6 explains/body (7,8,9) · D7 reel QA + retry (6,7) · D8 creative-director→opus (9) · D9 ADR rewrite (14) · D10 render-worker agent + fanout swap (10,11). Fixture harness as primary loop (12,16). All spec sections map to a task.

**Placeholder scan:** Task 13 has a verify-first branch (2a/2b) because smoke-reel's runnability depends on whether `packages/media-stitch` still exists — both branches are fully specified, not a TODO. Task 8 references "a Feed fixture" in the manual step because fixture names live in `scripts/fixtures/static-worker/` and the exact pick doesn't affect the procedure. No "TBD"/"handle edge cases"/"similar to Task N" placeholders.

**Type consistency:** `sceneType: "face" | "visual"` consistent across Tasks 1/3/7/9/12. HeyGen `kind: "face" | "visual"` consistent across Task 4 (heygen.ts, index.ts, test). `worker: "render-worker"` consistent across Tasks 10/11. `explains` (≤12-word on-frame support line) consistent across 7/9/§8. XOR rule wording matches between zod (Task 1) and creative-director/ADR (9/14).
