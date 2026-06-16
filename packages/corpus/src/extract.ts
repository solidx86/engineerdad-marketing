import { readFile } from "node:fs/promises";
import { extname } from "node:path";

export async function extractText(absPath: string): Promise<string> {
  const ext = extname(absPath).toLowerCase();
  if (ext === ".md" || ext === ".txt") {
    return readFile(absPath, "utf8");
  }
  if (ext === ".vtt") {
    const raw = await readFile(absPath, "utf8");
    return stripVtt(raw);
  }
  if (ext === ".pdf") {
    const buf = await readFile(absPath);
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const out = await pdfText(pdf, { mergePages: true });
    return Array.isArray(out.text) ? out.text.join("\n\n") : (out.text as string);
  }
  return "";
}

const TIMESTAMP_RE = /^\s*\d{1,2}:\d{2}(?::\d{2})?\.\d{3}\s+-->\s+\d{1,2}:\d{2}(?::\d{2})?\.\d{3}/;

export function stripVtt(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "WEBVTT" || trimmed.startsWith("NOTE ")) continue;
    if (/^\d+$/.test(trimmed)) continue;
    if (TIMESTAMP_RE.test(trimmed)) continue;
    // Strip inline tags like <c.colorE5E5E5> or <00:00:01.000>
    const cleaned = trimmed.replace(/<[^>]+>/g, "").trim();
    if (cleaned) out.push(cleaned);
  }
  return out.join("\n");
}
