import type { EntityLayout } from "../types.js";

// Note: the detail route at /review/performance-reports/[id] renders <DecisionMemo>
// IN PLACE OF the Memo section's bilingual rendering. The layout entry keeps the
// fields marked as "used" so they don't leak into the Raw fields fallback.
export const performanceReportsLayout: EntityLayout = {
  header: { title: "title", subtitle: "window", status: "approvalStatus" },
  primary: [
    {
      title: "Memo",
      fields: [
        {
          role: "bilingual",
          en: "decisionMemoEn",
          bm: "decisionMemoBm",
          label: "Decision Memo",
        },
      ],
    },
    {
      title: "Snapshot",
      fields: [
        { role: "primary", field: "topCreatives", label: "Top creatives" },
        { role: "primary", field: "fatiguing", label: "Fatiguing" },
        { role: "primary", field: "costPerAngle", label: "Cost per angle" },
        {
          role: "primary",
          field: "banditAllocation",
          label: "Bandit allocation",
        },
      ],
    },
    {
      title: "Self-critique",
      fields: [{ role: "primary", field: "selfCritique" }],
    },
  ],
  secondary: [
    {
      title: "Provenance",
      fields: [
        { role: "meta", field: "runId" },
        { role: "meta", field: "window" },
        { role: "timestamp", field: "createdAt" },
        { role: "meta", field: "approver" },
      ],
    },
    {
      title: "Linked",
      fields: [
        { role: "list", field: "linkedBriefs" },
        { role: "list", field: "linkedExperiments" },
        { role: "list", field: "linkedHypotheses" },
      ],
    },
  ],
};
