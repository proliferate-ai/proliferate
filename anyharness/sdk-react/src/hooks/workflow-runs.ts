import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AnyHarnessRequestOptions,
  WorkflowRunAddAdhocNodeRequestV2,
  WorkflowRunFailRedoRequestV2,
  WorkflowRunFlipTypeRequestV2,
  WorkflowRunProjectionV2,
  WorkflowRunPutRequestV2,
  WorkflowRunV2,
  WorkflowRunsListResponseV2,
} from "@anyharness/sdk";
import {
  resolveRuntimeCacheScopeKey,
  resolveRuntimeConnection,
  useAnyHarnessRuntimeContext,
} from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import { requestOptionsWithSignal } from "../lib/request-options.js";
import {
  anyHarnessWorkflowRunKey,
  anyHarnessWorkflowRunsListKey,
  anyHarnessWorkflowRunsListScopeKey,
} from "../lib/query-keys.js";

interface RuntimeQueryOptions {
  enabled?: boolean;
}

/** Runs actively progressing or waiting on a human decision; every other status is parked or terminal. */
const WORKFLOW_RUN_POLLING_STATUSES: ReadonlySet<WorkflowRunV2["status"]> = new Set([
  "running",
  "awaiting_human",
]);

export const WORKFLOW_RUN_ACTIVE_INTERVAL_MS = 3000;

/**
 * Polling cadence for `GET /v1/workflow-runs/{run_id}`. The run detail has no
 * push channel: the run view polls while the run is `running` (a node is
 * in-flight) or `awaiting_human` (a decision could land any moment from
 * another tab/device) and stops once the run parks (`interrupted`) or
 * finishes (`completed`/`failed`).
 */
export function resolveWorkflowRunRefetchInterval(
  state: { data?: WorkflowRunProjectionV2 },
): number | false {
  const status = state.data?.run.status;
  return status != null && WORKFLOW_RUN_POLLING_STATUSES.has(status)
    ? WORKFLOW_RUN_ACTIVE_INTERVAL_MS
    : false;
}

/** The run-detail projection for the run view: nodes, docs, and run header together. */
export function useWorkflowRunQuery(
  runId: string | null | undefined,
  options?: RuntimeQueryOptions,
) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);
  const trimmedRunId = runId?.trim() ?? "";

  return useQuery({
    queryKey: anyHarnessWorkflowRunKey(runtimeUrl, cacheScopeKey, trimmedRunId || null),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0 && trimmedRunId.length > 0,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.workflowRunsV2.getRun(
        trimmedRunId,
        requestOptionsWithSignal(undefined, signal),
      );
    },
    refetchInterval: (query) => resolveWorkflowRunRefetchInterval(query.state),
    refetchIntervalInBackground: false,
  });
}

/**
 * The run roster: the run view's workspace-scoped list, and the startup
 * resume popover's cross-workspace scan (workspace id omitted = every run
 * this runtime knows about).
 */
export function useWorkflowRunsQuery(
  workspaceId?: string | null,
  options?: RuntimeQueryOptions,
) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);
  const trimmedWorkspaceId = workspaceId?.trim() || undefined;

  return useQuery({
    queryKey: anyHarnessWorkflowRunsListKey(runtimeUrl, cacheScopeKey, trimmedWorkspaceId ?? null),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.workflowRunsV2.listRuns(
        trimmedWorkspaceId,
        requestOptionsWithSignal(undefined, signal),
      );
    },
  });
}

function patchRunInList(
  data: WorkflowRunsListResponseV2 | undefined,
  run: WorkflowRunV2,
): WorkflowRunsListResponseV2 | undefined {
  if (!data) {
    return data;
  }
  const index = data.runs.findIndex((candidate) => candidate.id === run.id);
  if (index === -1) {
    return data;
  }
  const runs = [...data.runs];
  runs[index] = run;
  return { ...data, runs };
}

/**
 * Every write on a workflow run's node/lifecycle machine — approve, fail-redo,
 * flip-type, undo-advance, resume, add-adhoc-node, and the initial put — turns
 * around the fresh full projection in its response. The contract those routes
 * share: commands never need a follow-up read. So every mutation here writes
 * its response straight into the run-detail cache with `setQueryData` (never
 * `invalidateQueries`), and patches the matching row in any cached runs list.
 */
export function useWorkflowRunMutations(runId: string) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);
  const queryClient = useQueryClient();

  const writeProjection = (projection: WorkflowRunProjectionV2) => {
    queryClient.setQueryData(
      anyHarnessWorkflowRunKey(runtimeUrl, cacheScopeKey, runId),
      projection,
    );
    queryClient.setQueriesData<WorkflowRunsListResponseV2>(
      { queryKey: anyHarnessWorkflowRunsListScopeKey(runtimeUrl, cacheScopeKey) },
      (data) => patchRunInList(data, projection.run),
    );
  };

  const putRun = useMutation({
    mutationFn: async (input: {
      request: WorkflowRunPutRequestV2;
      requestOptions?: AnyHarnessRequestOptions;
    }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.workflowRunsV2.putRun(runId, input.request, input.requestOptions);
    },
    onSuccess: writeProjection,
  });

  const approve = useMutation({
    mutationFn: async (input: {
      nodeRowId: string;
      requestOptions?: AnyHarnessRequestOptions;
    }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.workflowRunsV2.approve(runId, input.nodeRowId, input.requestOptions);
    },
    onSuccess: writeProjection,
  });

  const failRedo = useMutation({
    mutationFn: async (input: {
      nodeRowId: string;
      request: WorkflowRunFailRedoRequestV2;
      requestOptions?: AnyHarnessRequestOptions;
    }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.workflowRunsV2.failRedo(
        runId,
        input.nodeRowId,
        input.request,
        input.requestOptions,
      );
    },
    onSuccess: writeProjection,
  });

  const flipType = useMutation({
    mutationFn: async (input: {
      nodeRowId: string;
      request: WorkflowRunFlipTypeRequestV2;
      requestOptions?: AnyHarnessRequestOptions;
    }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.workflowRunsV2.flipType(
        runId,
        input.nodeRowId,
        input.request,
        input.requestOptions,
      );
    },
    onSuccess: writeProjection,
  });

  const undoAdvance = useMutation({
    mutationFn: async (input?: { requestOptions?: AnyHarnessRequestOptions }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.workflowRunsV2.undoAdvance(runId, input?.requestOptions);
    },
    onSuccess: writeProjection,
  });

  const resume = useMutation({
    mutationFn: async (input?: { requestOptions?: AnyHarnessRequestOptions }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.workflowRunsV2.resume(runId, input?.requestOptions);
    },
    onSuccess: writeProjection,
  });

  const addAdhocNode = useMutation({
    mutationFn: async (input: {
      request: WorkflowRunAddAdhocNodeRequestV2;
      requestOptions?: AnyHarnessRequestOptions;
    }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.workflowRunsV2.addAdhocNode(runId, input.request, input.requestOptions);
    },
    onSuccess: writeProjection,
  });

  return {
    putRun,
    approve,
    failRedo,
    flipType,
    undoAdvance,
    resume,
    addAdhocNode,
  };
}
