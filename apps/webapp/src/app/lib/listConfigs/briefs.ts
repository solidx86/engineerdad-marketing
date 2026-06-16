import type { ListConfig } from "../types.js";
import { APPROVAL_STATUS } from "@engineerdad/store";

export const briefsList: ListConfig = {
  columns: [
    { field: "title", label: "Title", type: "text", sortable: true },
    { field: "angle", label: "Angle", type: "badge", sortable: true },
    { field: "persona", label: "Persona", type: "badge", sortable: true },
    { field: "funnelStage", label: "Stage", type: "badge", sortable: true },
    { field: "budgetBucket", label: "Bucket", type: "badge", sortable: true },
    { field: "approvalStatus", label: "Status", type: "status" },
    { field: "runId", label: "Run", type: "runId" },
  ],
  defaultSort: { field: "angle", dir: "asc" as const },
  filters: [
    { field: "approvalStatus", label: "Approval", type: "select", options: APPROVAL_STATUS },
  ],
};
