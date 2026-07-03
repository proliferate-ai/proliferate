/**
 * Cloud workflow wire types, re-exported from the access layer so components
 * (which may not import `@/lib/access/**` directly) can consume them via the
 * `@/hooks/access/**` boundary.
 */

export type {
  StartRunRequest,
  WorkflowCreateRequest,
  WorkflowDetailResponse,
  WorkflowListResponse,
  WorkflowResponse,
  WorkflowRunListResponse,
  WorkflowRunResponse,
  WorkflowUpdateRequest,
  WorkflowVersionResponse,
} from "@/lib/access/cloud/workflows";
