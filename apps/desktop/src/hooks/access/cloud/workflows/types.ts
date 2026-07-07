/**
 * Cloud workflow wire types, re-exported from the access layer so components
 * (which may not import `@/lib/access/**` directly) can consume them via the
 * `@/hooks/access/**` boundary.
 */

export type {
  SlackChannelResponse,
  SlackChannelsResponse,
  StartRunRequest,
  StepActionResponse,
  WorkflowCreateRequest,
  WorkflowDetailResponse,
  WorkflowListResponse,
  WorkflowResponse,
  WorkflowRunDetailResponse,
  WorkflowRunListResponse,
  WorkflowRunResponse,
  WorkflowTriggerItemListResponse,
  WorkflowTriggerItemResponse,
  WorkflowUpdateRequest,
  WorkflowVersionResponse,
} from "@/lib/access/cloud/workflows";
