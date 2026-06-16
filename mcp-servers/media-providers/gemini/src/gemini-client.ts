// Gemini image-generation client. Raw fetch (no SDK) to match repo convention
// (see mcp-servers/meta-ads/src/insights.ts:38–48). Synchronous API — no
// polling needed; image returned in the same response.
import { createHash } from "node:crypto";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type GeminiImageModel = "gemini-2.5-flash-image" | "gemini-3-pro-image-preview";
export type Aspect = "1:1" | "4:5" | "9:16" | "16:9";
export type Language = "en" | "ms";
export type Resolution = "1K" | "2K" | "4K";

// Pricing constants — STANDARD tier as of 2026-05-10. Verified against
// https://ai.google.dev/gemini-api/docs/pricing during E-004 image phase build.
// Update both this lookup AND ADR-013 if pricing changes.
const STANDARD_PRICING_USD: Record<string, number> = {
  "gemini-2.5-flash-image": 0.039,
  "gemini-3-pro-image-preview-1K": 0.134,
  "gemini-3-pro-image-preview-2K": 0.134,
  "gemini-3-pro-image-preview-4K": 0.24,
};

export function priceForCall(model: GeminiImageModel, resolution?: Resolution): number {
  if (model === "gemini-2.5-flash-image") return STANDARD_PRICING_USD[model] ?? 0;
  const res = resolution ?? "1K";
  const key = `${model}-${res}`;
  const price = STANDARD_PRICING_USD[key];
  if (price === undefined) {
    throw new Error(`gemini: no pricing entry for ${model} at resolution ${res}`);
  }
  return price;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export interface GenerateImageOptions {
  apiKey: string;
  model: GeminiImageModel;
  prompt: string;
  aspect: Aspect;
  language: Language;
  resolution?: Resolution;
}

export interface GenerateImageResult {
  pngBase64: string;
  mimeType: string;
  costUsd: number;
  promptHash: string;
  composedPrompt: string;
}

export function composePrompt(opts: { prompt: string; aspect: Aspect; language: Language }): string {
  const langLabel = opts.language === "en" ? "English" : "Bahasa Malaysia";
  return [
    opts.prompt.trim(),
    "",
    `Render as a single ${opts.aspect} aspect-ratio image, single-frame composition.`,
    `Any embedded headline text must be in ${langLabel}.`,
  ].join("\n");
}

interface GeminiInlineData {
  mimeType?: string;
  data?: string;
}

interface GeminiPart {
  text?: string;
  inlineData?: GeminiInlineData;
  inline_data?: GeminiInlineData;
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

export async function generateImage(opts: GenerateImageOptions): Promise<GenerateImageResult> {
  const composedPrompt = composePrompt({
    prompt: opts.prompt,
    aspect: opts.aspect,
    language: opts.language,
  });

  const url = new URL(`${GEMINI_BASE}/${opts.model}:generateContent`);
  url.searchParams.set("key", opts.apiKey);

  const body = {
    contents: [{ parts: [{ text: composedPrompt }] }],
    generationConfig: { responseModalities: ["IMAGE"] },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: GeminiResponse = {};
  try {
    parsed = JSON.parse(text) as GeminiResponse;
  } catch {
    throw new Error(`gemini: non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg = parsed.error?.message ?? text;
    throw new Error(`gemini API ${res.status}: ${msg}`);
  }

  if (parsed.promptFeedback?.blockReason) {
    throw new Error(`gemini: prompt blocked (${parsed.promptFeedback.blockReason})`);
  }

  const parts = parsed.candidates?.[0]?.content?.parts ?? [];
  const inline = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
  const data = inline?.inlineData?.data ?? inline?.inline_data?.data;
  const mimeType = inline?.inlineData?.mimeType ?? inline?.inline_data?.mimeType ?? "image/png";

  if (!data) {
    throw new Error(
      `gemini: no inline image in response (finishReason=${parsed.candidates?.[0]?.finishReason ?? "unknown"})`,
    );
  }

  return {
    pngBase64: data,
    mimeType,
    costUsd: priceForCall(opts.model, opts.resolution),
    promptHash: sha256Hex(composedPrompt),
    composedPrompt,
  };
}
