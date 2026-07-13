import type { Schema } from "./schema.js";

export type WorkflowInputDefinition = Schema<"WorkflowInputDefinition">;
export type WorkflowGoalDefinition = Schema<"WorkflowGoalDefinition">;
export type WorkflowPromptStep = Schema<"WorkflowPromptStep">;
export type WorkflowHarnessConfig = Schema<"WorkflowHarnessConfig">;
export type WorkflowStageDefinition = Schema<"WorkflowStageDefinition">;

type GeneratedWorkflowDefinitionCreateRequest = Schema<"WorkflowDefinitionCreateRequest">;
type GeneratedWorkflowDefinitionUpdateRequest = Schema<"WorkflowDefinitionUpdateRequest">;
type GeneratedWorkflowDefinitionResponse = Schema<"WorkflowDefinitionResponse">;
type GeneratedWorkflowDefinitionListResponse = Schema<"WorkflowDefinitionListResponse">;

export type WorkflowDefinitionCreateRequest =
  Omit<GeneratedWorkflowDefinitionCreateRequest, "description">
  & { description?: string };

export type WorkflowDefinitionUpdateRequest =
  Omit<GeneratedWorkflowDefinitionUpdateRequest, "description">
  & { description?: string };

export type WorkflowDefinitionResponse =
  Omit<GeneratedWorkflowDefinitionResponse, "inputs">
  & { inputs: WorkflowInputDefinition[] };

export type WorkflowDefinitionListResponse =
  Omit<GeneratedWorkflowDefinitionListResponse, "workflows">
  & { workflows: WorkflowDefinitionResponse[] };
