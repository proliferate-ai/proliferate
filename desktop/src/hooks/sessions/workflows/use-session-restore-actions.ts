import { useCallback } from "react";
import { useRestoreDismissedSessionMutation } from "@anyharness/sdk-react";
import { useWorkspaceSessionCache } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import type { SessionLatencyFlowOptions } from "@/hooks/sessions/workflows/session-selection-options";
import {
  buildLatencyRequestOptions,
  ensureRuntimeReadyForSessions,
} from "@/hooks/sessions/workflows/session-selection-runtime";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";
import {
  annotateLatencyFlow,
  cancelLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";
import { getWorkspaceClientAndId } from "@/lib/workflows/sessions/session-runtime";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useToastStore } from "@/stores/toast/toast-store";

export function useSessionRestoreActions() {
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);
  const { upsertWorkspaceSessionRecord } = useWorkspaceSessionCache();
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
      const runtimeUrl = await ensureRuntimeReadyForSessions();
      logLatency("session.restore.runtime_ready", {
        workspaceId,
        flowId: options?.latencyFlowId ?? null,
        elapsedMs: elapsedMs(runtimeReadyStartedAt),
        totalElapsedMs: elapsedMs(startedAt),
      });

      const targetResolveStartedAt = startLatencyTimer();
      const { target } = await getWorkspaceClientAndId(runtimeUrl, workspaceId);
      logLatency("session.restore.target_resolved", {
        workspaceId,
        anyharnessWorkspaceId: target.anyharnessWorkspaceId,
        flowId: options?.latencyFlowId ?? null,
        elapsedMs: elapsedMs(targetResolveStartedAt),
        totalElapsedMs: elapsedMs(startedAt),
      });

      const requestOptions = buildLatencyRequestOptions(options?.latencyFlowId);
      const restoreRequestStartedAt = startLatencyTimer();
      const restored = await restoreDismissedSessionMutation.mutateAsync({
        workspaceId,
        requestOptions,
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

      upsertWorkspaceSessionRecord(workspaceId, restored);
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
    restoreDismissedSessionMutation,
    showToast,
    upsertWorkspaceSessionRecord,
  ]);

  return { restoreLastDismissedSession };
}
