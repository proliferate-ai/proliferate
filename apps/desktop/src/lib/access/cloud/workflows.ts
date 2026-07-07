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
export type WorkflowRunDetailResponse = Schemas["WorkflowRunDetailResponse"];
export type StepActionResponse = Schemas["StepActionResponse"];
export type WorkflowCreateRequest = Schemas["WorkflowCreateRequest"];
export type WorkflowUpdateRequest = Schemas["WorkflowUpdateRequest"];
export type StartRunRequest = Schemas["StartRunRequest"];
export type RunStatusRequest = Schemas["RunStatusRequest"];
export type WorkflowTriggerResponse = Schemas["WorkflowTriggerResponse"];
export type WorkflowTriggerListResponse = Schemas["WorkflowTriggerListResponse"];
export type WorkflowTriggerCreateRequest = Schemas["WorkflowTriggerCreateRequest"];
export type WorkflowTriggerUpdateRequest = Schemas["WorkflowTriggerUpdateRequest"];
export type WorkflowTriggerItemResponse = Schemas["WorkflowTriggerItemResponse"];
export type WorkflowTriggerItemListResponse = Schemas["WorkflowTriggerItemListResponse"];
export type SlackChannelResponse = Schemas["SlackChannelResponse"];
export type SlackChannelsResponse = Schemas["SlackChannelsResponse"];

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

export async function getWorkflowRun(runId: string): Promise<WorkflowRunDetailResponse> {
  return getProliferateClient().requestJson<WorkflowRunDetailResponse>({
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

/** Desktop lane: tell the server the local runtime accepted the plan. */
export async function markWorkflowRunDelivered(runId: string): Promise<WorkflowRunResponse> {
  return getProliferateClient().requestJson<WorkflowRunResponse>({
    method: "POST",
    path: "/v1/cloud/workflows/runs/{run_id}/delivered",
    pathParams: { run_id: runId },
  });
}

/** Desktop lane: relay an observed transition from the local runtime to the server. */
export async function reportWorkflowRunStatus(
  runId: string,
  body: RunStatusRequest,
): Promise<WorkflowRunResponse> {
  return getProliferateClient().requestJson<WorkflowRunResponse>({
    method: "POST",
    path: "/v1/cloud/workflows/runs/{run_id}/status",
    pathParams: { run_id: runId },
    body,
  });
}

/** Cloud lane: retry a stuck (pending_delivery) cloud delivery. */
export async function redeliverWorkflowRun(runId: string): Promise<WorkflowRunResponse> {
  return getProliferateClient().requestJson<WorkflowRunResponse>({
    method: "POST",
    path: "/v1/cloud/workflows/runs/{run_id}/deliver",
    pathParams: { run_id: runId },
  });
}

/** Cloud lane: pull observed state from the sandbox and sync it into the ledger. */
export async function refreshWorkflowRun(runId: string): Promise<WorkflowRunResponse> {
  return getProliferateClient().requestJson<WorkflowRunResponse>({
    method: "GET",
    path: "/v1/cloud/workflows/runs/{run_id}/refresh",
    pathParams: { run_id: runId },
  });
}

/** The Slack channels the connected account can post to (spec 8.2, PR A). */
export async function listSlackChannels(): Promise<SlackChannelsResponse> {
  return getProliferateClient().requestJson<SlackChannelsResponse>({
    method: "GET",
    path: "/v1/cloud/workflows/slack/channels",
  });
}

// --- triggers (spec 3.5) -------------------------------------------------------

export async function listWorkflowTriggers(
  workflowId: string,
): Promise<WorkflowTriggerListResponse> {
  return getProliferateClient().requestJson<WorkflowTriggerListResponse>({
    method: "GET",
    path: "/v1/cloud/workflows/{workflow_id}/triggers",
    pathParams: { workflow_id: workflowId },
  });
}

export async function createWorkflowTrigger(
  workflowId: string,
  body: WorkflowTriggerCreateRequest,
): Promise<WorkflowTriggerResponse> {
  return getProliferateClient().requestJson<WorkflowTriggerResponse>({
    method: "POST",
    path: "/v1/cloud/workflows/{workflow_id}/triggers",
    pathParams: { workflow_id: workflowId },
    body,
  });
}

export async function updateWorkflowTrigger(
  workflowId: string,
  triggerId: string,
  body: WorkflowTriggerUpdateRequest,
): Promise<WorkflowTriggerResponse> {
  return getProliferateClient().requestJson<WorkflowTriggerResponse>({
    method: "PATCH",
    path: "/v1/cloud/workflows/{workflow_id}/triggers/{trigger_id}",
    pathParams: { workflow_id: workflowId, trigger_id: triggerId },
    body,
  });
}

export async function deleteWorkflowTrigger(
  workflowId: string,
  triggerId: string,
): Promise<void> {
  await getProliferateClient().requestJson<void>({
    method: "DELETE",
    path: "/v1/cloud/workflows/{workflow_id}/triggers/{trigger_id}",
    pathParams: { workflow_id: workflowId, trigger_id: triggerId },
  });
}

/** A poll trigger's per-item seen-set (spec 8.2 row B) — newest first. */
export async function listWorkflowTriggerItems(
  workflowId: string,
  triggerId: string,
  params?: { limit?: number; offset?: number },
): Promise<WorkflowTriggerItemListResponse> {
  return getProliferateClient().requestJson<WorkflowTriggerItemListResponse>({
    method: "GET",
    path: "/v1/cloud/workflows/{workflow_id}/triggers/{trigger_id}/items",
    pathParams: { workflow_id: workflowId, trigger_id: triggerId },
    query: { limit: params?.limit, offset: params?.offset },
  });
}
