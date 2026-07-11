/**
 * Cloud workflow wire types, re-exported from the access layer so components
 * (which may not import `@/lib/access/**` directly) can consume them via the
 * `@/hooks/access/**` boundary.
 */

export type {
  PollInspectResponse,
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
  WorkflowTriggerCreateRequest,
  WorkflowTriggerItemListResponse,
  WorkflowTriggerItemResponse,
  WorkflowTriggerResponse,
  WorkflowUpdateRequest,
  WorkflowVersionResponse,
} from "@/lib/access/cloud/workflows";
