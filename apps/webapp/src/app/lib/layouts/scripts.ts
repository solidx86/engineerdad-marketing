import type { EntityLayout } from "../types.js";

export const scriptsLayout: EntityLayout = {
  header: { title: "title", subtitle: "format", status: "approvalStatus" },
  primary: [
    {
      title: "Hook",
      fields: [{ role: "bilingual", en: "hookEn", bm: "hookBm", label: "Hook" }],
    },
    {
      title: "Script",
      fields: [{ role: "bilingual", en: "scriptEn", bm: "scriptBm", label: "Script" }],
    },
    {
      title: "CTA",
      fields: [{ role: "bilingual", en: "ctaEn", bm: "ctaBm", label: "CTA" }],
    },
    {
      title: "Claim bindings (ADR-030)",
      fields: [{ role: "bindings", field: "claimBindings", label: "Claim bindings" }],
    },
  ],
  secondary: [
    {
      title: "Provenance",
      fields: [
        { role: "meta", field: "runId" },
        { role: "fk", field: "brief", fk: "Briefs", label: "Brief" },
        { role: "timestamp", field: "createdAt" },
        { role: "meta", field: "approver" },
      ],
    },
    {
      title: "Spec",
      fields: [
        { role: "meta", field: "format" },
        { role: "meta", field: "funnelStage" },
        { role: "meta", field: "durationSec", label: "Duration (s)" },
        { role: "list", field: "proofRefs", label: "Proof refs" },
      ],
    },
  ],
};
