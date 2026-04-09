import {
  anyHarnessSessionsKey,
  getAnyHarnessClient,
} from "@anyharness/sdk-react";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@anyharness/sdk";
import { clearLastViewedSession } from "@/stores/preferences/workspace-ui-store";
import {
  resolveStatusFromExecutionSummary,
  sessionSlotBelongsToWorkspace,
} from "@/lib/domain/sessions/activity";
import {
  useHarnessStore,
} from "@/stores/sessions/harness-store";
import {
  createEmptySessionSlot,
  getSessionClientAndWorkspace,
  getWorkspaceClientAndId,
} from "@/lib/integrations/anyharness/session-runtime";
import { bootstrapHarnessRuntime } from "@/lib/integrations/anyharness/runtime-bootstrap";
import { resolveWorkspaceConnection } from "@/lib/integrations/anyharness/resolve-workspace-connection";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";
import { useToastStore } from "@/stores/toast/toast-store";
import { useWorkspaceRuntimeBlock } from "@/hooks/workspaces/use-workspace-runtime-block";
import { useWorkspaceSessionCache } from "@/hooks/sessions/use-workspace-session-cache";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/debug-latency";
import {
  annotateLatencyFlow,
  cancelLatencyFlow,
  getLatencyFlowRequestHeaders,
} from "@/lib/infra/latency-flow";

export type WorkspaceSession = Session & { workspaceId: string };

interface SessionLatencyFlowOptions {
  latencyFlowId?: string | null;
  allowColdIdleNoStream?: boolean;
}

export async function fetchWorkspaceSessions(
  runtimeUrl: string,
  workspaceId: string,
  options?: { requestHeaders?: HeadersInit },
): Promise<WorkspaceSession[]> {
  const connection = await resolveWorkspaceConnection(runtimeUrl, workspaceId);
  const sessions = await getAnyHarnessClient(connection).sessions.list(
    connection.anyharnessWorkspaceId,
    options?.requestHeaders ? { headers: options.requestHeaders } : undefined,
  );
  return sessions.map((session) => ({
    ...session,
    workspaceId,
  }));
}

function buildLatencyRequestOptions(latencyFlowId?: string | null) {
  const headers = getLatencyFlowRequestHeaders(latencyFlowId);
  return headers ? { headers } : undefined;
}

async function ensureRuntimeReadyForSessions(): Promise<string> {
  const state = useHarnessStore.getState();
  if (state.connectionState !== "healthy" || state.runtimeUrl.trim().length === 0) {
    await bootstrapHarnessRuntime();
  }

  const readyState = useHarnessStore.getState();
  if (readyState.connectionState !== "healthy" || readyState.runtimeUrl.trim().length === 0) {
    throw new Error(readyState.error || "AnyHarness runtime is still starting. Try again.");
  }

  return readyState.runtimeUrl;
}

function removeSessionSlot(sessionId: string): void {
  useHarnessStore.setState((state) => {
    if (!state.sessionSlots[sessionId]) {
      return state;
    }

    const nextSlots = { ...state.sessionSlots };
    delete nextSlots[sessionId];

    return {
      sessionSlots: nextSlots,
    };
  });
}

export function useSessionSelectionActions() {
  const queryClient = useQueryClient();
  const { getWorkspaceRuntimeBlockReason } = useWorkspaceRuntimeBlock();
  const showToast = useToastStore((state) => state.show);
  const {
    activateSession,
    closeSessionSlotStream,
    ensureSessionStreamConnected,
    rehydrateSessionSlotFromHistory,
  } = useSessionRuntimeActions();
  const {
    removeWorkspaceSessionRecord,
    upsertWorkspaceSessionRecord,
  } = useWorkspaceSessionCache();

  const ensureWorkspaceSessions = useCallback(async (
    workspaceId: string,
    options?: SessionLatencyFlowOptions,
  ) => {
    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const runtimeUrl = await ensureRuntimeReadyForSessions();
    const requestHeaders = getLatencyFlowRequestHeaders(options?.latencyFlowId);
    return queryClient.ensureQueryData({
      queryKey: anyHarnessSessionsKey(runtimeUrl, workspaceId),
      queryFn: () => fetchWorkspaceSessions(
        runtimeUrl,
        workspaceId,
        requestHeaders ? { requestHeaders } : undefined,
      ),
    });
  }, [getWorkspaceRuntimeBlockReason, queryClient]);

  const selectSession = useCallback(async (
    sessionId: string,
    options?: SessionLatencyFlowOptions,
  ) => {
    const startedAt = startLatencyTimer();
    const current = useHarnessStore.getState();
    const existingSlot = current.sessionSlots[sessionId] ?? null;
    const requestHeaders = getLatencyFlowRequestHeaders(options?.latencyFlowId);
    logLatency("session.select.start", {
      sessionId,
      flowId: options?.latencyFlowId ?? null,
      hasExistingSlot: existingSlot !== null,
      selectedWorkspaceId: current.selectedWorkspaceId,
    });

    if (existingSlot) {
      annotateLatencyFlow(options?.latencyFlowId, {
        targetSessionId: sessionId,
        targetWorkspaceId: existingSlot.workspaceId,
      });
      activateSession(sessionId);
      if (
        existingSlot.streamConnectionState === "connecting"
        || existingSlot.streamConnectionState === "open"
      ) {
        logLatency("session.select.reused_live_slot", {
          sessionId,
          workspaceId: existingSlot.workspaceId,
          streamConnectionState: existingSlot.streamConnectionState,
          flowId: options?.latencyFlowId ?? null,
          totalElapsedMs: elapsedMs(startedAt),
        });
        return;
      }
    }

    const workspaceId = existingSlot?.workspaceId ?? current.selectedWorkspaceId;
    if (!workspaceId) {
      throw new Error("No workspace selected");
    }
    annotateLatencyFlow(options?.latencyFlowId, {
      targetSessionId: sessionId,
      targetWorkspaceId: workspaceId,
    });

    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason && existingSlot) {
      activateSession(sessionId);
      return;
    }
    if (blockedReason) {
      throw new Error(blockedReason);
    }

    const sessionsLoadStartedAt = startLatencyTimer();
    const sessions = await ensureWorkspaceSessions(workspaceId, options);
    logLatency("session.select.sessions_loaded", {
      sessionId,
      workspaceId,
      sessionCount: sessions.length,
      flowId: options?.latencyFlowId ?? null,
      elapsedMs: elapsedMs(sessionsLoadStartedAt),
      totalElapsedMs: elapsedMs(startedAt),
    });
    const sessionMeta = sessions.find((session) => session.id === sessionId) ?? null;
    const agentKind = existingSlot?.agentKind ?? sessionMeta?.agentKind ?? "unknown";

    if (!existingSlot) {
      useHarnessStore.getState().putSessionSlot(sessionId, {
        ...createEmptySessionSlot(sessionId, agentKind, {
          workspaceId,
          modelId: sessionMeta?.modelId ?? null,
          modeId: sessionMeta?.modeId ?? null,
          title: sessionMeta?.title ?? null,
          liveConfig: sessionMeta?.liveConfig ?? null,
          executionSummary: sessionMeta?.executionSummary ?? null,
          lastPromptAt: sessionMeta?.lastPromptAt ?? null,
        }),
        status: resolveStatusFromExecutionSummary(
          sessionMeta?.executionSummary ?? null,
          sessionMeta?.status ?? "idle",
        ),
      });
      activateSession(sessionId);
    } else {
      useHarnessStore.getState().patchSessionSlot(sessionId, {
        workspaceId,
        agentKind,
        modelId: sessionMeta?.modelId ?? existingSlot.modelId ?? null,
        modeId: sessionMeta?.modeId ?? existingSlot.modeId ?? null,
        title: sessionMeta?.title ?? existingSlot.title ?? null,
        liveConfig: sessionMeta?.liveConfig ?? existingSlot.liveConfig ?? null,
        executionSummary: sessionMeta?.executionSummary ?? existingSlot.executionSummary ?? null,
        status: resolveStatusFromExecutionSummary(
          sessionMeta?.executionSummary ?? existingSlot.executionSummary ?? null,
          sessionMeta?.status ?? existingSlot.status,
        ),
        lastPromptAt: sessionMeta?.lastPromptAt ?? existingSlot.lastPromptAt ?? null,
      });
    }

    const currentSlot = useHarnessStore.getState().sessionSlots[sessionId] ?? null;
    if (!currentSlot?.transcriptHydrated) {
      const hydrateStartedAt = startLatencyTimer();
      const hydrated = await rehydrateSessionSlotFromHistory(sessionId, { requestHeaders });
      useHarnessStore.getState().patchSessionSlot(sessionId, { transcriptHydrated: true });
      logLatency("session.select.history_hydrated", {
        sessionId,
        workspaceId,
        hydrated,
        flowId: options?.latencyFlowId ?? null,
        elapsedMs: elapsedMs(hydrateStartedAt),
        totalElapsedMs: elapsedMs(startedAt),
      });
    }

    const streamStartedAt = startLatencyTimer();
    await ensureSessionStreamConnected(sessionId, {
      allowColdIdleNoStream: options?.allowColdIdleNoStream,
      resumeIfActive: true,
      requestHeaders,
    });
    logLatency("session.select.stream_connected", {
      sessionId,
      workspaceId,
      flowId: options?.latencyFlowId ?? null,
      elapsedMs: elapsedMs(streamStartedAt),
      totalElapsedMs: elapsedMs(startedAt),
    });
    logLatency("session.select.completed", {
      sessionId,
      workspaceId,
      flowId: options?.latencyFlowId ?? null,
      totalElapsedMs: elapsedMs(startedAt),
    });
  }, [
    activateSession,
    ensureSessionStreamConnected,
    ensureWorkspaceSessions,
    getWorkspaceRuntimeBlockReason,
    rehydrateSessionSlotFromHistory,
  ]);

  const dismissSession = useCallback(async (sessionId: string) => {
    const state = useHarnessStore.getState();
    const closingSlot = state.sessionSlots[sessionId] ?? null;
    const workspaceId = closingSlot?.workspaceId ?? state.selectedWorkspaceId;

    const blockedReason = getWorkspaceRuntimeBlockReason(workspaceId);
    if (blockedReason) {
      showToast(blockedReason);
      return;
    }

    closeSessionSlotStream(sessionId);

    try {
      const { connection } = await getSessionClientAndWorkspace(sessionId);
      await getAnyHarnessClient(connection).sessions.dismiss(sessionId);
    } catch {
      // Dismiss failed.
    }

    removeSessionSlot(sessionId);

    let nextActiveId = useHarnessStore.getState().activeSessionId;
    if (nextActiveId === sessionId) {
      nextActiveId = Object.values(useHarnessStore.getState().sessionSlots)
        .filter((slot) => sessionSlotBelongsToWorkspace(slot, closingSlot?.workspaceId ?? null))
        .map((slot) => slot.sessionId)[0] ?? null;
    }

    if (nextActiveId) {
      activateSession(nextActiveId);
    } else {
      useHarnessStore.getState().setActiveSessionId(null);
    }

    if (workspaceId) {
      clearLastViewedSession(workspaceId, sessionId);
      removeWorkspaceSessionRecord(workspaceId, sessionId);
    }
  }, [
    activateSession,
    closeSessionSlotStream,
    getWorkspaceRuntimeBlockReason,
    removeWorkspaceSessionRecord,
    showToast,
  ]);

  const restoreLastDismissedSession = useCallback(async (
    options?: SessionLatencyFlowOptions,
  ) => {
    const startedAt = startLatencyTimer();
    const workspaceId = useHarnessStore.getState().selectedWorkspaceId;
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
      return;
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
      return;
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
      const { connection, target } = await getWorkspaceClientAndId(runtimeUrl, workspaceId);
      logLatency("session.restore.target_resolved", {
        workspaceId,
        anyharnessWorkspaceId: target.anyharnessWorkspaceId,
        flowId: options?.latencyFlowId ?? null,
        elapsedMs: elapsedMs(targetResolveStartedAt),
        totalElapsedMs: elapsedMs(startedAt),
      });

      const requestOptions = buildLatencyRequestOptions(options?.latencyFlowId);
      const restoreRequestStartedAt = startLatencyTimer();
      const restored = await getAnyHarnessClient(connection).sessions.restoreDismissed(
        target.anyharnessWorkspaceId,
        requestOptions,
      );
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
        return;
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

      const selectStartedAt = startLatencyTimer();
      await selectSession(restored.id, {
        ...options,
        allowColdIdleNoStream: true,
      });
      logLatency("session.restore.select_completed", {
        workspaceId,
        sessionId: restored.id,
        flowId: options?.latencyFlowId ?? null,
        elapsedMs: elapsedMs(selectStartedAt),
        totalElapsedMs: elapsedMs(startedAt),
      });
      logLatency("session.restore.completed", {
        workspaceId,
        sessionId: restored.id,
        flowId: options?.latencyFlowId ?? null,
        totalElapsedMs: elapsedMs(startedAt),
      });
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
    selectSession,
    showToast,
    upsertWorkspaceSessionRecord,
  ]);

  return {
    dismissSession,
    ensureWorkspaceSessions,
    restoreLastDismissedSession,
    selectSession,
  };
}
