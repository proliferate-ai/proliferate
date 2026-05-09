import { useCallback } from "react";
import { useWorkspaceSessionCache } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import type { WorkspaceSession } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import type { SessionLatencyFlowOptions } from "@/hooks/sessions/workflows/session-selection-options";
import {
  ensureRuntimeReadyForSessions,
  fetchWorkspaceSessions,
} from "@/hooks/sessions/workflows/session-selection-runtime";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { getLatencyFlowRequestHeaders } from "@/lib/infra/measurement/latency-flow";
import { recordMeasurementMetric } from "@/lib/infra/measurement/debug-measurement";

export function useWorkspaceSessionLoader() {
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

    const runtimeUrl = await ensureRuntimeReadyForSessions();
    const requestHeaders = getLatencyFlowRequestHeaders(options?.latencyFlowId);
    const cacheSnapshot = getWorkspaceSessionCacheSnapshot(workspaceId, { runtimeUrl });
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
      return cacheSnapshot.sessions;
    }

    // Do not join a possibly hung automatic query for the same selected
    // workspace. Session selection is the owning workflow and must either
    // complete or fail independently so the shell cannot stay on
    // "Preparing workspace" behind an unrelated header/sidebar fetch.
    const sessions = await fetchWorkspaceSessions(
      runtimeUrl,
      workspaceId,
      requestHeaders || options?.measurementOperationId
        ? {
          requestHeaders,
          measurementOperationId: options?.measurementOperationId,
        }
        : undefined,
    );
    setWorkspaceSessions(workspaceId, () => sessions, { runtimeUrl });
    return sessions;
  }, [
    getWorkspaceRuntimeBlockReason,
    getWorkspaceSessionCacheSnapshot,
    setWorkspaceSessions,
  ]);

  return { ensureWorkspaceSessions };
}
