import type {
  WorkflowDefinitionRecordV2,
  WorkflowDefinitionV2,
  WorkflowInvocationCreateRequestV2,
  WorkflowInvocationV2,
} from "../types/index.js";
import { getProliferateClient, type ProliferateCloudClient } from "./core.js";

export interface WorkflowV2RequestOptions {
  signal?: AbortSignal;
}

/**
 * Type guard for a schema_version-2 definition payload. The list row's
 * `definition` is typed loosely (`unknown`), so narrow with this before
 * reading the document fields (nodes/edges/inputs/docTemplates). Since the
 * gen-1 lane was deleted the server only emits schema_version-2 rows; the
 * guard remains the honest way to cross the loose type.
 */
export function isWorkflowDefinitionV2(
  definitionJson: unknown,
): definitionJson is WorkflowDefinitionV2 {
  return (
    typeof definitionJson === "object" &&
    definitionJson !== null &&
    (definitionJson as { schemaVersion?: unknown }).schemaVersion === 2
  );
}

/**
 * A definition row from the list route (all rows are schema_version 2 since
 * the gen-1 lane was deleted). `definition` is typed loosely and
 * `schemaVersion` sits on the row itself (per the server's
 * WorkflowDefinitionResponseV2); narrow `definition` with
 * `isWorkflowDefinitionV2` before reading document fields.
 */
export interface WorkflowDefinitionListRowV2 {
  id: string;
  title: string;
  description?: string | null;
  defaultRepoConfigId?: string | null;
  schemaVersion?: number;
  definition?: unknown;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowDefinitionListResponseV2 {
  workflows: WorkflowDefinitionListRowV2[];
}

/**
 * Hand-authored request envelopes, reconciled field-for-field against the
 * generated `WorkflowDefinitionCreateRequestV2`/`UpdateRequestV2` schemas in
 * `generated/openapi.ts` (which are v2-only since the gen-1 lane was
 * deleted). Swapping these for the generated shapes is a deliberate
 * follow-up refactor of the gen-2 SDK, kept out of the deletion PR.
 */
export interface WorkflowDefinitionCreateRequestV2 {
  title: string;
  /** Required on the wire; the server defaults it to the empty string. */
  description: string;
  defaultRepoConfigId?: string | null;
  definition: WorkflowDefinitionV2;
}

export interface WorkflowDefinitionUpdateRequestV2 {
  title: string;
  /** Required on the wire; the server defaults it to the empty string. */
  description: string;
  defaultRepoConfigId?: string | null;
  definition: WorkflowDefinitionV2;
  expectedRevision: number;
}

export async function listWorkflowDefinitionsV2(
  client: ProliferateCloudClient = getProliferateClient(),
  options: WorkflowV2RequestOptions = {},
): Promise<WorkflowDefinitionListResponseV2> {
  return client.requestJson<WorkflowDefinitionListResponseV2>({
    method: "GET",
    path: "/v1/workflows",
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function getWorkflowDefinitionV2(
  workflowDefinitionId: string,
  client: ProliferateCloudClient = getProliferateClient(),
  options: WorkflowV2RequestOptions = {},
): Promise<WorkflowDefinitionRecordV2> {
  return client.requestJson<WorkflowDefinitionRecordV2>({
    method: "GET",
    path: "/v1/workflows/{workflow_definition_id}",
    pathParams: { workflow_definition_id: workflowDefinitionId },
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function createWorkflowDefinitionV2(
  body: WorkflowDefinitionCreateRequestV2,
  client: ProliferateCloudClient = getProliferateClient(),
  options: WorkflowV2RequestOptions = {},
): Promise<WorkflowDefinitionRecordV2> {
  return client.requestJson<WorkflowDefinitionRecordV2>({
    method: "POST",
    path: "/v1/workflows",
    body,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function updateWorkflowDefinitionV2(
  workflowDefinitionId: string,
  body: WorkflowDefinitionUpdateRequestV2,
  client: ProliferateCloudClient = getProliferateClient(),
  options: WorkflowV2RequestOptions = {},
): Promise<WorkflowDefinitionRecordV2> {
  return client.requestJson<WorkflowDefinitionRecordV2>({
    method: "PUT",
    path: "/v1/workflows/{workflow_definition_id}",
    pathParams: { workflow_definition_id: workflowDefinitionId },
    body,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function deleteWorkflowDefinitionV2(
  workflowDefinitionId: string,
  expectedRevision: number,
  client: ProliferateCloudClient = getProliferateClient(),
  options: WorkflowV2RequestOptions = {},
): Promise<void> {
  await client.requestJson<void>({
    method: "DELETE",
    path: "/v1/workflows/{workflow_definition_id}",
    pathParams: { workflow_definition_id: workflowDefinitionId },
    query: { expectedRevision },
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function putWorkflowInvocationV2(
  invocationId: string,
  body: WorkflowInvocationCreateRequestV2,
  client: ProliferateCloudClient = getProliferateClient(),
  options: WorkflowV2RequestOptions = {},
): Promise<WorkflowInvocationV2> {
  return client.requestJson<WorkflowInvocationV2>({
    method: "PUT",
    path: "/v1/workflow-invocations/{invocation_id}",
    pathParams: { invocation_id: invocationId },
    body,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function getWorkflowInvocationV2(
  invocationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
  options: WorkflowV2RequestOptions = {},
): Promise<WorkflowInvocationV2> {
  return client.requestJson<WorkflowInvocationV2>({
    method: "GET",
    path: "/v1/workflow-invocations/{invocation_id}",
    pathParams: { invocation_id: invocationId },
    ...(options.signal ? { signal: options.signal } : {}),
  });
}
