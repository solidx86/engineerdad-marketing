import type { ListConfig } from "../types.js";
import { APPROVAL_STATUS, CHANNELS, ORGANIC_STATUS } from "@engineerdad/store";

export const creativeVariantsList: ListConfig = {
  columns: [
    { field: "title", label: "Title", type: "text", sortable: true },
    { field: "format", label: "Format", type: "badge", sortable: true },
    { field: "aspect", label: "Aspect", type: "badge", sortable: true },
    { field: "angle", label: "Angle", type: "badge", sortable: true },
    { field: "channels", label: "Channels", type: "chips", sortable: true },
    { field: "approvalStatus", label: "Status", type: "status" },
    { field: "organicStatus", label: "Organic", type: "status" },
    { field: "runId", label: "Run", type: "runId" },
  ],
  defaultSort: { field: "format", dir: "asc" as const },
  filters: [
    // Channels filter is applied in JS by the list route — DSL doesn't support
    // jsonb array containment; single consumer + small N. See spec §5.
    { field: "channels", label: "Channels", type: "multiSelect", options: CHANNELS },
    { field: "approvalStatus", label: "Approval", type: "select", options: APPROVAL_STATUS },
    { field: "organicStatus", label: "Organic", type: "select", options: ORGANIC_STATUS },
  ],
};
