// Workflows gen-2 runtime-plane types, hand-authored on the frozen Workflows
// ADR contract (camelCase mirror of the runtime's SQLite rows). The Rust
// routes land in the gen-2 ladder's PR5a; once that PR is in this chain's
// base, `make sdk-generate` regenerates the canonical OpenAPI types and this
// file is reconciled against them (restack task — drift is a finding, not
// silently absorbed).

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

export interface WorkflowSnapshotDefinitionV2 {
  schemaVersion: 2;
  nodes: WorkflowSnapshotNodeV2[];
  edges?: { from: string; to: string }[];
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

/** Body of PUT /v1/workflow-runs/{run_id}: the frozen invocation_json, verbatim. */
export type WorkflowRunPutRequestV2 = WorkflowInvocationJsonV2;

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
