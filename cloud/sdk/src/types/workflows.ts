import type { Schema } from "./schema.js";

export type WorkflowInputDefinition = Schema<"WorkflowInputDefinition">;
export type WorkflowGoalDefinition = Schema<"WorkflowGoalDefinition">;
export type WorkflowPromptStep = Schema<"WorkflowPromptStep">;
export type WorkflowHarnessConfig = Schema<"WorkflowHarnessConfig">;
export type WorkflowStageDefinition = Schema<"WorkflowStageDefinition">;

type GeneratedWorkflowDefinitionCreateRequest = Schema<"WorkflowDefinitionCreateRequest">;
type GeneratedWorkflowDefinitionUpdateRequest = Schema<"WorkflowDefinitionUpdateRequest">;
type GeneratedWorkflowDefinitionResponse = Schema<"WorkflowDefinitionResponse">;
type GeneratedWorkflowDefinitionListResponse = Schema<"WorkflowDefinitionListAnyResponse">;

export type WorkflowDefinitionCreateRequest =
  Omit<GeneratedWorkflowDefinitionCreateRequest, "description">
  & { description?: string };

export type WorkflowDefinitionUpdateRequest =
  Omit<GeneratedWorkflowDefinitionUpdateRequest, "description">
  & { description?: string };

export type WorkflowDefinitionResponse =
  Omit<GeneratedWorkflowDefinitionResponse, "inputs">
  & { inputs: WorkflowInputDefinition[] };

export type WorkflowDefinitionResponseV2 = Schema<"WorkflowDefinitionResponseV2">;

// The shared, unflagged list/detail endpoints are polymorphic: gen-2 rows
// (schemaVersion 2, no stages) ride beside v1 rows the moment one exists.
export type WorkflowDefinitionAnyResponse =
  | WorkflowDefinitionResponse
  | WorkflowDefinitionResponseV2;

export type WorkflowDefinitionListResponse =
  Omit<GeneratedWorkflowDefinitionListResponse, "workflows">
  & { workflows: WorkflowDefinitionAnyResponse[] };

export type WorkflowRunEligibilityBlocker = Schema<"WorkflowRunEligibilityBlocker">;
export type WorkflowRunEligibilityResponse = Schema<"WorkflowRunEligibilityResponse">;
export type WorkflowInvocationCreateRequest = Schema<"WorkflowInvocationCreateRequest">;
export type WorkflowInvocationResponse = Schema<"WorkflowInvocationResponse">;
export type ManagedWorkflowExecutionStep = Schema<"ManagedWorkflowExecutionStep">;
export type ManagedWorkflowRuntimeExecution = Schema<"ManagedWorkflowRuntimeExecution">;
export type ManagedWorkflowFreshness = Schema<"ManagedWorkflowFreshness">;
export type ManagedWorkflowCorrelations = Schema<"ManagedWorkflowCorrelations">;
export type ManagedWorkflowOpenTarget = Schema<"ManagedWorkflowOpenTarget">;
export type ManagedWorkflowExecutionResponse = Schema<"ManagedWorkflowExecutionResponse">;
export type ManagedWorkflowInvocationResponse = Schema<"ManagedWorkflowInvocationResponse">;
export type ManagedWorkflowHistoryItem = Schema<"ManagedWorkflowHistoryItem">;
export type ManagedWorkflowHistoryResponse = Schema<"ManagedWorkflowHistoryResponse">;
export type PortableWorkflowDefinition = Schema<"PortableWorkflowDefinition">;
