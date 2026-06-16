"use client";
import { resolveAssetUrl } from "../lib/assets";

type Asset = { url: string; sha256?: string };
type Aspect = "4:5" | "1:1" | "9:16" | "16:9";

// Thumbnail widths derived from h-48 (normal) and h-[576px] (tall)
const THUMB_W: Record<"normal" | "tall", Record<Aspect, string>> = {
  normal: { "4:5": "w-[154px]", "1:1": "w-48",      "9:16": "w-[108px]", "16:9": "w-[341px]" },
  tall:   { "4:5": "w-[461px]", "1:1": "w-[576px]", "9:16": "w-[324px]", "16:9": "w-[1024px]" },
};
const THUMB_H = { normal: "h-48", tall: "h-[576px]" };

const VIDEO_EXTS = [".mp4", ".mov", ".webm"];
function isVideo(url: string) {
  return VIDEO_EXTS.some((e) => url.toLowerCase().endsWith(e));
}

export function AllScenesViewer({ assets, aspect, tall }: { assets: Asset[]; aspect: Aspect; tall?: boolean }) {
  const size = tall ? "tall" : "normal";
  if (!assets?.length) {
    return <div className="text-xs text-slate-400 italic px-2 py-6 text-center">no assets attached</div>;
  }
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {assets.map((a, i) => {
        const src = resolveAssetUrl(a.url);
        return (
          <div key={i} className={`relative flex-shrink-0 ${THUMB_H[size]} ${THUMB_W[size][aspect]} bg-slate-100 rounded overflow-hidden`}>
            {isVideo(src)
              ? <video src={src} muted controls className="w-full h-full object-contain" />
              : <img src={src} alt={`scene ${i + 1}`} className="w-full h-full object-contain" />}
            {assets.length > 1 && (
              <span className="absolute bottom-1 right-1 text-[10px] bg-black/50 text-white px-1 rounded">
                {i + 1}/{assets.length}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
