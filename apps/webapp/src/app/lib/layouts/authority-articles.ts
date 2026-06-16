import type { EntityLayout } from "../types.js";

export const authorityArticlesLayout: EntityLayout = {
  header: { title: "title", subtitle: "topic", status: "approvalStatus" },
  primary: [
    {
      title: "Body",
      fields: [{ role: "bilingual", en: "bodyEn", bm: "bodyBm", label: "Body" }],
    },
    {
      title: "FAQ",
      fields: [{ role: "bilingual", en: "faqEn", bm: "faqBm", label: "FAQ" }],
    },
    {
      title: "SEO",
      fields: [
        { role: "meta", field: "targetQuery" },
        { role: "meta", field: "aeoSchema" },
        { role: "meta", field: "slug" },
        { role: "meta", field: "description" },
        { role: "list", field: "keywords" },
        { role: "meta", field: "readingTime" },
        { role: "link", field: "heroImageUrl", label: "Hero image" },
        { role: "meta", field: "heroImageAlt" },
      ],
    },
    {
      title: "Distribution",
      fields: [
        { role: "list", field: "targetChannels" },
        { role: "link", field: "prUrlEn", label: "PR URL (EN)" },
        { role: "link", field: "prUrlBm", label: "PR URL (BM)" },
        { role: "timestamp", field: "deliveredAt" },
        { role: "meta", field: "deliveredTo" },
      ],
    },
  ],
  secondary: [
    {
      title: "Provenance",
      fields: [
        { role: "meta", field: "runId" },
        { role: "meta", field: "createdBy" },
        { role: "timestamp", field: "createdAt" },
        { role: "meta", field: "approver" },
      ],
    },
    {
      title: "Source",
      fields: [
        { role: "primary", field: "citations", label: "Citations" },
        { role: "list", field: "relatedSlugs" },
      ],
    },
  ],
};
