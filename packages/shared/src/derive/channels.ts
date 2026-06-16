import type { ScriptFormat, Aspect, FunnelStage } from "../types.js";

export type Channel = "Meta-paid" | "Meta-organic" | "YouTube" | "YouTube-Shorts";

/** The per-Variant Channels set, from Format x Aspect x Funnel Stage (media-production Step 5.6). */
export function deriveChannels(
  format: ScriptFormat,
  aspect: Aspect,
  funnelStage: FunnelStage,
): Channel[] {
  if (format === "YT-Long") return ["YouTube"];
  if (format === "YT-Short") return ["YouTube-Shorts"];
  if (format === "Carousel") {
    return aspect === "1:1" ? ["Meta-organic"] : ["Meta-paid", "Meta-organic"];
  }
  // Reel and Feed
  return ["Meta-paid", "Meta-organic"];
}

const YT_CATEGORY_IDS: Record<string, string> = {
  Education: "27",
  "Howto & Style": "26",
  "People & Blogs": "22",
  "Science & Technology": "28",
  "News & Politics": "25",
  Entertainment: "24",
};

/** Map a Notion YT Category option name to a YouTube numeric category id (default Education). */
export function youtubeCategoryId(notionCategory: string): string {
  return YT_CATEGORY_IDS[notionCategory] ?? "27";
}

export type MetaCtaType =
  | "LEARN_MORE"
  | "SIGN_UP"
  | "CONTACT_US"
  | "WHATSAPP_MESSAGE"
  | "GET_QUOTE"
  | "SHOP_NOW"
  | "DOWNLOAD"
  | "SUBSCRIBE";

const WHATSAPP_HINTS = ["consult", "chat", "whatsapp", "hubungi"];

/** Meta CTA button type from funnel stage, with a WhatsApp override for BOFU consult CTAs. */
export function metaCtaType(funnelStage: FunnelStage, ctaText: string): MetaCtaType {
  if (funnelStage === "TOFU") return "LEARN_MORE";
  const lower = ctaText.toLowerCase();
  if (funnelStage === "BOFU" && WHATSAPP_HINTS.some((h) => lower.includes(h))) {
    return "WHATSAPP_MESSAGE";
  }
  return "SIGN_UP";
}
