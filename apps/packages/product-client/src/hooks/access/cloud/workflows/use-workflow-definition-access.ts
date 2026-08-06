import {
  useCloudAgentCatalog,
  useRepositories,
  useWorkflowDefinition,
  useWorkflowDefinitionActions,
  useWorkflowDefinitions,
} from "@proliferate/cloud-sdk-react";

export function useWorkflowDefinitionsAccess(
  authCacheScope: string,
  enabled: boolean,
) {
  return useWorkflowDefinitions(authCacheScope, enabled);
}

export function useWorkflowDefinitionAccess(
  workflowDefinitionId: string,
  authCacheScope: string,
) {
  return useWorkflowDefinition(workflowDefinitionId, authCacheScope);
}

export function useWorkflowAuthoringResourcesAccess(authCacheScope: string) {
  return {
    catalogQuery: useCloudAgentCatalog(),
    repositoriesQuery: useRepositories(true, authCacheScope),
  };
}

export function useWorkflowDefinitionMutationsAccess(authCacheScope: string) {
  return useWorkflowDefinitionActions(authCacheScope);
}
