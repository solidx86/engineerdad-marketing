// Orchestrates fetching Meta organic post insights and normalising them into
// the creative_signals table.  Idempotent via ON CONFLICT DO NOTHING on the
// (variant_id, channel, platform, kpi_name, ts) UNIQUE index.

import { getDb } from "./db.js";
import { creativeSignals } from "./schema.js";
import { getPostInsights } from "./meta-organic-client.js";

export interface VariantSpec {
  variantId: string;
  igPostId?: string;
  fbPostId?: string;
  isReel?: boolean;
}

export interface IngestArgs {
  variants: VariantSpec[];
  /** Unix epoch seconds; defaults to now. */
  nowUnix?: number;
}

export interface IngestResult {
  inserted: number;
  skipped: number;
}

export async function ingestMetaOrganicInsights(
  args: IngestArgs,
): Promise<IngestResult> {
  const ts = args.nowUnix ?? Math.floor(Date.now() / 1000);
  const db = getDb();

  let inserted = 0;
  let skipped = 0;

  for (const v of args.variants) {
    const pairs: Array<["ig" | "fb", string | undefined]> = [
      ["ig", v.igPostId],
      ["fb", v.fbPostId],
    ];

    for (const [platform, postId] of pairs) {
      if (!postId) continue;

      const data = await getPostInsights({
        postId,
        platform,
        isReel: v.isReel,
      });

      for (const metric of data.data ?? []) {
        const val = metric.values?.[0]?.value;
        if (typeof val !== "number") continue;

        // Drizzle's onConflictDoNothing returns the inserted rows; an
        // empty result means the dedup index swallowed the row.
        const inserted_rows = await db
          .insert(creativeSignals)
          .values({
            variantId: v.variantId,
            channel: "meta-organic",
            platform,
            kpiName: metric.name,
            kpiValue: val,
            ts,
            source: "meta-graph",
          })
          .onConflictDoNothing({
            target: [
              creativeSignals.variantId,
              creativeSignals.channel,
              creativeSignals.platform,
              creativeSignals.kpiName,
              creativeSignals.ts,
            ],
          })
          .returning({ id: creativeSignals.id });
        if (inserted_rows.length > 0) inserted++;
        else skipped++;
      }
    }
  }

  return { inserted, skipped };
}
