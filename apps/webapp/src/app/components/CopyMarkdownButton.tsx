"use client";
import { useState } from "react";

export function CopyMarkdownButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-xs text-slate-500 hover:text-indigo-600 border border-slate-300 rounded px-2 py-0.5"
      title="Copy memo as markdown"
    >{copied ? "✓ copied" : "copy md"}</button>
  );
}
