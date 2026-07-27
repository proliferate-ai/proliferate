import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModelSnapshotStatus } from "@anyharness/sdk";
import { AnyHarnessError } from "@anyharness/sdk";
import {
  resolveRuntimeCacheScopeKey,
  resolveRuntimeConnection,
  useAnyHarnessRuntimeContext,
} from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import { requestOptionsWithSignal } from "../lib/request-options.js";
import { anyHarnessAgentModelSnapshotStatusKey } from "../lib/query-keys.js";

interface RuntimeQueryOptions {
  enabled?: boolean;
}

interface ModelSnapshotStatusQueryOptions extends RuntimeQueryOptions {
  /** Poll fast while the probe engine is queued/running. Defaults on. */
  refetchWhileActive?: boolean;
}

export const MODEL_SNAPSHOT_ACTIVE_INTERVAL_MS = 1500;

/**
 * Polling cadence for `GET /v1/agents/{kind}/model-snapshot` (mirrors
 * `resolveAgentReconcileRefetchInterval`, model-catalog.md's polled-not-pushed
 * status surface). The engine `queued`/`running` polls fast (backoff resolves
 * on its own server-side timer and is picked up on the next natural refetch);
 * an idle status stops polling — this route has no discovery mode of its own
 * (unlike reconcile) because the caller decides when to probe via the refresh
 * mutation, not by discovering new work. 404 (unknown agent kind) stops.
 */
export function resolveModelSnapshotRefetchInterval(
  state: { data?: ModelSnapshotStatus; error?: unknown },
  options: { refetchWhileActive: boolean },
): number | false {
  if (state.error instanceof AnyHarnessError && state.error.problem.status === 404) {
    return false;
  }
  if (!options.refetchWhileActive) {
    return false;
  }
  const isActive = state.data?.state === "queued" || state.data?.state === "running";
  return isActive ? MODEL_SNAPSHOT_ACTIVE_INTERVAL_MS : false;
}

/**
 * The composed model-snapshot probe status for one agent kind
 * (model-catalog.md "Runtime routes") — one observation per harness; the
 * status/refresh surface the "All Models" tab renders alongside its model
 * rows.
 */
export function useModelSnapshotStatusQuery(
  kind: string,
  options?: ModelSnapshotStatusQueryOptions,
) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);
  const trimmedKind = kind.trim();
  const refetchWhileActive = options?.refetchWhileActive ?? true;

  return useQuery({
    queryKey: anyHarnessAgentModelSnapshotStatusKey(runtimeUrl, trimmedKind, cacheScopeKey),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0 && trimmedKind.length > 0,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.modelSnapshot.getStatus(
        trimmedKind,
        requestOptionsWithSignal(undefined, signal),
      );
    },
    refetchInterval: (query) => resolveModelSnapshotRefetchInterval(query.state, {
      refetchWhileActive,
    }),
  });
}

/**
 * Force the harness's re-probe now (the manual-refresh poke, owner runtimes
 * only). Param-less beyond the kind: one composed observation per harness.
 */
export function useRefreshModelSnapshotMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);

  return useMutation({
    mutationFn: async (kind: string) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.modelSnapshot.refresh(kind.trim());
    },
    onSuccess: (response, kind) => {
      queryClient.setQueryData(
        anyHarnessAgentModelSnapshotStatusKey(runtimeUrl, kind.trim(), cacheScopeKey),
        response,
      );
    },
  });
}
