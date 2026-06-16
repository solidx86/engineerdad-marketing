import type { ListConfig } from "../types.js";
import { APPROVAL_STATUS, EXPERIMENT_LIFECYCLE_STATUS, PRIMARY_METRIC, TEST_TYPE } from "@engineerdad/store";

export const experimentsList: ListConfig = {
  columns: [
    { field: "title", label: "Title", type: "text" },
    { field: "status", label: "Phase", type: "status" },
    { field: "primaryMetric", label: "Metric", type: "badge" },
    { field: "testType", label: "Type", type: "badge" },
    { field: "runId", label: "Run", type: "runId" },
    { field: "approvalStatus", label: "Approval", type: "status" },
  ],
  filters: [
    { field: "status", label: "Phase", type: "select", options: EXPERIMENT_LIFECYCLE_STATUS },
    { field: "primaryMetric", label: "Metric", type: "select", options: PRIMARY_METRIC },
    { field: "testType", label: "Type", type: "select", options: TEST_TYPE },
    { field: "approvalStatus", label: "Approval", type: "select", options: APPROVAL_STATUS },
  ],
};
