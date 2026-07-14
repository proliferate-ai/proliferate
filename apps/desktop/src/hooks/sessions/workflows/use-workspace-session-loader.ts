import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useWorkspaceSessionCache } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import type { WorkspaceSession } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import type { SessionLatencyFlowOptions } from "@/hooks/sessions/workflows/session-selection-options";
import {
  ensureRuntimeReadyForSessions,
  fetchWorkspaceSessions,
} from "@/hooks/sessions/workflows/session-selection-runtime";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import { getLatencyFlowRequestHeaders } from "@/lib/infra/measurement/latency-flow";
import { recordMeasurementMetric } from "@/lib/infra/measurement/debug-measurement";
import { parseTargetWorkspaceSyntheticId } from "@/lib/domain/compute/target-workspace-id";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import {
  filterReplacedSessionTombstones,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";

export function useWorkspaceSessionLoader() {
  const desktop = useProductHost().desktop;
  const localRuntime = desktop?.runtime ?? null;
  const ssh = desktop?.ssh ?? null;
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const {
    getWorkspaceSessionCacheSnapshot,
    setWorkspaceSessions,
  } = useWorkspaceSessionCache();

  const ensureWorkspaceSessions = useCallback(async (
    workspaceId: string,
    options?: SessionLatencyFlowOptions,
  ): Promise<WorkspaceSession[]> => {
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const runtimeUrl = workspaceUsesResolvedRemoteRuntime(workspaceId)
      ? useHarnessConnectionStore.getState().runtimeUrl
      : await ensureRuntimeReadyForSessions(localRuntime);
    const requestHeaders = getLatencyFlowRequestHeaders(options?.latencyFlowId);
    const cacheSnapshot = getWorkspaceSessionCacheSnapshot(workspaceId);
    if (options?.measurementOperationId) {
      recordMeasurementMetric({
        type: "cache",
        category: "session.list",
        operationId: options.measurementOperationId,
        decision: cacheSnapshot.dataUpdatedAt
          ? cacheSnapshot.isInvalidated ? "stale" : "hit"
          : "miss",
        source: "react_query",
      });
    }
    if (
      cacheSnapshot.sessions
      && cacheSnapshot.dataUpdatedAt
      && !cacheSnapshot.isInvalidated
    ) {
      return filterReplacedSessionTombstones(
        workspaceId,
        cacheSnapshot.sessions,
      ) ?? [];
    }

    // Do not join a possibly hung automatic query for the same selected
    // workspace. Session selection is the owning workflow and must either
    // complete or fail independently so the shell cannot stay on
    // "Preparing workspace" behind an unrelated header/sidebar fetch.
    const loadedSessions = await fetchWorkspaceSessions(
      runtimeUrl,
      workspaceId,
      {
        requestHeaders,
        measurementOperationId: options?.measurementOperationId,
        ssh,
      },
    );
    const sessions = filterReplacedSessionTombstones(
      workspaceId,
      loadedSessions,
    ) ?? [];
    setWorkspaceSessions(workspaceId, () => sessions);
    return sessions;
  }, [
    getWorkspaceRuntimeBlockReason,
    getWorkspaceSessionCacheSnapshot,
    localRuntime,
    setWorkspaceSessions,
    ssh,
  ]);

  return { ensureWorkspaceSessions };
}

function workspaceUsesResolvedRemoteRuntime(workspaceId: string): boolean {
  return parseCloudWorkspaceSyntheticId(workspaceId) !== null
    || parseTargetWorkspaceSyntheticId(workspaceId) !== null;
}
