import type { components } from "../generated/openapi.js";

/**
 * Owned type surface for the local AnyHarness Workflow-run resource.
 *
 * These are thin re-exports of the generated OpenAPI contract; the resource
 * client never hand-defines request/response shapes. The versioned request and
 * response unions carry both the schema-v1 (`managedCloud`) and schema-v2
 * (portable / connected-Desktop) families, so a single typed resource serves
 * both delivery targets.
 */

export type VersionedPutWorkflowRunRequest =
  components["schemas"]["VersionedPutWorkflowRunRequest"];
export type PutWorkflowRunRequest = components["schemas"]["PutWorkflowRunRequest"];
export type PutWorkflowRunRequestV2 = components["schemas"]["PutWorkflowRunRequestV2"];

export type VersionedWorkflowRunResponse =
  components["schemas"]["VersionedWorkflowRunResponse"];
export type WorkflowRunResponse = components["schemas"]["WorkflowRunResponse"];
export type WorkflowRunResponseV2 = components["schemas"]["WorkflowRunResponseV2"];

export type WorkflowRun = components["schemas"]["WorkflowRun"];
export type WorkflowRunV2 = components["schemas"]["WorkflowRunV2"];
export type WorkflowRunStep = components["schemas"]["WorkflowRunStep"];
export type WorkflowRunStepV2 = components["schemas"]["WorkflowRunStepV2"];
export type WorkflowRunStatus = components["schemas"]["WorkflowRunStatus"];
export type WorkflowRunStepStatus = components["schemas"]["WorkflowRunStepStatus"];
export type WorkflowRunFailureCode = components["schemas"]["WorkflowRunFailureCode"];
export type WorkflowRunFailureCodeV2 =
  components["schemas"]["WorkflowRunFailureCodeV2"];
export type WorkflowRunInterruptionCode =
  components["schemas"]["WorkflowRunInterruptionCode"];
export type WorkflowRunModelSelection =
  components["schemas"]["WorkflowRunModelSelection"];
