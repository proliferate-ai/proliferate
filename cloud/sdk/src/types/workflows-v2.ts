// Workflows gen-2 (schema_version 2) wire types, hand-authored on the frozen
// Workflows ADR contract. The server half lands in the gen-2 ladder's PR2;
// once that PR is in this chain's base, `make cloud-openapi` +
// `make cloud-client-generate` regenerate the canonical schemas and this file
// is reconciled against them (restack task — drift is a finding, not silently
// absorbed).

export type WorkflowNodeTypeV2 = "agent" | "human_in_loop";

export interface WorkflowNodeModelV2 {
  agentKind: string;
  modelId?: string;
  modeId?: string;
}

export interface WorkflowNodeV2 {
  id: string;
  type: WorkflowNodeTypeV2;
  title: string;
  prompt: string;
  model?: WorkflowNodeModelV2;
}

export interface WorkflowEdgeV2 {
  from: string;
  to: string;
}

export interface WorkflowInputV2 {
  name: string;
  description?: string;
  required: boolean;
}

export interface WorkflowDocTemplateV2 {
  slug: string;
  producingNodeId: string;
  body: string;
}

export interface WorkflowDefinitionV2 {
  schemaVersion: 2;
  nodes: WorkflowNodeV2[];
  edges: WorkflowEdgeV2[];
  inputs: WorkflowInputV2[];
  docTemplates: WorkflowDocTemplateV2[];
}

export type WorkflowArgumentsV2 = Record<string, string | number | boolean>;

export type WorkflowPlacementModeV2 = "worktree" | "repo_root";

export interface WorkflowPlacementV2 {
  repoConfigId: string;
  mode: WorkflowPlacementModeV2;
}

/** Body of PUT /v1/workflow-invocations/{id} under schema_version 2. */
export interface WorkflowInvocationCreateRequestV2 {
  schemaVersion: 2;
  workflowDefinitionId: string;
  arguments: WorkflowArgumentsV2;
  placement: WorkflowPlacementV2;
}

/**
 * The frozen invocation record CP returns; `invocationJson` is byte-for-byte
 * what the trigger courier hands the runtime's PUT /v1/workflow-runs/{run_id}.
 */
export interface WorkflowInvocationJsonV2 {
  schemaVersion: 2;
  workflowDefinitionId: string;
  definition: WorkflowDefinitionV2;
  arguments: WorkflowArgumentsV2;
  placement: WorkflowPlacementV2;
}

export interface WorkflowInvocationV2 {
  id: string;
  workflowDefinitionId: string;
  invocationJson: WorkflowInvocationJsonV2;
  createdAt: string;
}

/** Definition-record envelope for v2 rows served by the existing CRUD routes. */
export interface WorkflowDefinitionRecordV2 {
  id: string;
  title: string;
  description?: string | null;
  defaultRepoConfigId?: string | null;
  definitionJson: WorkflowDefinitionV2;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
