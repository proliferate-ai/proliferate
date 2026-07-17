import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  cancelWorkflowInvocation,
  createWorkflowDefinition,
  deleteWorkflowDefinition,
  deliverWorkflowInvocation,
  getWorkflowDefinition,
  getWorkflowInvocation,
  getWorkflowRunEligibility,
  listWorkflowInvocationHistory,
  listWorkflowDefinitions,
  putWorkflowInvocation,
  updateWorkflowDefinition,
  type ManagedWorkflowHistoryResponse,
  type ManagedWorkflowHistoryItem,
  type ManagedWorkflowInvocationResponse,
  type WorkflowDefinitionCreateRequest,
  type WorkflowDefinitionListResponse,
  type WorkflowDefinitionResponse,
  type WorkflowDefinitionUpdateRequest,
  type WorkflowInvocationCreateRequest,
  type WorkflowInvocationResponse,
  type WorkflowRunEligibilityResponse,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  workflowDefinitionDetailKey,
  workflowDefinitionsListKey,
  workflowDefinitionsRootKey,
  workflowRunDetailKey,
  workflowRunEligibilityKey,
  workflowRunHistoryKey,
  workflowRunsRootKey,
} from "../lib/query-keys.js";

export const WORKFLOW_RUN_POLL_INTERVAL_MS = 3_000;

export function workflowRunNeedsPolling(run: ManagedWorkflowInvocationResponse | undefined): boolean {
  if (!run || run.managedExecution.freshness.status === "target_lost") return false;
  const execution = run.managedExecution.execution;
  if (execution?.cancelRequestedAt && !isTerminalExecution(execution.status)) return true;
  if (execution && isTerminalExecution(execution.status)) return false;
  return ![
    "delivery_failed",
    "delivery_cancelled",
  ].includes(run.managedExecution.deliveryStatus);
}

export function workflowRunRefetchInterval(
  run: ManagedWorkflowInvocationResponse | undefined,
): number | false {
  return workflowRunNeedsPolling(run) ? WORKFLOW_RUN_POLL_INTERVAL_MS : false;
}

function isTerminalExecution(status: string): boolean {
  return ["completed", "failed", "cancelled", "interrupted"].includes(status);
}

export function useWorkflowDefinitions(authCacheScope: string, enabled = true) {
  const client = useCloudClient();
  return useQuery<WorkflowDefinitionListResponse>({
    queryKey: workflowDefinitionsListKey(client.baseUrl, authCacheScope),
    queryFn: ({ signal }) => listWorkflowDefinitions(client, { signal }),
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
    queryFn: ({ signal }) => getWorkflowDefinition(workflowDefinitionId!, client, { signal }),
    enabled: enabled && workflowDefinitionId !== null,
  });
}

export function useWorkflowRunEligibility(
  workflowDefinitionId: string | null,
  definitionRevision: number | null,
  authCacheScope: string,
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery<WorkflowRunEligibilityResponse>({
    queryKey: workflowRunEligibilityKey(
      client.baseUrl,
      authCacheScope,
      workflowDefinitionId,
      definitionRevision,
    ),
    queryFn: ({ signal }) =>
      getWorkflowRunEligibility(workflowDefinitionId!, client, { signal }),
    enabled: enabled && workflowDefinitionId !== null && definitionRevision !== null,
  });
}

export function useWorkflowRun(
  workflowDefinitionId: string | null,
  invocationId: string | null,
  authCacheScope: string,
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery<ManagedWorkflowInvocationResponse>({
    queryKey: workflowRunDetailKey(
      client.baseUrl,
      authCacheScope,
      workflowDefinitionId,
      invocationId,
    ),
    queryFn: ({ signal }) => getWorkflowInvocation(invocationId!, client, { signal }),
    enabled: enabled && workflowDefinitionId !== null && invocationId !== null,
    refetchInterval: (query) => workflowRunRefetchInterval(query.state.data),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function useWorkflowRunHistory(
  workflowDefinitionId: string | null,
  authCacheScope: string,
  enabled = true,
) {
  const client = useCloudClient();
  return useInfiniteQuery<
    ManagedWorkflowHistoryResponse,
    Error,
    { pages: ManagedWorkflowHistoryResponse[]; pageParams: Array<string | undefined> },
    ReturnType<typeof workflowRunHistoryKey>,
    string | undefined
  >({
    queryKey: workflowRunHistoryKey(
      client.baseUrl,
      authCacheScope,
      workflowDefinitionId,
    ),
    queryFn: ({ pageParam, signal }) =>
      listWorkflowInvocationHistory(workflowDefinitionId!, pageParam, client, { signal }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: enabled && workflowDefinitionId !== null,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function useWorkflowRunActions(authCacheScope: string) {
  const client = useCloudClient();
  const queryClient = useQueryClient();

  const storeRun = async (run: ManagedWorkflowInvocationResponse) => {
    const historyKey = workflowRunHistoryKey(
      client.baseUrl,
      authCacheScope,
      run.workflowDefinitionId,
    );
    queryClient.setQueryData(
      workflowRunDetailKey(
        client.baseUrl,
        authCacheScope,
        run.workflowDefinitionId,
        run.id,
      ),
      run,
    );
    queryClient.setQueryData<InfiniteData<ManagedWorkflowHistoryResponse, string | undefined>>(
      historyKey,
      (current) => mergeWorkflowRunIntoHistory(current, run),
    );
    await queryClient.invalidateQueries({
      queryKey: historyKey,
    });
  };

  const createMutation = useMutation<
    WorkflowInvocationResponse,
    Error,
    { invocationId: string; body: WorkflowInvocationCreateRequest; signal?: AbortSignal }
  >({
    mutationFn: ({ invocationId, body, signal }) =>
      putWorkflowInvocation(invocationId, body, client, { signal }),
  });

  const deliverMutation = useMutation<
    ManagedWorkflowInvocationResponse,
    Error,
    { invocationId: string; signal?: AbortSignal }
  >({
    mutationFn: ({ invocationId, signal }) =>
      deliverWorkflowInvocation(invocationId, client, { signal }),
    onSuccess: storeRun,
  });

  const cancelMutation = useMutation<
    ManagedWorkflowInvocationResponse,
    Error,
    { invocationId: string; signal?: AbortSignal }
  >({
    mutationFn: ({ invocationId, signal }) =>
      cancelWorkflowInvocation(invocationId, client, { signal }),
    onSuccess: storeRun,
  });

  const checkMutation = useMutation<
    ManagedWorkflowInvocationResponse,
    Error,
    { invocationId: string; signal?: AbortSignal }
  >({
    mutationFn: ({ invocationId, signal }) =>
      getWorkflowInvocation(invocationId, client, { signal }),
    onSuccess: storeRun,
  });

  return {
    putWorkflowInvocation: createMutation.mutateAsync,
    puttingWorkflowInvocation: createMutation.isPending,
    deliverWorkflowInvocation: deliverMutation.mutateAsync,
    deliveringWorkflowInvocation: deliverMutation.isPending,
    cancelWorkflowInvocation: cancelMutation.mutateAsync,
    cancellingWorkflowInvocation: cancelMutation.isPending,
    checkWorkflowInvocation: checkMutation.mutateAsync,
    checkingWorkflowInvocation: checkMutation.isPending,
    invalidateWorkflowRuns: () => queryClient.invalidateQueries({
      queryKey: workflowRunsRootKey(client.baseUrl, authCacheScope),
    }),
  };
}

export function mergeWorkflowRunIntoHistory(
  current: InfiniteData<ManagedWorkflowHistoryResponse, string | undefined> | undefined,
  run: ManagedWorkflowInvocationResponse,
): InfiniteData<ManagedWorkflowHistoryResponse, string | undefined> | undefined {
  const item = workflowHistoryItemFromRun(run);
  if (!current || current.pages.length === 0) return current;

  let replaced = false;
  const pages = current.pages.map((page) => ({
    ...page,
    items: page.items.map((existing) => {
      if (existing.id !== item.id) return existing;
      replaced = true;
      return item;
    }),
  }));
  return replaced ? { ...current, pages } : current;
}

function workflowHistoryItemFromRun(
  run: ManagedWorkflowInvocationResponse,
): ManagedWorkflowHistoryItem {
  return {
    id: run.id,
    workflowDefinitionId: run.workflowDefinitionId,
    definitionRevision: run.definitionRevision,
    title: run.title,
    placementKind: run.placement.kind,
    targetKind: run.target.kind,
    deliveryStatus: run.managedExecution.deliveryStatus,
    desiredState: run.managedExecution.desiredState,
    executionStatus: run.managedExecution.execution?.status ?? null,
    freshness: run.managedExecution.freshness.status,
    latestObservedAt: run.managedExecution.freshness.latestObservedAt,
    cloudWorkspaceId: run.managedExecution.correlations.cloudWorkspaceId,
    sessionId: run.managedExecution.correlations.sessionId,
    createdAt: run.createdAt,
    updatedAt: run.managedExecution.updatedAt,
  };
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
