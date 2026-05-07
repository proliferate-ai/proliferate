import { getAnyHarnessClient } from "@anyharness/sdk-react";
import type { AnyHarnessRequestOptions } from "@anyharness/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { WorkspaceCollections } from "@/lib/domain/workspaces/collections";
import {
  buildWorkspaceCollections,
  workspaceCollectionsNeedActivityRefresh,
} from "@/lib/domain/workspaces/collections";
import { listCloudWorkspaces } from "@/lib/access/cloud/workspaces";
import { useCloudAvailabilityState } from "@/hooks/cloud/use-cloud-availability-state";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { workspaceCollectionsKey } from "./query-keys";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";
import {
  bindMeasurementCategories,
  finishOrCancelMeasurementOperation,
  finishMeasurementOperation,
  getMeasurementRequestOptions,
  hashMeasurementScope,
  recordMeasurementMetric,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";

const WORKSPACE_ACTIVITY_REFRESH_INTERVAL_MS = 5_000;
const WORKSPACE_COLLECTIONS_STALE_MS = 30_000;

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

export function useWorkspaces() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const { cloudActive } = useCloudAvailabilityState();
  const canQuery = runtimeUrl.trim().length > 0 || cloudActive;
  const queryKey = workspaceCollectionsKey(runtimeUrl, cloudActive);

  return useQuery<WorkspaceCollections>({
    queryKey,
    queryFn: async ({ signal }) => {
      const startedAt = startLatencyTimer();
      const operationId = startMeasurementOperation({
        kind: "workspace_collections_refresh",
        surfaces: [
          "workspace-shell",
          "workspace-sidebar",
          "global-header",
          "header-tabs",
          "chat-surface",
          "file-tree",
        ],
        maxDurationMs: 30_000,
      });
      const cacheState = queryClient.getQueryState(queryKey);
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
      const client = getAnyHarnessClient({ runtimeUrl });
      try {
        const fetchStartedAt = performance.now();
        const [localWorkspaces, repoRoots, cloudWorkspaces] = await Promise.all([
          fallbackOnNonAbort(
            client.workspaces.list(
              requestOptionsWithSignal(
                getMeasurementRequestOptions({ operationId, category: "workspace.list" })
                  ?? undefined,
                signal,
              ),
            ),
            [],
          ),
          fallbackOnNonAbort(
            client.repoRoots.list(
              requestOptionsWithSignal(
                getMeasurementRequestOptions({ operationId, category: "repo_root.list" })
                  ?? undefined,
                signal,
              ),
            ),
            [],
          ),
          cloudActive
            ? fallbackOnNonAbort(
              listCloudWorkspaces({ measurementOperationId: operationId, signal }),
              null,
            )
          : Promise.resolve([]),
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
          cloudWorkspaces ?? [],
        );
        recordMeasurementWorkflowStep({
          operationId,
          step: "workspace.collections.build",
          startedAt: buildStartedAt,
          count: collections.workspaces.length,
        });
        logLatency("workspace.collections.fetch.success", {
          runtimeUrl,
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
        ? WORKSPACE_ACTIVITY_REFRESH_INTERVAL_MS
        : false,
  });
}
