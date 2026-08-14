import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createWorkflowDefinitionV2,
  deleteWorkflowDefinitionV2,
  getWorkflowDefinitionV2,
  putWorkflowInvocationV2,
  listWorkflowDefinitionsV2,
  updateWorkflowDefinitionV2,
  type WorkflowDefinitionCreateRequestV2,
  type WorkflowDefinitionListResponseV2,
  type WorkflowDefinitionRecordV2,
  type WorkflowDefinitionUpdateRequestV2,
  type WorkflowInvocationCreateRequestV2,
  type WorkflowInvocationV2,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  workflowDefinitionsV2ListKey,
  workflowDefinitionsV2RootKey,
  workflowDefinitionV2DetailKey,
  workflowInvocationV2Key,
} from "../lib/query-keys.js";

export function useWorkflowDefinitionsV2Query(authCacheScope = "default", enabled = true) {
  const client = useCloudClient();
  return useQuery<WorkflowDefinitionListResponseV2>({
    queryKey: workflowDefinitionsV2ListKey(client.baseUrl, authCacheScope),
    queryFn: ({ signal }) => listWorkflowDefinitionsV2(client, { signal }),
    enabled,
  });
}

export function useWorkflowDefinitionV2Query(
  definitionId: string | null,
  authCacheScope = "default",
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery<WorkflowDefinitionRecordV2>({
    queryKey: workflowDefinitionV2DetailKey(client.baseUrl, authCacheScope, definitionId),
    queryFn: ({ signal }) => getWorkflowDefinitionV2(definitionId!, client, { signal }),
    enabled: enabled && definitionId !== null,
  });
}

export function useWorkflowDefinitionV2Actions(authCacheScope = "default") {
  const client = useCloudClient();
  const queryClient = useQueryClient();

  // The root key is a prefix of both the list and detail keys, so one
  // invalidation covers every v2 workflow-definition query in this scope.
  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: workflowDefinitionsV2RootKey(client.baseUrl, authCacheScope),
    });
  };

  const createMutation = useMutation<
    WorkflowDefinitionRecordV2,
    Error,
    WorkflowDefinitionCreateRequestV2
  >({
    mutationFn: (body) => createWorkflowDefinitionV2(body, client),
    onSuccess: () => refresh(),
  });

  const updateMutation = useMutation<
    WorkflowDefinitionRecordV2,
    Error,
    { workflowDefinitionId: string; body: WorkflowDefinitionUpdateRequestV2 }
  >({
    mutationFn: ({ workflowDefinitionId, body }) =>
      updateWorkflowDefinitionV2(workflowDefinitionId, body, client),
    onSuccess: () => refresh(),
  });

  const deleteMutation = useMutation<
    void,
    Error,
    { workflowDefinitionId: string; expectedRevision: number }
  >({
    mutationFn: ({ workflowDefinitionId, expectedRevision }) =>
      deleteWorkflowDefinitionV2(workflowDefinitionId, expectedRevision, client),
    onSuccess: async (_, { workflowDefinitionId }) => {
      queryClient.removeQueries({
        queryKey: workflowDefinitionV2DetailKey(
          client.baseUrl,
          authCacheScope,
          workflowDefinitionId,
        ),
      });
      await refresh();
    },
  });

  return {
    createWorkflowDefinitionV2: createMutation.mutateAsync,
    creatingWorkflowDefinitionV2: createMutation.isPending,
    updateWorkflowDefinitionV2: updateMutation.mutateAsync,
    updatingWorkflowDefinitionV2: updateMutation.isPending,
    deleteWorkflowDefinitionV2: deleteMutation.mutateAsync,
    deletingWorkflowDefinitionV2: deleteMutation.isPending,
  };
}

export function useWorkflowInvocationV2Actions(authCacheScope = "default") {
  const client = useCloudClient();
  const queryClient = useQueryClient();

  // Gen-2 has no polling hook here: the runtime plane (not the control
  // plane) owns run state once the invocation is placed, so there is no
  // equivalent of gen-1's checkWorkflowInvocation/deliverWorkflowInvocation.
  const putMutation = useMutation<
    WorkflowInvocationV2,
    Error,
    { invocationId: string; body: WorkflowInvocationCreateRequestV2; signal?: AbortSignal }
  >({
    mutationFn: ({ invocationId, body, signal }) =>
      putWorkflowInvocationV2(invocationId, body, client, { signal }),
    onSuccess: (invocation) => {
      queryClient.setQueryData(
        workflowInvocationV2Key(client.baseUrl, authCacheScope, invocation.id),
        invocation,
      );
    },
  });

  return {
    putWorkflowInvocationV2: putMutation.mutateAsync,
    puttingWorkflowInvocationV2: putMutation.isPending,
  };
}
