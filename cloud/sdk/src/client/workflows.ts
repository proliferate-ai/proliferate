import type {
  WorkflowDefinitionCreateRequest,
  WorkflowDefinitionListResponse,
  WorkflowDefinitionResponse,
  WorkflowDefinitionUpdateRequest,
} from "../types/index.js";
import { getProliferateClient, type ProliferateCloudClient } from "./core.js";

export async function listWorkflowDefinitions(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<WorkflowDefinitionListResponse> {
  return client.requestJson<WorkflowDefinitionListResponse>({
    method: "GET",
    path: "/v1/workflows",
  });
}

export async function getWorkflowDefinition(
  workflowDefinitionId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<WorkflowDefinitionResponse> {
  return client.requestJson<WorkflowDefinitionResponse>({
    method: "GET",
    path: "/v1/workflows/{workflow_definition_id}",
    pathParams: { workflow_definition_id: workflowDefinitionId },
  });
}

export async function createWorkflowDefinition(
  body: WorkflowDefinitionCreateRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<WorkflowDefinitionResponse> {
  return client.requestJson<WorkflowDefinitionResponse>({
    method: "POST",
    path: "/v1/workflows",
    body,
  });
}

export async function updateWorkflowDefinition(
  workflowDefinitionId: string,
  body: WorkflowDefinitionUpdateRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<WorkflowDefinitionResponse> {
  return client.requestJson<WorkflowDefinitionResponse>({
    method: "PUT",
    path: "/v1/workflows/{workflow_definition_id}",
    pathParams: { workflow_definition_id: workflowDefinitionId },
    body,
  });
}

export async function deleteWorkflowDefinition(
  workflowDefinitionId: string,
  expectedRevision: number,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<void> {
  await client.requestJson<void>({
    method: "DELETE",
    path: "/v1/workflows/{workflow_definition_id}",
    pathParams: { workflow_definition_id: workflowDefinitionId },
    query: { expectedRevision },
  });
}
