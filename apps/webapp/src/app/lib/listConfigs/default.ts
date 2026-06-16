import type { ListConfig } from "../types.js";
import { APPROVAL_STATUS } from "@engineerdad/store";

export const defaultList: ListConfig = {
  columns: [
    { field: "title", label: "Title", type: "text" },
    { field: "runId", label: "Run", type: "runId" },
    { field: "approvalStatus", label: "Status", type: "status" },
  ],
  filters: [
    { field: "approvalStatus", label: "Status", type: "select", options: APPROVAL_STATUS },
  ],
};
