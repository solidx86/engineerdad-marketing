import { getMetaPostingPack } from "../../lib/posting-pack";
import { backfillAdId } from "../../lib/actions";
import { resolveAssetUrl } from "../../lib/assets";
import { CopyButton, DownloadAllButton } from "../../components/PostingPackTools";

const extOf = (u: string) => { const m = u.match(/\.(\w+)(?:\?|$)/); return m ? m[1] : "png"; };

export default async function PostingPackPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const pack = await getMetaPostingPack(runId);
  return (
    <main className="p-6 max-w-5xl">
      <h1 className="text-xl font-bold mb-1">Meta-paid posting pack</h1>
      <p className="text-sm text-slate-500 mb-4">Run {runId} · create these in Ads Manager (leave PAUSED), then backfill the ad IDs.</p>

      <section className="mb-6 border rounded p-4 bg-slate-50">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-semibold">Campaign</h2>
          <CopyButton text={pack.campaign.name} label="Name" />
        </div>
        <p className="text-sm">Name: <code>{pack.campaign.name}</code> · Objective: <code>{pack.campaign.objective}</code> · Special ad categories: none</p>
      </section>

      {pack.adsets.map((a) => (
        <section key={a.cellId} className="mb-6 border rounded p-4">
          <h2 className="font-semibold">Ad set · {a.name}</h2>
          <p className="text-sm text-slate-600">
            Budget: RM {a.dailyBudgetMyr.toFixed(2)}/day ({a.dailyBudgetCents} cents) · Optimize: {a.optimizationGoal} · Billing: {a.billingEvent} · Bid: {a.bidStrategy}
          </p>
          <p className="text-sm text-slate-600 flex items-center gap-2 flex-wrap">
            <span>Targeting: {a.targeting.countries.join(", ")} · age {a.targeting.ageMin}–{a.targeting.ageMax} · locales {a.targeting.locales.join(", ")}</span>
            <CopyButton label="Ad-set config" text={`Budget: RM ${a.dailyBudgetMyr.toFixed(2)}/day\nOptimize: ${a.optimizationGoal}\nBilling: ${a.billingEvent}\nBid: ${a.bidStrategy}\nTargeting: ${a.targeting.countries.join(", ")}, age ${a.targeting.ageMin}-${a.targeting.ageMax}, locales ${a.targeting.locales.join(", ")}`} />
          </p>
          {pack.ads.filter((ad) => ad.cellId === a.cellId).map((ad) => (
            <div key={ad.rowId} className="mt-4 border-t pt-3">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-medium">{ad.title} <span className="text-xs text-slate-400">({ad.asset.format} {ad.asset.aspect})</span></h3>
                <DownloadAllButton files={ad.asset.urls.map((u, i) => ({ url: resolveAssetUrl(u), name: `${runId}_${ad.rowId.slice(0, 8)}_${i + 1}.${extOf(u)}` }))} />
              </div>
              <div className="flex gap-2 my-2 flex-wrap">
                {ad.asset.urls.map((u, i) => (
                  <a key={i} href={resolveAssetUrl(u)} target="_blank" rel="noreferrer" title={`asset ${i + 1}`}>
                    <img src={resolveAssetUrl(u)} alt={`asset ${i + 1}`} className="h-24 rounded border" />
                  </a>
                ))}
                {ad.asset.urls.length === 0 && <span className="text-xs text-slate-400 italic">no assets attached</span>}
              </div>
              <div className="text-xs mb-2">CTA: <code>{ad.ctaType}</code></div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="flex items-center gap-2 mb-1"><strong>EN</strong><CopyButton label="EN copy" text={`${ad.en.headline}\n\n${ad.en.primaryText}\n\n${ad.en.description}`} /></div>
                  {ad.en.headline}<br /><span className="text-slate-600">{ad.en.primaryText}</span><br /><em>{ad.en.description}</em>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1"><strong>BM</strong><CopyButton label="BM copy" text={`${ad.bm.headline}\n\n${ad.bm.primaryText}\n\n${ad.bm.description}`} /></div>
                  {ad.bm.headline}<br /><span className="text-slate-600">{ad.bm.primaryText}</span><br /><em>{ad.bm.description}</em>
                </div>
              </div>
              <form action={backfillAdId.bind(null, ad.rowId)} className="mt-2 flex gap-2 items-center text-sm">
                <input type="hidden" name="runId" value={runId} />
                <input name="adIdEn" defaultValue={ad.backfill.adIdEn ?? ""} placeholder="EN ad ID" className="border rounded px-2 py-1" />
                <input name="adIdMs" defaultValue={ad.backfill.adIdMs ?? ""} placeholder="BM ad ID" className="border rounded px-2 py-1" />
                <button className="border rounded px-3 py-1 bg-slate-800 text-white">Save</button>
                {ad.backfill.done && <span className="text-green-600">✓ backfilled</span>}
              </form>
            </div>
          ))}
        </section>
      ))}
      {pack.ads.length === 0 && <p className="text-slate-500">No approved Meta-paid variants for this run.</p>}
    </main>
  );
}
