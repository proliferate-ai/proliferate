// Workflows gen-2 (schema_version 2) wire types, hand-authored on the frozen
// Workflows ADR contract and reconciled field-for-field against PR2's
// regenerated openapi.ts (origin/codex/workflows-gen2-pr2-server-v2:
// WorkflowDefinitionDocumentV2 / WorkflowDefinitionResponseV2 /
// WorkflowInvocationResponseV2 / WorkflowNodeModelConfigV2). Once PR2 is in
// this chain's base, `make cloud-openapi` + `make cloud-client-generate`
// regenerate the canonical schemas and this file is replaced by them (restack
// task — any remaining drift is a finding, not silently absorbed).

export type WorkflowNodeTypeV2 = "agent" | "human_in_loop";

export interface WorkflowNodeModelV2 {
  agentKind: string;
  modelId?: string | null;
  modeId?: string | null;
}

/** One parallel leg's authored prompt (ruling F5). */
export interface WorkflowNodeLegV2 {
  prompt: string;
}

export interface WorkflowNodeV2 {
  id: string;
  type: WorkflowNodeTypeV2;
  title: string;
  prompt: string;
  model?: WorkflowNodeModelV2 | null;
  /**
   * Parallel legs (ruling F5). Present only with 2..8 entries; `prompt` always
   * equals `legs[0].prompt` (leg 0 is the representative session). Absent =
   * a single-leg node, today's behavior exactly.
   */
  legs?: WorkflowNodeLegV2[];
}

export interface WorkflowEdgeV2 {
  from: string;
  to: string;
}

export interface WorkflowInputV2 {
  name: string;
  /** Required on the wire; the server defaults it to the empty string. */
  description: string;
  required: boolean;
}

export interface WorkflowDocTemplateV2 {
  slug: string;
  producingNodeId: string;
  body: string;
}

/**
 * `edges` is REQUIRED, unlike `inputs`/`docTemplates`: the frozen definition
 * travels verbatim into the runtime's PUT body, where `WorkflowDefinition`
 * (definition.rs) declares `edges` with no `serde(default)` under
 * `deny_unknown_fields` — a definition without the key is undeliverable. CP
 * tolerates an omitted `edges` on writes and normalizes it to `[]`, and every
 * CP response carries the key, so requiring it here only forbids authoring a
 * document the runtime would reject.
 */
export interface WorkflowDefinitionV2 {
  schemaVersion: 2;
  nodes: WorkflowNodeV2[];
  edges: WorkflowEdgeV2[];
  inputs?: WorkflowInputV2[];
  docTemplates?: WorkflowDocTemplateV2[];
}

export type WorkflowArgumentsV2 = Record<string, string | number | boolean>;

export type WorkflowPlacementModeV2 = "worktree" | "repo_root" | "existing_workspace";

export interface WorkflowPlacementV2 {
  repoConfigId: string;
  mode: WorkflowPlacementModeV2;
  /** Required iff mode is "existing_workspace": the adopted workspace (F-A1). */
  workspaceId?: string;
}

/** Body of PUT /v1/workflow-invocations/{id} under schema_version 2. */
export interface WorkflowInvocationCreateRequestV2 {
  schemaVersion: 2;
  workflowDefinitionId: string;
  arguments: WorkflowArgumentsV2;
  placement: WorkflowPlacementV2;
}

/**
 * The frozen invocation record CP returns — FLAT, per PR2's
 * WorkflowInvocationResponseV2; there is no `invocationJson` wrapper on the
 * wire. The trigger courier assembles the runtime's
 * PUT /v1/workflow-runs/{run_id} body from these fields.
 */
export interface WorkflowInvocationV2 {
  id: string;
  schemaVersion: 2;
  workflowDefinitionId: string;
  definitionRevision: number;
  title: string;
  description: string;
  definition: WorkflowDefinitionV2;
  arguments: WorkflowArgumentsV2;
  placement: WorkflowPlacementV2;
  createdAt: string;
}

/**
 * Definition-record envelope for v2 rows served by the existing CRUD routes
 * (PR2's WorkflowDefinitionResponseV2).
 */
export interface WorkflowDefinitionRecordV2 {
  id: string;
  userId: string;
  title: string;
  description: string;
  schemaVersion: 2;
  revision: number;
  defaultRepoConfigId: string | null;
  definition: WorkflowDefinitionV2;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
