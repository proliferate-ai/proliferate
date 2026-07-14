import type { AnyHarnessRequestOptions } from "@anyharness/sdk";
import { useQuery } from "@tanstack/react-query";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type { WorkspaceCollections } from "@/lib/domain/workspaces/cloud/collections";
import {
  buildWorkspaceCollections,
  workspaceCollectionsNeedActivityRefresh,
} from "@/lib/domain/workspaces/cloud/collections";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useWorkspaceCollectionsCache } from "@/hooks/workspaces/cache/use-workspace-collections-cache";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";
import {
  listRepoRoots,
  listRuntimeWorkspaces,
} from "@/lib/access/anyharness/workspaces";
import {
  bindMeasurementCategories,
  finishOrCancelMeasurementOperation,
  finishMeasurementOperation,
  recordMeasurementMetric,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import { getMeasurementRequestOptions } from "@/lib/infra/measurement/debug-measurement-request-options";
import { hashMeasurementScope } from "@/lib/infra/measurement/debug-measurement-env";

const WORKSPACE_COLLECTIONS_STALE_MS = 30_000;

interface UseWorkspacesOptions {
  enabled?: boolean;
}

function requestOptionsWithSignal(
  requestOptions: AnyHarnessRequestOptions | undefined,
  signal: AbortSignal,
): AnyHarnessRequestOptions {
  return {
    ...requestOptions,
    signal: requestOptions?.signal ?? signal,
  };
}

function isAbortError(error: unknown): boolean {
  if (
    typeof DOMException !== "undefined"
    && error instanceof DOMException
    && error.name === "AbortError"
  ) {
    return true;
  }

  if (error instanceof Error) {
    return error.name === "AbortError"
      || error.name === "CanceledError"
      || error.name === "CancelledError";
  }

  return false;
}

async function fallbackOnNonAbort<T>(
  promise: Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return fallback;
  }
}

async function preservePreviousOnNonAbort<T>(
  promise: Promise<T>,
  previous: T | undefined,
): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (isAbortError(error) || previous === undefined) {
      throw error;
    }
    return previous;
  }
}

export function useWorkspaces(options?: UseWorkspacesOptions) {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const hasLocalRuntime = runtimeUrl.trim().length > 0;
  const authState = useProductHost().auth.state;
  const authUserId = authState.status === "authenticated"
    ? authState.user?.id ?? null
    : null;
  const { cloudActive } = useCloudAvailabilityState();
  const canQuery = (options?.enabled ?? true) && hasLocalRuntime;
  const {
    getWorkspaceCollectionsCacheState,
    queryKey,
  } = useWorkspaceCollectionsCache({ authUserId, cloudActive, runtimeUrl });

  return useQuery<WorkspaceCollections>({
    queryKey,
    queryFn: async ({ signal }) => {
      if (!hasLocalRuntime) {
        throw new Error("A local AnyHarness runtime is required to refresh local workspace inventory.");
      }
      const startedAt = startLatencyTimer();
      const operationId = startMeasurementOperation({
        kind: "workspace_collections_refresh",
        surfaces: [
          "workspace-shell",
          "workspace-sidebar",
          "global-header",
          "header-tabs",
          "chat-surface",
          "session-transcript-pane",
          "transcript-list",
          "transcript-context-providers",
          "transcript-row-list-router",
          "transcript-virtualized-viewport",
          "transcript-full-list",
          "file-tree",
        ],
        maxDurationMs: 30_000,
      });
      const cacheState = getWorkspaceCollectionsCacheState();
      if (operationId) {
        recordMeasurementMetric({
          type: "cache",
          category: "workspace.list",
          operationId,
          decision: cacheState?.dataUpdatedAt ? "stale" : "miss",
          source: "react_query",
        });
      }
      const unbind = operationId
        ? bindMeasurementCategories({
          operationId,
          categories: ["workspace.list", "repo_root.list", "cloud.workspace.list"],
          scope: {
            runtimeUrlHash: runtimeUrl.trim()
              ? hashMeasurementScope(runtimeUrl.trim())
              : undefined,
          },
          ttlMs: 30_000,
        })
        : () => undefined;
      logLatency("workspace.collections.fetch.start", {
        runtimeUrl,
        cloudActive,
      });
      const cachedCollections = cacheState?.data as WorkspaceCollections | undefined;
      const connection = { runtimeUrl };
      try {
        const fetchStartedAt = performance.now();
        const [localWorkspaces, repoRoots] = await Promise.all([
          fallbackOnNonAbort(
            listRuntimeWorkspaces(
              connection,
              requestOptionsWithSignal(
                getMeasurementRequestOptions({ operationId, category: "workspace.list" })
                  ?? undefined,
                signal,
              ),
            ),
            [],
          ),
          preservePreviousOnNonAbort(
            listRepoRoots(
              connection,
              requestOptionsWithSignal(
                getMeasurementRequestOptions({ operationId, category: "repo_root.list" })
                  ?? undefined,
                signal,
              ),
            ),
            cachedCollections?.repoRoots,
          ),
        ]);
        recordMeasurementWorkflowStep({
          operationId,
          step: "workspace.collections.fetch",
          startedAt: fetchStartedAt,
        });
        const buildStartedAt = performance.now();
        const collections = buildWorkspaceCollections(
          localWorkspaces,
          repoRoots,
          cachedCollections?.cloudWorkspaces ?? [],
        );
        recordMeasurementWorkflowStep({
          operationId,
          step: "workspace.collections.build",
          startedAt: buildStartedAt,
          count: collections.workspaces.length,
        });
        logLatency("workspace.collections.fetch.success", {
          runtimeUrl,
          hasLocalRuntime,
          cloudActive,
          localCount: collections.localWorkspaces.length,
          cloudCount: collections.cloudWorkspaces.length,
          mergedCount: collections.workspaces.length,
          elapsedMs: elapsedMs(startedAt),
        });
        if (operationId) {
          finishMeasurementOperation(operationId, "completed");
        }
        return collections;
      } catch (error) {
        finishOrCancelMeasurementOperation(
          operationId,
          isAbortError(error) ? "aborted" : "error_sanitized",
        );
        throw error;
      } finally {
        unbind();
      }
    },
    enabled: canQuery,
    staleTime: WORKSPACE_COLLECTIONS_STALE_MS,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      workspaceCollectionsNeedActivityRefresh(query.state.data)
        ? WORKSPACE_COLLECTIONS_STALE_MS
        : false,
  });
}
