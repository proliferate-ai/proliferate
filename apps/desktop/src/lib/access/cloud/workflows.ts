/**
 * Cloud workflows access layer (spec 3.6 / W2 API surface).
 *
 * Thin typed wrappers over the auth-aware desktop cloud client. Importing
 * `getProliferateClient` from `./client` also registers the desktop client
 * factory as a side effect (auth/refresh middleware), so hooks that re-export
 * these get an authenticated client. The workflow paths are already typed in
 * the generated OpenAPI, so response shapes come straight from `components`.
 */

import type { components } from "@proliferate/cloud-sdk/generated/openapi";
import { getProliferateClient } from "@/lib/access/cloud/client";

type Schemas = components["schemas"];

export type WorkflowResponse = Schemas["WorkflowResponse"];
export type WorkflowVersionResponse = Schemas["WorkflowVersionResponse"];
export type WorkflowDetailResponse = Schemas["WorkflowDetailResponse"];
export type WorkflowListResponse = Schemas["WorkflowListResponse"];
export type WorkflowRunResponse = Schemas["WorkflowRunResponse"];
export type WorkflowRunListResponse = Schemas["WorkflowRunListResponse"];
export type WorkflowCreateRequest = Schemas["WorkflowCreateRequest"];
export type WorkflowUpdateRequest = Schemas["WorkflowUpdateRequest"];
export type StartRunRequest = Schemas["StartRunRequest"];

export async function listWorkflows(includeArchived = false): Promise<WorkflowListResponse> {
  return getProliferateClient().requestJson<WorkflowListResponse>({
    method: "GET",
    path: "/v1/cloud/workflows",
    query: { includeArchived },
  });
}

export async function createWorkflow(
  body: WorkflowCreateRequest,
): Promise<WorkflowDetailResponse> {
  return getProliferateClient().requestJson<WorkflowDetailResponse>({
    method: "POST",
    path: "/v1/cloud/workflows",
    body,
  });
}

export async function getWorkflow(workflowId: string): Promise<WorkflowDetailResponse> {
  return getProliferateClient().requestJson<WorkflowDetailResponse>({
    method: "GET",
    path: "/v1/cloud/workflows/{workflow_id}",
    pathParams: { workflow_id: workflowId },
  });
}

export async function updateWorkflow(
  workflowId: string,
  body: WorkflowUpdateRequest,
): Promise<WorkflowDetailResponse> {
  return getProliferateClient().requestJson<WorkflowDetailResponse>({
    method: "PATCH",
    path: "/v1/cloud/workflows/{workflow_id}",
    pathParams: { workflow_id: workflowId },
    body,
  });
}

export async function archiveWorkflow(workflowId: string): Promise<WorkflowResponse> {
  return getProliferateClient().requestJson<WorkflowResponse>({
    method: "DELETE",
    path: "/v1/cloud/workflows/{workflow_id}",
    pathParams: { workflow_id: workflowId },
  });
}

export async function listWorkflowRuns(
  workflowId?: string,
): Promise<WorkflowRunListResponse> {
  return getProliferateClient().requestJson<WorkflowRunListResponse>({
    method: "GET",
    path: "/v1/cloud/workflows/runs",
    query: workflowId ? { workflowId } : undefined,
  });
}

export async function getWorkflowRun(runId: string): Promise<WorkflowRunResponse> {
  return getProliferateClient().requestJson<WorkflowRunResponse>({
    method: "GET",
    path: "/v1/cloud/workflows/runs/{run_id}",
    pathParams: { run_id: runId },
  });
}

export async function startWorkflowRun(
  workflowId: string,
  body: StartRunRequest,
): Promise<WorkflowRunResponse> {
  return getProliferateClient().requestJson<WorkflowRunResponse>({
    method: "POST",
    path: "/v1/cloud/workflows/{workflow_id}/runs",
    pathParams: { workflow_id: workflowId },
    body,
  });
}
