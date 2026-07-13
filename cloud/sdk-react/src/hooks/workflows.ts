import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createWorkflowDefinition,
  deleteWorkflowDefinition,
  getWorkflowDefinition,
  listWorkflowDefinitions,
  updateWorkflowDefinition,
  type WorkflowDefinitionCreateRequest,
  type WorkflowDefinitionListResponse,
  type WorkflowDefinitionResponse,
  type WorkflowDefinitionUpdateRequest,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  workflowDefinitionDetailKey,
  workflowDefinitionsListKey,
  workflowDefinitionsRootKey,
} from "../lib/query-keys.js";

export function useWorkflowDefinitions(authCacheScope: string, enabled = true) {
  const client = useCloudClient();
  return useQuery<WorkflowDefinitionListResponse>({
    queryKey: workflowDefinitionsListKey(client.baseUrl, authCacheScope),
    queryFn: () => listWorkflowDefinitions(client),
    enabled,
  });
}

export function useWorkflowDefinition(
  workflowDefinitionId: string | null,
  authCacheScope: string,
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery<WorkflowDefinitionResponse>({
    queryKey: workflowDefinitionDetailKey(
      client.baseUrl,
      authCacheScope,
      workflowDefinitionId,
    ),
    queryFn: () => getWorkflowDefinition(workflowDefinitionId!, client),
    enabled: enabled && workflowDefinitionId !== null,
  });
}

export function useWorkflowDefinitionActions(authCacheScope: string) {
  const client = useCloudClient();
  const queryClient = useQueryClient();

  // The root key is a prefix of both the list and detail keys, so one
  // invalidation covers every workflow-definition query in this scope.
  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: workflowDefinitionsRootKey(client.baseUrl, authCacheScope),
    });
  };

  const createMutation = useMutation<
    WorkflowDefinitionResponse,
    Error,
    WorkflowDefinitionCreateRequest
  >({
    mutationFn: (body) => createWorkflowDefinition(body, client),
    onSuccess: () => refresh(),
  });

  const updateMutation = useMutation<
    WorkflowDefinitionResponse,
    Error,
    { workflowDefinitionId: string; body: WorkflowDefinitionUpdateRequest }
  >({
    mutationFn: ({ workflowDefinitionId, body }) =>
      updateWorkflowDefinition(workflowDefinitionId, body, client),
    onSuccess: () => refresh(),
  });

  const deleteMutation = useMutation<
    void,
    Error,
    { workflowDefinitionId: string; expectedRevision: number }
  >({
    mutationFn: ({ workflowDefinitionId, expectedRevision }) =>
      deleteWorkflowDefinition(workflowDefinitionId, expectedRevision, client),
    onSuccess: async (_, { workflowDefinitionId }) => {
      queryClient.removeQueries({
        queryKey: workflowDefinitionDetailKey(
          client.baseUrl,
          authCacheScope,
          workflowDefinitionId,
        ),
      });
      await refresh();
    },
  });

  return {
    createWorkflowDefinition: createMutation.mutateAsync,
    creatingWorkflowDefinition: createMutation.isPending,
    updateWorkflowDefinition: updateMutation.mutateAsync,
    updatingWorkflowDefinition: updateMutation.isPending,
    deleteWorkflowDefinition: deleteMutation.mutateAsync,
    deletingWorkflowDefinition: deleteMutation.isPending,
  };
}
