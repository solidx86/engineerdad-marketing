"use client";
import { useState } from "react";

/** Copy arbitrary text to the clipboard with a brief confirmation. */
export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked (insecure context) — no-op */
        }
      }}
      className={`inline-flex items-center gap-1 text-xs border border-slate-300 rounded px-2 py-0.5 hover:bg-slate-100 ${className}`}
      title={`Copy ${label.toLowerCase()}`}
    >
      {done ? "✓ Copied" : `⧉ ${label}`}
    </button>
  );
}

/**
 * Download every asset in one click. Fetches each (same-origin /api/asset proxy
 * or https CDN) as a blob and triggers a save, staggered so the browser accepts
 * each download.
 */
export function DownloadAllButton({ files, label }: { files: { url: string; name: string }[]; label?: string }) {
  const [busy, setBusy] = useState(false);
  if (files.length === 0) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        for (const f of files) {
          try {
            const res = await fetch(f.url);
            const blob = await res.blob();
            const u = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = u;
            a.download = f.name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(u);
          } catch {
            /* skip a failed asset, continue the rest */
          }
          await new Promise((r) => setTimeout(r, 150));
        }
        setBusy(false);
      }}
      className="inline-flex items-center gap-1 text-xs border border-slate-300 rounded px-2 py-0.5 hover:bg-slate-100 disabled:opacity-50"
    >
      {busy ? "Downloading…" : (label ?? `⬇ Download all (${files.length})`)}
    </button>
  );
}
