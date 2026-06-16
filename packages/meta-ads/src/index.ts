// Public surface of @engineerdad/meta-ads — consumed by the meta-ads MCP
// adapter and by the orchestrator's eager-execute dispatch (ADR-023 Phase F).
//
// ADR-015 invariants (PAUSED-on-create + unlisted defaults + test-event-code
// injection on CAPI in dev) are baked into the implementations below — moving
// them to a library does not relax the safety contract; it only relocates
// the choke point from MCP-server boundary to library boundary.

export {
  capiSend,
  capiTestEvent,
  normalizeAndHash,
} from "./capi.js";
export type {
  CapiEventName,
  ActionSource,
  CapiUserData,
  CapiCustomData,
  CapiEvent,
  CapiSendInput,
  CapiSendResult,
} from "./capi.js";

export {
  getInsights,
  listCampaigns,
  listCreatives,
} from "./insights.js";
export type {
  InsightsInput,
  CampaignSummary,
} from "./insights.js";

export {
  createCampaign,
  createAdSet,
  updateAdSet,
  pauseAdSet,
  pauseAd,
  pauseCampaign,
  uploadVideo,
  uploadImage,
  createAdCreative,
  createAd,
  updateAd,
  getEntityStatusTool,
  listAds,
} from "./writes.js";
export type {
  CreateCampaignInput,
  CreateCampaignResult,
  CreateAdSetInput,
  CreateAdSetResult,
  UpdateAdSetInput,
  UpdateAdSetResult,
  UploadVideoInput,
  UploadVideoResult,
  UploadImageInput,
  UploadImageResult,
  CreateAdCreativeInput,
  CreateAdCreativeResult,
  CreateAdInput,
  CreateAdResult,
  UpdateAdInput,
  UpdateAdResult,
  GetEntityStatusInput,
  GetEntityStatusResult,
  ListAdsInput,
  ListAdsResult,
} from "./writes.js";

export {
  checkCompliance,
} from "./compliance.js";
export type {
  ComplianceLang,
  ComplianceCheckInput,
  ComplianceCheckResult,
} from "./compliance.js";
