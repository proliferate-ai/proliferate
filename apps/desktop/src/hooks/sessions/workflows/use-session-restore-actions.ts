import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  useDismissSessionMutation,
  useRestoreDismissedSessionMutation,
} from "@anyharness/sdk-react";
import { useWorkspaceSessionCache } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import type { SessionLatencyFlowOptions } from "@/hooks/sessions/workflows/session-selection-options";
import {
  buildLatencyRequestOptions,
  resolveRuntimeUrlForWorkspaceSessions,
} from "@/hooks/sessions/workflows/session-selection-runtime";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/derived/use-workspace-runtime-block";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";
import {
  annotateLatencyFlow,
  cancelLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";
import { getWorkspaceClientAndId } from "@/lib/access/anyharness/session-runtime";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  canPersistReplacedSessionTombstones,
  releaseReplacedSessionSuppression,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";
import {
  cancelQueuedReplacementDismissal,
  withWorkspaceReplacementRestoreFence,
} from "@/hooks/sessions/workflows/session-replacement-dismissals";

export function useSessionRestoreActions() {
  const host = useProductHost();
  const desktop = host.desktop;
  const localRuntime = desktop?.runtime ?? null;
  const ssh = desktop?.ssh ?? null;
  const cloudClient = host.cloud.client;
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();
  const dismissSessionMutation = useDismissSessionMutation();
  const restoreDismissedSessionMutation = useRestoreDismissedSessionMutation();

  const restoreLastDismissedSession = useCallback(async (
    options?: SessionLatencyFlowOptions,
  ): Promise<string | null> => {
    const startedAt = startLatencyTimer();
    const workspaceId = useSessionSelectionStore.getState().selectedWorkspaceId;
    logLatency("session.restore.start", {
      workspaceId,
      flowId: options?.latencyFlowId ?? null,
    });
    if (!workspaceId) {
      logLatency("session.restore.cancelled", {
        reason: "no_workspace_selected",
        flowId: options?.latencyFlowId ?? null,
        totalElapsedMs: elapsedMs(startedAt),
      });
      cancelLatencyFlow(options?.latencyFlowId, "no_workspace_selected");
      return null;
    }
    annotateLatencyFlow(options?.latencyFlowId, {
      targetWorkspaceId: workspaceId,
    });

    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      logLatency("session.restore.blocked", {
        workspaceId,
        blockedReason,
        flowId: options?.latencyFlowId ?? null,
        totalElapsedMs: elapsedMs(startedAt),
      });
      cancelLatencyFlow(options?.latencyFlowId, "workspace_runtime_blocked", {
        blockedReason,
      });
      showToast(blockedReason);
      return null;
    }

    try {
      const runtimeReadyStartedAt = startLatencyTimer();
      const runtimeUrl = await resolveRuntimeUrlForWorkspaceSessions(workspaceId, localRuntime);
      logLatency("session.restore.runtime_ready", {
        workspaceId,
        flowId: options?.latencyFlowId ?? null,
        elapsedMs: elapsedMs(runtimeReadyStartedAt),
        totalElapsedMs: elapsedMs(startedAt),
      });

      const targetResolveStartedAt = startLatencyTimer();
      const { target } = await getWorkspaceClientAndId(runtimeUrl, workspaceId, ssh, cloudClient);
      logLatency("session.restore.target_resolved", {
        workspaceId,
        anyharnessWorkspaceId: target.anyharnessWorkspaceId,
        flowId: options?.latencyFlowId ?? null,
        elapsedMs: elapsedMs(targetResolveStartedAt),
        totalElapsedMs: elapsedMs(startedAt),
      });

      const requestOptions = buildLatencyRequestOptions(options?.latencyFlowId);
      const restoreRequestStartedAt = startLatencyTimer();
      const restored = await withWorkspaceReplacementRestoreFence(workspaceId, async () => {
        if (!canPersistReplacedSessionTombstones()) {
          throw new Error("Could not save session cleanup state. Try restoring again.");
        }
        const restoredSession = await restoreDismissedSessionMutation.mutateAsync({
          workspaceId,
          requestOptions,
        });
        if (!restoredSession) {
          return null;
        }

        // Explicit restore is the user-authorized inverse of background cleanup.
        // Cancel stale cleanup queued while the restore mutation invalidated
        // session lists, then release runtime and client aliases before the
        // summary reaches cache so selectors can observe it in this renderer.
        if (!releaseReplacedSessionSuppression(workspaceId, restoredSession.id)) {
          // Storage changed after the preflight. Put runtime truth back into
          // the dismissed state covered by the still-durable tombstone.
          await dismissSessionMutation.mutateAsync({
            workspaceId,
            sessionId: restoredSession.id,
          }).catch(() => undefined);
          throw new Error("Could not save restored session state. Try again.");
        }
        cancelQueuedReplacementDismissal(workspaceId, restoredSession.id);
        upsertWorkspaceSessionRecord(workspaceId, restoredSession);
        return restoredSession;
      });
      logLatency("session.restore.request_completed", {
        workspaceId,
        restored: restored !== null,
        sessionId: restored?.id ?? null,
        flowId: options?.latencyFlowId ?? null,
        elapsedMs: elapsedMs(restoreRequestStartedAt),
        totalElapsedMs: elapsedMs(startedAt),
      });
      if (!restored) {
        logLatency("session.restore.empty", {
          workspaceId,
          flowId: options?.latencyFlowId ?? null,
          totalElapsedMs: elapsedMs(startedAt),
        });
        cancelLatencyFlow(options?.latencyFlowId, "session_restore_empty");
        return null;
      }
      annotateLatencyFlow(options?.latencyFlowId, {
        targetSessionId: restored.id,
      });

      logLatency("session.restore.cache_upserted", {
        workspaceId,
        sessionId: restored.id,
        flowId: options?.latencyFlowId ?? null,
        totalElapsedMs: elapsedMs(startedAt),
      });

      logLatency("session.restore.completed", {
        workspaceId,
        sessionId: restored.id,
        flowId: options?.latencyFlowId ?? null,
        totalElapsedMs: elapsedMs(startedAt),
      });
      return restored.id;
    } catch (error) {
      logLatency("session.restore.failed", {
        workspaceId,
        flowId: options?.latencyFlowId ?? null,
        error: error instanceof Error ? error.name : "unknown",
        totalElapsedMs: elapsedMs(startedAt),
      });
      throw error;
    }
  }, [
    getWorkspaceRuntimeBlockReason,
    localRuntime,
    dismissSessionMutation,
    restoreDismissedSessionMutation,
    showToast,
    ssh,
    cloudClient,
    upsertWorkspaceSessionRecord,
  ]);

  return { restoreLastDismissedSession };
}
