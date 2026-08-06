import {
  useWorkflowRun,
  useWorkflowRunActions,
  useWorkflowRunEligibility,
  useWorkflowRunHistory,
} from "@proliferate/cloud-sdk-react";

export function useWorkflowRunLaunchAccess(
  workflowDefinitionId: string,
  definitionRevision: number,
  authCacheScope: string,
) {
  return {
    eligibility: useWorkflowRunEligibility(
      workflowDefinitionId,
      definitionRevision,
      authCacheScope,
    ),
    history: useWorkflowRunHistory(workflowDefinitionId, authCacheScope),
    actions: useWorkflowRunActions(authCacheScope),
  };
}

export function useWorkflowRunDetailAccess(
  workflowDefinitionId: string,
  runId: string,
  authCacheScope: string,
  enabled: boolean,
) {
  return {
    query: useWorkflowRun(
      workflowDefinitionId,
      runId,
      authCacheScope,
      enabled,
    ),
    actions: useWorkflowRunActions(authCacheScope),
  };
}
