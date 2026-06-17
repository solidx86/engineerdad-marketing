import { checkCompliance } from "@engineerdad/meta-ads";
import type { CreativeUnit } from "@engineerdad/shared/derive";
import type { VerifyResult } from "../types.js";

/**
 * The produce-stage acceptance test — a pure function over GROUND TRUTH.
 *
 * Its inputs are not the creative-director's self-report. `scripts` and
 * `variants` are the approved Scripts and the CreativeVariants rows queried
 * back *from Notion*; `renderWorkersRan` is the count read from the analytics
 * events table. The produce stage's P3 does those reads and feeds this
 * function — so an agent cannot author a passing result it did not actually
 * produce. The function itself stays pure: arrays in, VerifyResult out.
 */

export interface ProduceClaimBinding {
  kind: string;
  chartRef: string | null;
  figures: string[];
  takeaway: string;
}

export interface ProduceScript {
  id: string;
  claimBindings?: ProduceClaimBinding[];
}

export interface ProduceVariant {
  id: string;
  scriptId: string;
  format: string;
  aspect: string;
  channels: string[];
  assetFiles: { url: string; sha256: string }[];
  renderState: string;
  metaSpecComplete: boolean;
  organicSpecComplete: boolean;
  complianceCheck: boolean;
  estCostMyr: number;
  organicCaptionEn: string;
  organicCaptionBm: string;
}

export function verifyProduce(
  scripts: ProduceScript[],
  variants: ProduceVariant[],
  reportedTotalMyr: number,
  renderWorkersRan: number,
  // Optional, defaults OFF — legacy 4-arg callers (and the system's default
  // EDOS_REEL_PIPELINE=off stance) keep pre-pipeline behavior; the production
  // P5 caller passes reelPipelineEnabled() explicitly.
  reelPipelineEnabled = false,
): VerifyResult {
  const problems: string[] = [];
  const flags: string[] = [];
  const FORMAT_MATRIX = 5; // Reel, Feed, YT-Long, Carousel x2

  for (const s of scripts) {
    const n = variants.filter((v) => v.scriptId === s.id).length;
    if (n !== FORMAT_MATRIX) problems.push(`script ${s.id}: ${n}/${FORMAT_MATRIX} variants`);
  }
  const isStatic = (v: ProduceVariant) => v.format === "Feed" || v.format === "Carousel";
  for (const v of variants.filter(isStatic)) {
    if (v.assetFiles.length === 0) problems.push(`variant ${v.id}: Asset Files empty`);
  }
  for (const v of variants) {
    const meta = v.channels.some((c) => c.startsWith("Meta"));
    if (meta && !v.metaSpecComplete) problems.push(`variant ${v.id}: Meta spec incomplete`);
    if (v.channels.includes("Meta-organic") && !v.organicSpecComplete)
      problems.push(`variant ${v.id}: organic spec incomplete`);
    if (!v.complianceCheck) problems.push(`variant ${v.id}: compliance scan did not pass`);
  }
  for (const v of variants) {
    if (!v.channels.includes("Meta-organic")) continue;
    if (v.organicCaptionEn.length === 0) continue;
    const en = checkCompliance({ primary_text: v.organicCaptionEn, lang: "en" });
    if (!en.ok) {
      problems.push(
        `variant ${v.id}: organic EN caption fails compliance — ${en.refusal_reason ?? "missing required disclaimer"}`,
      );
    }
    if (v.organicCaptionBm.length > 0) {
      const ms = checkCompliance({ primary_text: v.organicCaptionBm, lang: "ms" });
      if (!ms.ok) {
        problems.push(
          `variant ${v.id}: organic BM caption fails compliance — ${ms.refusal_reason ?? "missing required disclaimer"}`,
        );
      }
    }
  }

  const sum = variants.reduce((a, v) => a + v.estCostMyr, 0);
  if (sum !== reportedTotalMyr) problems.push("totals.cost drifts from per-variant sum");
  const staticN = variants.filter(isStatic).length;
  if (staticN > 0 && renderWorkersRan === 0)
    problems.push(`${staticN} static variants, 0 render workers ran`);

  // ── B-037 L3: a reel must carry an asset by P5, unless it legitimately
  //    failed to render. Gated by the kill switch — pipeline-off reels are
  //    asset-less by design. Any non-RenderFailed reel with empty assetFiles
  //    is stranded (claims Uploaded, stuck HeygenGenerating, or never rendered).
  if (reelPipelineEnabled) {
    for (const v of variants.filter((x) => x.format === "Reel")) {
      if (v.assetFiles.length > 0) continue;
      if (v.renderState === "RenderFailed") {
        flags.push(`reel ${v.id}: RenderFailed — no asset; review/regenerate at HG3`);
      } else {
        problems.push(
          `reel ${v.id}: empty Asset Files with renderState "${v.renderState}" — reel did not persist (B-037)`,
        );
      }
    }
  }

  const res: VerifyResult = { ok: problems.length === 0, problems };
  if (flags.length > 0) res.data = { flags };
  return res;
}

// ── P1 chart-binding verifier (ADR-030) ────────────────────────────────────
//   The creative-director executes the Script's approved claimBindings; it
//   must not introduce a chart of its own or leak a number into a concept
//   visual. This runs over the CD's CreativePlan scenes (the chart choices)
//   against the Scripts' data bindings — covering ALL formats incl. Carousel
//   and Feed, not just Reels.
//
//   HARD (fails the stage):
//     • every scene `chartRef` ∈ the parent Script's kind:data binding refs
//       (the B-038 guard, now enforced at produce too); and
//     • a concept visual (visualBrief set, chartRef null) carries NO digit
//       (folds in B-036 — figures leaking into concept-visual briefs).
//   SOFT (flags to HG3 via data.flags):
//     • a data scene's `explains` should echo the bound binding's takeaway.

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

export function verifyChartBindings(
  scripts: ProduceScript[],
  creatives: CreativeUnit[],
): VerifyResult {
  const problems: string[] = [];
  const flags: string[] = [];
  const byId = new Map(scripts.map((s) => [s.id, s]));

  for (const c of creatives) {
    const script = byId.get(c.scriptId);
    const dataBindings = (script?.claimBindings ?? []).filter((b) => b.kind === "data");
    const allowedRefs = new Set(
      dataBindings.map((b) => b.chartRef).filter((r): r is string => typeof r === "string"),
    );
    const takeaways = dataBindings.map((b) => norm(b.takeaway)).filter((t) => t.length > 0);
    const label = `script ${c.scriptId} (${c.format})`;

    for (const scene of c.shotlistEn ?? []) {
      const chartRef = scene.chartRef ?? null;
      const visualBrief = scene.visualBrief ?? null;

      if (chartRef !== null) {
        if (!allowedRefs.has(chartRef)) {
          problems.push(
            `${label} scene ${scene.scene}: chartRef "${chartRef}" is not a kind:data binding on the Script (B-038 guard)`,
          );
        }
        const explains = scene.explains ?? "";
        if (explains.length > 0 && takeaways.length > 0) {
          const e = norm(explains);
          const matches = takeaways.some((t) => t === e || t.includes(e) || e.includes(t));
          if (!matches) {
            flags.push(
              `${label} scene ${scene.scene}: explains "${explains.slice(0, 50)}" does not echo any bound takeaway`,
            );
          }
        }
      } else if (visualBrief !== null && visualBrief.length > 0) {
        // Concept visual — must carry no statistic (B-036).
        if (/\d/.test(visualBrief) || /\d/.test(scene.onScreenText ?? "")) {
          problems.push(
            `${label} scene ${scene.scene}: concept visual contains a digit — quantitative claims must be a data visual bound to a chart (B-036)`,
          );
        }
      }
    }
  }

  const res: VerifyResult = { ok: problems.length === 0, problems };
  if (flags.length > 0) res.data = { flags };
  return res;
}
