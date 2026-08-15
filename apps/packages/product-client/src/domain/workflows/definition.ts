import type { WorkflowDefinitionAnyResponse } from "@proliferate/cloud-sdk";

/**
 * Gen-1 (schema_version 1) workflow definition wire shape, plus the small
 * surface still consumed after the gen-2 (nodes/edges) rewrite superseded
 * gen-1 authoring: turning a shared-endpoint response into a
 * `WorkflowDefinition` (null for gen-2 rows — they have no stages to map),
 * and classifying/messaging a write failure.
 *
 * Draft-authoring, catalog-option, and validation helpers that used to live
 * here were gen-1-only and have been removed now that the builder no longer
 * calls them; see `definition-v2.ts` for the gen-2 equivalents.
 */

type WorkflowInputType = "string" | "number" | "boolean";

interface WorkflowDefinitionInput {
  name: string;
  type: WorkflowInputType;
  required: boolean;
}

interface WorkflowGoal {
  objective: string;
}

interface WorkflowAgentPromptStep {
  kind: "agent.prompt";
  prompt: string;
  goal?: WorkflowGoal | null;
}

interface WorkflowHarnessConfig {
  agentKind: string;
  modelId?: string | null;
  effort?: string | null;
}

interface WorkflowDefinitionStage {
  harnessConfig: WorkflowHarnessConfig;
  steps: WorkflowAgentPromptStep[];
}

export interface WorkflowDefinition {
  id: string;
  userId: string;
  title: string;
  description: string;
  schemaVersion: 1;
  revision: number;
  validatedCatalogVersion: string;
  defaultRepoConfigId: string | null;
  inputs: WorkflowDefinitionInput[];
  stages: WorkflowDefinitionStage[];
  createdAt: string;
  updatedAt: string;
  deletedAt: null;
}

export function workflowDefinitionFromResponse(
  response: WorkflowDefinitionAnyResponse,
): WorkflowDefinition | null {
  if (response.schemaVersion !== 1) {
    // A gen-2 row has no stages to map; its UI arrives with the v2 surfaces.
    return null;
  }
  return {
    id: response.id,
    userId: response.userId,
    title: response.title,
    description: response.description,
    schemaVersion: 1,
    revision: response.revision,
    validatedCatalogVersion: response.validatedCatalogVersion,
    defaultRepoConfigId: response.defaultRepoConfigId,
    inputs: (response.inputs ?? []).map((input) => ({ ...input })),
    stages: response.stages.map((stage) => ({
      harnessConfig: { ...stage.harnessConfig },
      steps: stage.steps.map((step) => ({
        kind: "agent.prompt",
        prompt: step.prompt,
        goal: step.goal ? { objective: step.goal.objective } : null,
      })),
    })),
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
    deletedAt: null,
  };
}

export function isWorkflowRevisionConflict(error: unknown): boolean {
  return error instanceof Error && (error as { status?: unknown }).status === 409;
}

export function workflowWriteErrorMessage(error: unknown): string {
  if (isWorkflowRevisionConflict(error)) {
    return "This workflow changed in another window. Reload it and apply your changes again.";
  }
  return error instanceof Error ? error.message : "Workflow could not be saved.";
}
