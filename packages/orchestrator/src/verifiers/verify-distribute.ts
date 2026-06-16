import type { VerifyResult } from "../types.js";
import type { DistVariant, DistArticle } from "../distribute/plan-distribution.js";

/**
 * The distribute-stage acceptance test — a pure function, the guarantee for
 * the agentic D2-route cell. It compares the run's expected rows (D1 query)
 * against their actual post-distribution state (D3 re-query of Notion): every
 * Meta-paid variant must carry an Ad ID, every YouTube variant a YT Video ID,
 * every approved article a Delivered At. A row already satisfied passes
 * (idempotent). A one-language Meta variant passes — the other may have been
 * a legitimate compliance refusal; zero is the failure.
 */

const META = "Meta-paid";
const YT_CHANNELS = ["YouTube", "YouTube-Shorts"];

export function verifyDistribute(
  expectedVariants: DistVariant[],
  expectedArticles: DistArticle[],
  actualVariants: DistVariant[],
  actualArticles: DistArticle[],
): VerifyResult {
  const problems: string[] = [];
  const actualV = new Map(actualVariants.map((v) => [v.rowId, v]));
  const actualA = new Map(actualArticles.map((a) => [a.rowId, a]));

  for (const exp of expectedVariants) {
    const act = actualV.get(exp.rowId) ?? exp;
    if (exp.channels.includes(META)) {
      if (!act.adId || (!act.adId.en && !act.adId.ms)) {
        problems.push(`variant ${exp.rowId}: not distributed to Meta-paid (no Ad ID)`);
      }
    }
    if (exp.channels.some((c) => YT_CHANNELS.includes(c))) {
      if (!act.ytVideoId) {
        problems.push(`variant ${exp.rowId}: not distributed to YouTube (no YT Video ID)`);
      }
    }
  }

  for (const exp of expectedArticles) {
    const act = actualA.get(exp.rowId) ?? exp;
    if (!act.deliveredAt) {
      problems.push(`article ${exp.rowId}: not delivered (no Delivered At)`);
    }
  }

  return { ok: problems.length === 0, problems };
}
