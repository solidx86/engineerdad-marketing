"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";

const LONG_TEXT_FIELDS = new Set([
  "scriptEn", "scriptBm", "bodyEn", "bodyBm", "faqEn", "faqBm",
  "promise", "decisionMemoEn", "decisionMemoBm", "selfCritique",
  "thumbnailBrief", "metaTargetingJson",
]);

const MARKDOWN_FIELDS = new Set([
  "bodyEn", "bodyBm", "faqEn", "faqBm", "decisionMemoEn", "decisionMemoBm",
]);

export function Field({ name, value }: { name: string; value: unknown }) {
  const isLong = LONG_TEXT_FIELDS.has(name);
  const isMarkdown = MARKDOWN_FIELDS.has(name);
  const initial = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  const [text, setText] = useState(initial);

  if (isMarkdown) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <textarea
          name={name}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="border border-slate-300 rounded p-2 font-mono text-xs min-h-[200px]"
        />
        <div className="border border-slate-200 rounded p-2 prose prose-sm max-w-none bg-slate-50">
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      </div>
    );
  }
  if (isLong) {
    return (
      <textarea
        name={name}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full border border-slate-300 rounded p-2 font-mono text-xs min-h-[100px]"
      />
    );
  }
  return (
    <input
      name={name}
      value={text}
      onChange={(e) => setText(e.target.value)}
      className="w-full border border-slate-300 rounded p-2 text-sm"
    />
  );
}
