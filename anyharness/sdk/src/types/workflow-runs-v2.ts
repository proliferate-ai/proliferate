// Workflows gen-2 runtime-plane types, hand-authored on the frozen Workflows
// ADR contract (camelCase mirror of the runtime's SQLite rows) and reconciled
// against PR5a's regenerated OpenAPI types (src/generated/openapi.ts). The
// generated view schemas mark nullable fields optional (`?: string | null`);
// that is utoipa's rendering of Option, not the wire: the runtime serializes
// None as explicit `null` by ruling (projection.rs), so the required `| null`
// declarations here are the accurate contract.

// @anyharness/sdk is dependency-free, so the invocation-json shapes shared
// with the cloud plane are declared here structurally rather than imported
// from @proliferate/cloud-sdk; TypeScript's structural typing keeps the two
// declarations assignable, and the contract fixtures keep them in lockstep.

export type WorkflowNodeTypeV2 = "agent" | "human_in_loop";

export interface WorkflowNodeModelV2 {
  agentKind: string;
  modelId?: string | null;
  modeId?: string | null;
}

export interface WorkflowSnapshotNodeV2 {
  id: string;
  type: WorkflowNodeTypeV2;
  title: string;
  prompt: string;
  model?: WorkflowNodeModelV2 | null;
}

/**
 * `edges` is REQUIRED, unlike `inputs`/`docTemplates`: the runtime's
 * `WorkflowDefinition` (definition.rs) declares `edges` with no `serde(default)`
 * under `deny_unknown_fields`, so a body that omits it fails to deserialize and
 * the PUT is rejected — the regenerated schema agrees (`edges` required,
 * `inputs`/`docTemplates` optional). Control plane responses always carry the
 * key (its Pydantic field has `default_factory=list`), so nothing on the
 * courier path has to synthesize it.
 */
export interface WorkflowSnapshotDefinitionV2 {
  schemaVersion: 2;
  nodes: WorkflowSnapshotNodeV2[];
  edges: { from: string; to: string }[];
  inputs?: { name: string; description?: string; required: boolean }[];
  docTemplates?: { slug: string; producingNodeId: string; body: string }[];
}

export interface WorkflowInvocationJsonV2 {
  schemaVersion: 2;
  workflowDefinitionId: string;
  definition: WorkflowSnapshotDefinitionV2;
  arguments: Record<string, string | number | boolean>;
  placement: {
    repoConfigId: string;
    mode: "worktree" | "repo_root";
  };
}

export type WorkflowRunStatusV2 =
  | "running"
  | "awaiting_human"
  | "interrupted"
  | "completed"
  | "failed";

export type WorkflowRunNodeStatusV2 =
  | "pending"
  | "running"
  | "needs_attention"
  | "awaiting_human"
  | "completed"
  | "failed";

export type WorkflowRunNodeKindV2 = "defined" | "replacement" | "adhoc";

export interface WorkflowRunV2 {
  id: string;
  invocationId: string;
  definitionJson: string;
  argumentsJson: string;
  workspaceId: string;
  status: WorkflowRunStatusV2;
  currentNodeRowId: string | null;
  failureCode: string | null;
  interruptionCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface WorkflowRunNodeV2 {
  id: string;
  runId: string;
  definitionNodeId: string | null;
  kind: WorkflowRunNodeKindV2;
  nodeType: WorkflowNodeTypeV2;
  replacesNodeRowId: string | null;
  anchorNodeRowId: string | null;
  chainIndex: number | null;
  title: string;
  prompt: string;
  status: WorkflowRunNodeStatusV2;
  sessionId: string | null;
  promptId: string | null;
  failureCode: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface WorkflowRunDocV2 {
  id: string;
  runId: string;
  slug: string;
  filename: string;
  producingNodeRowId: string | null;
  seededFromTemplate: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * The full projection every read and every command returns:
 * GET /v1/workflow-runs/{run_id} and each POST command body's response.
 */
export interface WorkflowRunProjectionV2 {
  run: WorkflowRunV2;
  nodes: WorkflowRunNodeV2[];
  docs: WorkflowRunDocV2[];
}

/**
 * Body of PUT /v1/workflow-runs/{run_id}: the frozen invocation_json,
 * verbatim, plus the frozen invocation's own `id` — when present it lands on
 * the run row as `invocation_id`; when absent the runtime falls back to the
 * run id.
 */
export interface WorkflowRunPutRequestV2 extends WorkflowInvocationJsonV2 {
  id?: string;
}

export interface WorkflowRunFailRedoRequestV2 {
  prompt?: string;
}

export interface WorkflowRunFlipTypeRequestV2 {
  nodeType: WorkflowNodeTypeV2;
}

export interface WorkflowRunAddAdhocNodeRequestV2 {
  anchorNodeRowId: string;
  prompt: string;
  model?: WorkflowNodeModelV2;
}

/** Stable ProblemDetails codes the runtime's workflow routes emit. */
export type WorkflowRunProblemCodeV2 =
  | "WORKFLOW_RUN_NOT_FOUND"
  | "WORKFLOW_NODE_NOT_FOUND"
  | "WORKFLOW_TRANSITION_ILLEGAL"
  | "WORKFLOW_SNAPSHOT_INVALID"
  | "WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED";
