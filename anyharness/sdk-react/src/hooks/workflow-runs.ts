import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
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
} from "../lib/query-keys-workflow-runs.js";

interface RuntimeQueryOptions {
  enabled?: boolean;
}

interface WorkflowRunsQueryOptions extends RuntimeQueryOptions {
  /**
   * Keep the roster fresh while it can still change under the reader: refetch
   * on window focus, and poll while any run in it is worth watching.
   *
   * Opt-in rather than always-on because the two consumers want opposite
   * things: the startup resume scan wants one read of every run this runtime
   * knows about, while a workspace whose panel is mounted has to notice a run
   * triggered from another tab, device, or automation — the trigger's cache
   * write-through only covers runs this client started itself.
   */
  watchActiveRuns?: boolean;
}

/** Runs actively progressing or waiting on a human decision; every other status is parked or terminal. */
const WORKFLOW_RUN_POLLING_STATUSES: ReadonlySet<WorkflowRunV2["status"]> = new Set([
  "running",
  "awaiting_human",
]);

/**
 * Runs whose row can still change without this client asking: the two active
 * statuses plus `interrupted`, which a resume from anywhere else moves out of.
 * A list of only `completed`/`failed` runs stays quiet — nothing in it moves
 * again, and a *new* run arriving is what focus refetch is for.
 */
const WORKFLOW_RUNS_LIST_WATCH_STATUSES: ReadonlySet<WorkflowRunV2["status"]> = new Set([
  ...WORKFLOW_RUN_POLLING_STATUSES,
  "interrupted",
]);

export const WORKFLOW_RUN_ACTIVE_INTERVAL_MS = 3000;
/**
 * Polling cadence for `GET /v1/workflow-runs`. Deliberately slower than the
 * run detail's 3s: the list answers only *which* runs exist (and so whether
 * the workflow tool is offered at all), while the run's own churn — node
 * status, current node, docs — rides the detail projection.
 */
export const WORKFLOW_RUNS_LIST_ACTIVE_INTERVAL_MS = 5000;

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

/**
 * Polling cadence for `GET /v1/workflow-runs`, from the rows the list already
 * holds: any run worth watching keeps the list polling, a list of only
 * finished runs (or an empty one) stops it.
 */
export function resolveWorkflowRunsListRefetchInterval(
  state: { data?: WorkflowRunsListResponseV2 },
): number | false {
  const runs = state.data?.runs ?? [];
  return runs.some((run) => WORKFLOW_RUNS_LIST_WATCH_STATUSES.has(run.status))
    ? WORKFLOW_RUNS_LIST_ACTIVE_INTERVAL_MS
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
  options?: WorkflowRunsQueryOptions,
) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);
  const trimmedWorkspaceId = workspaceId?.trim() || undefined;
  const watchActiveRuns = options?.watchActiveRuns ?? false;

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
    refetchInterval: (query) => (
      watchActiveRuns ? resolveWorkflowRunsListRefetchInterval(query.state) : false
    ),
    refetchIntervalInBackground: false,
    // Only set when watching: an unwatched caller keeps the app's own default
    // rather than having this hook decide focus behaviour for it.
    ...(watchActiveRuns ? { refetchOnWindowFocus: true } : {}),
  });
}

/**
 * Place a run row in a cached list: replace it where it already sits, insert it
 * where it does not.
 *
 * Insertion is required, not optional — the list routes are the only source of
 * a run row, so a run placed while a list is already cached (the gen-2 trigger)
 * would otherwise stay invisible until that query refetched.
 *
 * `listWorkspaceId` is the filter its cache key was built with: a list scoped
 * to another workspace must not gain the row, because the route that filled it
 * would never have returned it. Insertion keeps the routes' `created_at DESC`
 * order (`store.rs` `all_runs`/`runs_for_workspace`), so a freshly placed run
 * lands at the head; a replacement stays where it is, since a status change
 * does not move a row.
 */
function upsertRunInList(
  data: WorkflowRunsListResponseV2 | undefined,
  run: WorkflowRunV2,
  listWorkspaceId: string | null,
): WorkflowRunsListResponseV2 | undefined {
  if (!data) {
    return data;
  }
  const index = data.runs.findIndex((candidate) => candidate.id === run.id);
  if (index !== -1) {
    const runs = [...data.runs];
    runs[index] = run;
    return { ...data, runs };
  }
  if (listWorkspaceId !== null && listWorkspaceId !== run.workspaceId) {
    return data;
  }
  const firstOlder = data.runs.findIndex((candidate) => candidate.createdAt < run.createdAt);
  const runs = [...data.runs];
  runs.splice(firstOlder === -1 ? runs.length : firstOlder, 0, run);
  return { ...data, runs };
}

/** The workspace filter a runs-list key carries; `null` = every run. */
function listWorkspaceFilter(queryKey: readonly unknown[]): string | null {
  const filter = queryKey[queryKey.length - 1];
  return typeof filter === "string" ? filter : null;
}

function writeRunProjection(
  queryClient: QueryClient,
  scope: { runtimeUrl: string; cacheScopeKey: string; runId: string },
  projection: WorkflowRunProjectionV2,
): void {
  queryClient.setQueryData(
    anyHarnessWorkflowRunKey(scope.runtimeUrl, scope.cacheScopeKey, scope.runId),
    projection,
  );
  // Read the keys rather than `setQueriesData`: the workspace filter each
  // cached list was built with decides whether the row may be inserted, and
  // only the key carries it.
  const cachedLists = queryClient.getQueriesData<WorkflowRunsListResponseV2>({
    queryKey: anyHarnessWorkflowRunsListScopeKey(scope.runtimeUrl, scope.cacheScopeKey),
  });
  for (const [queryKey, data] of cachedLists) {
    const next = upsertRunInList(data, projection.run, listWorkspaceFilter(queryKey));
    if (next !== data) {
      queryClient.setQueryData(queryKey, next);
    }
  }
}

/**
 * Cache write-through for a projection its caller obtained outside these hooks:
 * the gen-2 trigger's `PUT /v1/workflow-runs/{run_id}`, whose run id is minted
 * at submit time and so cannot bind `useWorkflowRunMutations` at mount. Same
 * contract as the mutations below — the response is the fresh projection, so it
 * is written, never invalidated.
 */
export function useWorkflowRunProjectionWriter(): (
  projection: WorkflowRunProjectionV2,
) => void {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);
  const queryClient = useQueryClient();

  return useCallback((projection: WorkflowRunProjectionV2) => {
    writeRunProjection(
      queryClient,
      { runtimeUrl, cacheScopeKey, runId: projection.run.id },
      projection,
    );
  }, [cacheScopeKey, queryClient, runtimeUrl]);
}

/**
 * Every write on a workflow run's node/lifecycle machine — approve, fail-redo,
 * flip-type, undo-advance, resume, add-adhoc-node, and the initial put — turns
 * around the fresh full projection in its response. The contract those routes
 * share: commands never need a follow-up read. So every mutation here writes
 * its response straight into the run-detail cache with `setQueryData` (never
 * `invalidateQueries`), and places the row in any cached runs list.
 */
export function useWorkflowRunMutations(runId: string) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);
  const queryClient = useQueryClient();

  const writeProjection = (projection: WorkflowRunProjectionV2) => {
    writeRunProjection(queryClient, { runtimeUrl, cacheScopeKey, runId }, projection);
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
