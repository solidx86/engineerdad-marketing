import type { EntityLayout } from "../types.js";

// Note: the Creative section's assetFiles is NOT a standard layout field —
// the route at /review/creative-variants/[id] injects <SceneViewer> separately.
// The layout entry marks the field as "meta" so it doesn't appear in Raw fields.
export const creativeVariantsLayout: EntityLayout = {
  header: { title: "title", subtitle: "format", status: "approvalStatus", secondaryStatus: "organicStatus" },
  primary: [
    { title: "Creative", fields: [
      { role: "meta", field: "format" },
      { role: "meta", field: "aspect" },
      { role: "bilingual", en: "shotlistEn", bm: "shotlistBm", label: "Shotlist" },
      { role: "meta", field: "thumbnailBrief" },
      { role: "meta", field: "assetFiles", label: "Asset files (rendered above)" },
    ]},
    { title: "Meta paid copy", fields: [
      { role: "bilingual", en: "metaPrimaryTextEn", bm: "metaPrimaryTextBm", label: "Primary text" },
      { role: "bilingual", en: "metaHeadlineEn", bm: "metaHeadlineBm", label: "Headline" },
      { role: "bilingual", en: "metaDescriptionEn", bm: "metaDescriptionBm", label: "Description" },
      { role: "meta", field: "metaCtaType", label: "CTA" },
    ]},
    { title: "Organic copy", fields: [
      { role: "bilingual", en: "organicCaptionEn", bm: "organicCaptionBm", label: "Caption" },
      { role: "list", field: "organicHashtagsIg", label: "IG hashtags" },
      { role: "list", field: "organicHashtagsFb", label: "FB hashtags" },
      { role: "meta", field: "organicLanguage" },
    ]},
    { title: "YouTube", collapsible: true, defaultCollapsed: true, fields: [
      { role: "meta", field: "ytTitle" },
      { role: "primary", field: "ytDescription", label: "Description" },
      { role: "list", field: "ytTags" },
      { role: "meta", field: "ytCategory" },
      { role: "meta", field: "ytVideoId" },
    ]},
    { title: "Pipeline", collapsible: true, defaultCollapsed: true, fields: [
      { role: "primary", field: "pipelineNotes" },
      { role: "primary", field: "imageGenerationNotes" },
      // Reel lifecycle (per 2026-05-28-heygen-reel-pipeline). renderState lets
      // HG3 reviewers tell HeygenGenerating / Uploaded / RenderFailed apart
      // when a Reel arrives without assetFiles populated.
      { role: "meta", field: "renderState", label: "Render state" },
      { role: "timestamp", field: "renderStartedAt", label: "Render started at" },
      { role: "meta", field: "reelHeygenJobId", label: "HeyGen job id" },
      { role: "meta", field: "adId" },
    ]},
    { title: "Publishing", fields: [
      { role: "status", field: "organicStatus", label: "Organic status" },
      { role: "timestamp", field: "organicScheduledFor", label: "Scheduled for" },
      { role: "timestamp", field: "organicPublishedAt", label: "Published at" },
      { role: "meta", field: "igPostId" },
      { role: "meta", field: "fbPostId" },
    ]},
  ],
  secondary: [
    { title: "Provenance", fields: [
      { role: "meta", field: "runId" },
      { role: "meta", field: "createdBy" },
      { role: "timestamp", field: "createdAt" },
      { role: "meta", field: "approver" },
    ]},
    { title: "Linked Script", fields: [{ role: "fk", field: "script", fk: "Scripts", label: "Script" }]},
    { title: "Cost", fields: [{ role: "meta", field: "estimatedCostMyr", label: "Estimated (MYR)" }]},
    { title: "Compliance", fields: [{ role: "meta", field: "complianceCheck" }]},
    { title: "Channels", fields: [{ role: "list", field: "channels" }]},
  ],
};
