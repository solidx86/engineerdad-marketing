import { store, ENTITY_NAMES } from "@engineerdad/store";
import { notFound } from "next/navigation";
import { EntityListView } from "../../components/EntityListView";
import { BriefApprovalGuidance } from "../../components/BriefApprovalGuidance";
import { listConfigFor } from "../../lib/listConfigs/index";
import { entityFromSlug, slugOf } from "../../lib/entities";

type SP = { [key: string]: string | string[] | undefined };

export default async function ReviewList({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string }>;
  searchParams: Promise<SP>;
}) {
  const { entity: slug } = await params;
  const sp = await searchParams;
  const entity = entityFromSlug(slug);
  if (!entity) notFound();

  const config = listConfigFor(entity);
  const filter: Record<string, unknown> = {};
  const filterFields = new Set(config.filters.map((f) => f.field));
  for (const k of filterFields) {
    if (k === "channels") continue; // JS-filtered below
    const v = sp[k];
    if (typeof v === "string" && v.length) filter[k] = v;
  }
  // Opt-in all column fields so the list view can render them (store.query only
  // returns id+title by default; everything else must be declared).
  const columnFields = config.columns.map((c) => c.field);
  // CreativeVariants needs the script FK to join titles, even though it's not a column.
  // Scripts needs the brief FK so the angle join below has a key to follow.
  const extraFields = entity === "CreativeVariants" ? ["script"] : entity === "Scripts" ? ["brief"] : [];
  const fetchFields = [...new Set([...columnFields, ...extraFields])];
  let rows = await store.query(entity, filter as Parameters<typeof store.query>[1], { fields: fetchFields });

  // Channels filter — applied in JS because the store DSL doesn't support jsonb
  // array containment. Small N; intentional. See spec §5.
  const channelParam = typeof sp.channels === "string" ? sp.channels : undefined;
  if (channelParam) {
    const wanted = channelParam.split(",").map((c) => c.trim()).filter(Boolean);
    rows = rows.filter((r) => {
      const arr = (r as Record<string, unknown>).channels;
      return Array.isArray(arr) && (arr as string[]).some((c) => wanted.includes(c));
    });
  }

  // CreativeVariants: prepend the linked script's title so each row reads as
  // "EPF Is a Floor — Feed · 4:5" instead of just "Feed · 4:5".
  if (entity === "CreativeVariants" && rows.length) {
    const scriptIds = [...new Set(
      rows.map((r) => (r as Record<string, unknown>).script as string).filter(Boolean)
    )];
    const scriptMap = new Map<string, string>();
    await Promise.all(
      scriptIds.map(async (id) => {
        const s = await store.get("Scripts", id);
        if (s) scriptMap.set(id, String((s as Record<string, unknown>).title ?? ""));
      })
    );
    rows = rows.map((r) => {
      const row = r as Record<string, unknown>;
      const scriptTitle = scriptMap.get(row.script as string) ?? "";
      const variantPart = String(row.title ?? "");
      return { ...row, title: scriptTitle ? `${scriptTitle} · ${variantPart}` : variantPart };
    });
  }

  // Scripts: enrich each row with the linked brief's angle.
  if (entity === "Scripts" && rows.length) {
    const briefIds = [...new Set(
      rows.map((r) => (r as Record<string, unknown>).brief as string).filter(Boolean)
    )];
    const briefMap = new Map<string, string>();
    await Promise.all(
      briefIds.map(async (id) => {
        const b = await store.get("Briefs", id);
        if (b) briefMap.set(id, String((b as Record<string, unknown>).angle ?? ""));
      })
    );
    rows = rows.map((r) => {
      const briefId = (r as Record<string, unknown>).brief as string;
      return { ...r, angle: briefMap.get(briefId) ?? "" };
    });
  }

  // CreativeVariants: enrich with angle via Script → Brief (in addition to
  // the existing script-title-prefix above).
  if (entity === "CreativeVariants" && rows.length) {
    const scriptToBrief = new Map<string, string>();
    const scriptIds = [...new Set(
      rows.map((r) => (r as Record<string, unknown>).script as string).filter(Boolean)
    )];
    await Promise.all(
      scriptIds.map(async (id) => {
        const s = await store.get("Scripts", id);
        const briefId = s ? String((s as Record<string, unknown>).brief ?? "") : "";
        if (briefId) scriptToBrief.set(id, briefId);
      })
    );
    const briefIds = [...new Set(scriptToBrief.values())];
    const briefAngle = new Map<string, string>();
    await Promise.all(
      briefIds.map(async (id) => {
        const b = await store.get("Briefs", id);
        if (b) briefAngle.set(id, String((b as Record<string, unknown>).angle ?? ""));
      })
    );
    rows = rows.map((r) => {
      const scriptId = (r as Record<string, unknown>).script as string;
      const briefId = scriptToBrief.get(scriptId) ?? "";
      return { ...r, angle: briefAngle.get(briefId) ?? "" };
    });
  }

  // Sort: read from query params, fall back to ListConfig default
  const rawSort = typeof sp.sort === "string" ? sp.sort : undefined;
  const rawDir = typeof sp.dir === "string" ? sp.dir : undefined;
  const activeSort = rawSort ?? config.defaultSort?.field;
  const activeDir = (rawDir === "desc" ? "desc" : rawDir === "asc" ? "asc" : undefined)
    ?? config.defaultSort?.dir ?? "asc";

  if (activeSort) {
    const mult = activeDir === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const av = (a as Record<string, unknown>)[activeSort];
      const bv = (b as Record<string, unknown>)[activeSort];
      const as = Array.isArray(av) ? av.map(String).join(",") : String(av ?? "");
      const bs = Array.isArray(bv) ? bv.map(String).join(",") : String(bv ?? "");
      return as.localeCompare(bs) * mult;
    });
  }

  // Build a clean searchParams map (string values only) for sort link generation
  const spForSort: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") spForSort[k] = v;
  }

  return (
    <>
      {entity === "Briefs" && typeof filter.runId === "string" ? (
        <BriefApprovalGuidance runId={filter.runId} />
      ) : null}
      <EntityListView
        title={entity}
        config={config}
        rows={rows as Row[]}
        rowHref={(r) => `/review/${slugOf(entity)}/${(r as { id: string }).id}`}
        sort={activeSort}
        dir={activeDir}
        searchParams={spForSort}
      />
    </>
  );
}

type Row = Record<string, unknown>;

export function generateStaticParams() {
  return ENTITY_NAMES.map((e) => ({ entity: slugOf(e) }));
}
