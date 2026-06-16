"use client";
import { useEffect, useState } from "react";
import { resolveAssetUrl } from "../lib/assets";

type Asset = { url: string; sha256?: string };
type Aspect = "4:5" | "1:1" | "9:16" | "16:9";

const ASPECT_W: Record<Aspect, string> = {
  "4:5": "aspect-[4/5]",
  "1:1": "aspect-square",
  "9:16": "aspect-[9/16]",
  "16:9": "aspect-video",
};

const VIDEO_EXTS = [".mp4", ".mov", ".webm"];

function isVideo(url: string): boolean {
  return VIDEO_EXTS.some((e) => url.toLowerCase().endsWith(e));
}

export function SceneViewer({ assets, aspect }: { assets: Asset[]; aspect: Aspect }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIdx((i) => Math.min(assets.length - 1, i + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assets.length]);

  if (!assets?.length) {
    return <div className="text-xs text-slate-400 italic px-2 py-6 text-center">no assets attached</div>;
  }
  const current = assets[idx];
  const src = resolveAssetUrl(current.url);
  return (
    <div className="inline-block max-w-[480px]" tabIndex={0}>
      <div className={`relative bg-slate-100 ${ASPECT_W[aspect]} max-w-[480px]`}>
        {isVideo(src)
          ? <video src={src} controls muted className="w-full h-full object-contain" />
          : <img src={src} alt={`scene ${idx + 1}`} className="w-full h-full object-contain" />}
        {assets.length > 1 && (
          <>
            <button onClick={() => setIdx(Math.max(0, idx - 1))}
                    disabled={idx === 0}
                    className="absolute left-1 top-1/2 -translate-y-1/2 bg-white/80 rounded-full w-7 h-7 disabled:opacity-30">&larr;</button>
            <button onClick={() => setIdx(Math.min(assets.length - 1, idx + 1))}
                    disabled={idx === assets.length - 1}
                    className="absolute right-1 top-1/2 -translate-y-1/2 bg-white/80 rounded-full w-7 h-7 disabled:opacity-30">&rarr;</button>
          </>
        )}
      </div>
      {assets.length > 1 && (
        <div className="flex gap-1.5 justify-center mt-2">
          {assets.map((_, i) => (
            <button key={i} onClick={() => setIdx(i)}
                    aria-label={`scene ${i + 1}`}
                    className={`w-2 h-2 rounded-full ${i === idx ? "bg-indigo-600" : "bg-slate-300"}`} />
          ))}
        </div>
      )}
    </div>
  );
}
