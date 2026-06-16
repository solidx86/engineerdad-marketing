/**
 * The 70/20/10 budget-allocation overlay — pure functions. The experiment MCP
 * owns cell construction (factor cross-product, sample math); these functions
 * map MCP cells onto approved variants and overlay the per-cell budget split.
 */

export type Bucket = "70" | "20" | "10";

export interface MappedCell {
  cellId: string;
  factorLevels: Record<string, string>;
  variantPageIds: string[];
  bucket: Bucket;
}

export interface AllocatedCell extends MappedCell {
  allocationPct: number;
}

interface CellInput {
  cellId: string;
  factorLevels: Record<string, string>;
}

interface VariantInput {
  pageId: string;
  factorTags: Record<string, string>;
  budgetBucket: Bucket | null;
}

const BUCKETS: readonly Bucket[] = ["70", "20", "10"];
const BASE_SHARE: Record<Bucket, number> = { "70": 70, "20": 20, "10": 10 };

/** Majority Budget Bucket of the matched variants; "20" on a tie or when empty. */
function majorityBucket(variants: VariantInput[]): Bucket {
  const count: Record<Bucket, number> = { "70": 0, "20": 0, "10": 0 };
  for (const v of variants) {
    if (v.budgetBucket) count[v.budgetBucket]++;
  }
  const max = Math.max(count["70"], count["20"], count["10"]);
  if (max === 0) return "20";
  const winners = BUCKETS.filter((b) => count[b] === max);
  return winners.length === 1 ? winners[0]! : "20";
}

/**
 * Attach each cell's matching variants: a variant matches a cell when its
 * factorTags satisfy every (key, value) in the cell's factorLevels. The cell's
 * bucket is the majority Budget Bucket of those variants.
 */
export function mapCellsToVariants(
  cells: CellInput[],
  variants: VariantInput[],
): MappedCell[] {
  return cells.map((cell) => {
    const matched = variants.filter((v) =>
      Object.entries(cell.factorLevels).every(([k, val]) => v.factorTags[k] === val),
    );
    return {
      cellId: cell.cellId,
      factorLevels: cell.factorLevels,
      variantPageIds: matched.map((v) => v.pageId),
      bucket: majorityBucket(matched),
    };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Per-cell allocationPct = effectiveShare(bucket) / cellsInBucket. A bucket with
 * no cells redistributes its base share across non-empty buckets, proportional
 * to their base shares. Allocations sum to 100.
 */
export function applyAllocation(cells: MappedCell[]): AllocatedCell[] {
  const count: Record<Bucket, number> = { "70": 0, "20": 0, "10": 0 };
  for (const c of cells) count[c.bucket]++;

  const nonEmpty = BUCKETS.filter((b) => count[b] > 0);
  if (nonEmpty.length === 0) return cells.map((c) => ({ ...c, allocationPct: 0 }));

  const nonEmptyBase = nonEmpty.reduce((a, b) => a + BASE_SHARE[b], 0);
  const emptyShare = BUCKETS.filter((b) => count[b] === 0).reduce(
    (a, b) => a + BASE_SHARE[b],
    0,
  );
  const effShare: Record<Bucket, number> = { "70": 0, "20": 0, "10": 0 };
  for (const b of nonEmpty) {
    effShare[b] = BASE_SHARE[b] + emptyShare * (BASE_SHARE[b] / nonEmptyBase);
  }

  return cells.map((c) => ({
    ...c,
    allocationPct: round2(effShare[c.bucket] / count[c.bucket]),
  }));
}
