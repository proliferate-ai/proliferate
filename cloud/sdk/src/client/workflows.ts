import type {
  WorkflowDefinitionCreateRequest,
  WorkflowDefinitionListResponse,
  WorkflowDefinitionResponse,
  WorkflowDefinitionUpdateRequest,
  WorkflowInvocationCreateRequest,
  ManagedWorkflowHistoryResponse,
  ManagedWorkflowInvocationResponse,
  WorkflowInvocationResponse,
  WorkflowRunEligibilityResponse,
} from "../types/index.js";
import { getProliferateClient, type ProliferateCloudClient } from "./core.js";

export interface WorkflowRequestOptions {
  signal?: AbortSignal;
}

export async function listWorkflowDefinitions(
  client: ProliferateCloudClient = getProliferateClient(),
  options: WorkflowRequestOptions = {},
): Promise<WorkflowDefinitionListResponse> {
  return client.requestJson<WorkflowDefinitionListResponse>({
    method: "GET",
    path: "/v1/workflows",
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function getWorkflowDefinition(
  workflowDefinitionId: string,
  client: ProliferateCloudClient = getProliferateClient(),
  options: WorkflowRequestOptions = {},
): Promise<WorkflowDefinitionResponse> {
  return client.requestJson<WorkflowDefinitionResponse>({
    method: "GET",
    path: "/v1/workflows/{workflow_definition_id}",
    pathParams: { workflow_definition_id: workflowDefinitionId },
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function getWorkflowRunEligibility(
  workflowDefinitionId: string,
  client: ProliferateCloudClient = getProliferateClient(),
  options: WorkflowRequestOptions = {},
): Promise<WorkflowRunEligibilityResponse> {
  return client.requestJson<WorkflowRunEligibilityResponse>({
    method: "GET",
    path: "/v1/workflows/{workflow_definition_id}/run-eligibility",
    pathParams: { workflow_definition_id: workflowDefinitionId },
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function putWorkflowInvocation(
  invocationId: string,
  body: WorkflowInvocationCreateRequest,
  client: ProliferateCloudClient = getProliferateClient(),
  options: WorkflowRequestOptions = {},
): Promise<WorkflowInvocationResponse> {
  return client.requestJson<WorkflowInvocationResponse>({
    method: "PUT",
    path: "/v1/workflow-invocations/{invocation_id}",
    pathParams: { invocation_id: invocationId },
    body,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function getWorkflowInvocation(
  invocationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
  options: WorkflowRequestOptions = {},
): Promise<ManagedWorkflowInvocationResponse> {
  return client.requestJson<ManagedWorkflowInvocationResponse>({
    method: "GET",
    path: "/v1/workflow-invocations/{invocation_id}",
    pathParams: { invocation_id: invocationId },
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function deliverWorkflowInvocation(
  invocationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
  options: WorkflowRequestOptions = {},
): Promise<ManagedWorkflowInvocationResponse> {
  return client.requestJson<ManagedWorkflowInvocationResponse>({
    method: "POST",
    path: "/v1/workflow-invocations/{invocation_id}/deliver",
    pathParams: { invocation_id: invocationId },
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function cancelWorkflowInvocation(
  invocationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
  options: WorkflowRequestOptions = {},
): Promise<ManagedWorkflowInvocationResponse> {
  return client.requestJson<ManagedWorkflowInvocationResponse>({
    method: "POST",
    path: "/v1/workflow-invocations/{invocation_id}/cancel",
    pathParams: { invocation_id: invocationId },
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function listWorkflowInvocationHistory(
  workflowDefinitionId: string,
  cursor?: string,
  client: ProliferateCloudClient = getProliferateClient(),
  options: WorkflowRequestOptions = {},
): Promise<ManagedWorkflowHistoryResponse> {
  return client.requestJson<ManagedWorkflowHistoryResponse>({
    method: "GET",
    path: "/v1/workflow-invocations",
    query: {
      workflowDefinitionId,
      ...(cursor === undefined ? {} : { cursor }),
    },
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function createWorkflowDefinition(
  body: WorkflowDefinitionCreateRequest,
  client: ProliferateCloudClient = getProliferateClient(),
  options: WorkflowRequestOptions = {},
): Promise<WorkflowDefinitionResponse> {
  return client.requestJson<WorkflowDefinitionResponse>({
    method: "POST",
    path: "/v1/workflows",
    body,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function updateWorkflowDefinition(
  workflowDefinitionId: string,
  body: WorkflowDefinitionUpdateRequest,
  client: ProliferateCloudClient = getProliferateClient(),
  options: WorkflowRequestOptions = {},
): Promise<WorkflowDefinitionResponse> {
  return client.requestJson<WorkflowDefinitionResponse>({
    method: "PUT",
    path: "/v1/workflows/{workflow_definition_id}",
    pathParams: { workflow_definition_id: workflowDefinitionId },
    body,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function deleteWorkflowDefinition(
  workflowDefinitionId: string,
  expectedRevision: number,
  client: ProliferateCloudClient = getProliferateClient(),
  options: WorkflowRequestOptions = {},
): Promise<void> {
  await client.requestJson<void>({
    method: "DELETE",
    path: "/v1/workflows/{workflow_definition_id}",
    pathParams: { workflow_definition_id: workflowDefinitionId },
    query: { expectedRevision },
    ...(options.signal ? { signal: options.signal } : {}),
  });
}
