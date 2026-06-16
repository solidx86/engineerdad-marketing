import "server-only";
import { store } from "@engineerdad/store";
import { backfillIgPostId } from "../../../lib/actions";
import { resolveAssetUrl } from "../../../lib/assets";
import { CopyButton, DownloadAllButton } from "../../../components/PostingPackTools";

const sceneNum = (url: string) => { const m = url.match(/\/(\d+)\.\w+(?:\?|$)/); return m ? Number(m[1]) : 0; };
const extOf = (u: string) => { const m = u.match(/\.(\w+)(?:\?|$)/); return m ? m[1] : "png"; };

export default async function OrganicPackPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const ids = await store.query("CreativeVariants", { runId, organicStatus: "Approved", igPostId: { isNull: true } }, { fields: ["title", "format", "aspect", "assetFiles", "organicLanguage", "organicCaptionEn", "organicCaptionBm", "organicHashtagsIg", "organicScheduledFor"] });
  const rows = (await Promise.all(ids.map((r) => store.get("CreativeVariants", r.id as string)))).filter(Boolean) as Record<string, unknown>[];
  const posts = rows
    .filter((r) => !(r.format === "Carousel" && r.aspect === "1:1"))
    .map((r) => {
      const lang = String(r.organicLanguage ?? "en").toLowerCase() === "ms" ? "BM" : "EN";
      const caption = lang === "BM" ? (r.organicCaptionBm as string) : (r.organicCaptionEn as string);
      const images = (Array.isArray(r.assetFiles) ? (r.assetFiles as { url: string }[]) : []).map((f) => f.url).sort((a, b) => sceneNum(a) - sceneNum(b)).map(resolveAssetUrl);
      return { id: r.id as string, title: r.title as string, lang, caption: caption ?? "", hashtags: Array.isArray(r.organicHashtagsIg) ? (r.organicHashtagsIg as string[]) : [], images, scheduledFor: r.organicScheduledFor ? new Date(r.organicScheduledFor as string).toISOString() : null };
    });
  return (
    <main className="p-6 max-w-3xl">
      <h1 className="text-xl font-bold mb-1">IG organic posting pack</h1>
      <p className="text-sm text-slate-500 mb-4">Run {runId} · post each by hand on IG, then paste the post ID to clear it from the queue.</p>
      {posts.map((p) => (
        <article key={p.id} className="mb-6 border rounded p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-semibold">{p.title} <span className="text-xs text-slate-400">{p.lang}{p.scheduledFor ? ` · ${p.scheduledFor.slice(0, 10)}` : ""}</span></h2>
            <DownloadAllButton files={p.images.map((u, i) => ({ url: u, name: `${runId}_${p.id.slice(0, 8)}_${i + 1}.${extOf(u)}` }))} />
            <CopyButton label="Caption" text={p.caption} />
            <CopyButton label="Hashtags" text={p.hashtags.join(" ")} />
          </div>
          <div className="flex gap-2 my-2 flex-wrap">
            {p.images.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="h-28 rounded border" /></a>)}
          </div>
          <pre className="whitespace-pre-wrap text-sm">{p.caption}</pre>
          <p className="text-xs text-blue-600">{p.hashtags.join(" ")}</p>
          <form action={backfillIgPostId.bind(null, p.id)} className="mt-2 flex gap-2 text-sm">
            <input type="hidden" name="runId" value={runId} />
            <input name="igPostId" placeholder="IG post ID / URL" className="border rounded px-2 py-1" />
            <button className="border rounded px-3 py-1 bg-slate-800 text-white">Mark posted</button>
          </form>
        </article>
      ))}
      {posts.length === 0 && <p className="text-slate-500">IG queue empty for this run.</p>}
    </main>
  );
}
