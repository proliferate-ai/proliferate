import {
  anyHarnessCoworkManagedWorkspacesKey,
  anyHarnessGitStatusKey,
  anyHarnessSessionReviewsKey,
  anyHarnessSessionSubagentsKey,
} from "@anyharness/sdk-react";
import {
  appendHistoryTail,
  applyStreamEnvelope,
  replaySessionHistory,
} from "@/lib/integrations/anyharness/session-stream-state";
import {
  createTranscriptState,
  type Session,
  type SessionStreamHandle,
  type ToolCallItem,
} from "@anyharness/sdk";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  fetchSessionHistory,
  fetchSessionSummary,
  getSessionClientAndWorkspace,
  logDevSSEEvent,
  openSessionStream,
  resumeSession,
} from "@/lib/integrations/anyharness/session-runtime";
import { logLatency } from "@/lib/infra/debug-latency";
import { markLatencyFlowLiveAttached } from "@/lib/infra/latency-flow";
import {
  resolveSessionStatus,
  shouldSkipColdIdleSessionStream,
} from "@/lib/domain/sessions/activity";
import {
  getAuthoritativeConfigValue,
  hasQueuedPendingConfigChanges,
  reconcilePendingConfigChanges,
  shouldAcceptAuthoritativeLiveConfig,
  type PendingSessionConfigChange,
} from "@/lib/domain/sessions/pending-config";
import { shouldClearOptimisticPendingPrompt } from "@/lib/domain/chat/pending-prompts";
import { buildSessionSlotPatchFromSummary } from "@/lib/domain/sessions/summary";
import { buildSessionStreamPatch } from "@/lib/domain/sessions/stream-patch";
import {
  clearSessionReconnectTimer,
  scheduleSessionReconnectTimer,
} from "@/lib/integrations/anyharness/session-reconnect-state";
import { notifyTurnEnd } from "@/lib/integrations/anyharness/turn-end-events";
import {
  markWorkspaceViewed,
  rememberLastViewedSession,
  trackWorkspaceInteraction,
} from "@/stores/preferences/workspace-ui-store";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { persistDefaultSessionModePreference } from "@/hooks/sessions/session-mode-preferences";
import { useWorkspaceSurfaceLookup } from "@/hooks/workspaces/use-workspace-surface-lookup";
import {
  isCurrentStreamHandle,
  shouldReconnectStream,
} from "@/hooks/sessions/session-runtime-helpers";
import {
  clearPendingConfigRollbackCheck,
  schedulePendingConfigRollbackCheck,
} from "@/hooks/sessions/session-runtime-pending-config";
import {
  parseSubagentLaunchResult,
  resolveSubagentLaunchDisplay,
} from "@/lib/domain/chat/subagent-launch";
import { useLinkedSessionMounting } from "@/hooks/chat/subagents/use-linked-session-mounting";

export function useSessionRuntimeActions() {
  const queryClient = useQueryClient();
  const { getWorkspaceSurface } = useWorkspaceSurfaceLookup();
  const showToast = useToastStore((state) => state.show);
  const {
    mountSubagentChildSession,
    mountSubagentChildrenFromEvents,
  } = useLinkedSessionMounting();
  const pluginsInCodingSessionsEnabled = useUserPreferencesStore(
    (state) => state.pluginsInCodingSessionsEnabled,
  );

  const persistReconciledModePreferences = useCallback((
    workspaceId: string | null | undefined,
    agentKind: string | null | undefined,
    liveConfigRawConfigId: string | null | undefined,
    reconciledChanges: PendingSessionConfigChange[],
    liveConfigValueResolver: (rawConfigId: string) => string | null,
  ) => {
    const workspaceSurface = getWorkspaceSurface(workspaceId);
    for (const change of reconciledChanges) {
      persistDefaultSessionModePreference({
        agentKind,
        liveConfigRawConfigId,
        rawConfigId: change.rawConfigId,
        modeId: liveConfigValueResolver(change.rawConfigId),
        workspaceSurface,
      });
    }
  }, [getWorkspaceSurface]);

  const activateSession = useCallback((sessionId: string | null) => {
    const state = useHarnessStore.getState();
    state.setActiveSessionId(sessionId);
    if (!sessionId) {
      return;
    }

    const slot = useHarnessStore.getState().sessionSlots[sessionId];
    if (slot?.workspaceId) {
      rememberLastViewedSession(slot.workspaceId, sessionId);
    }
  }, []);

  const applySessionSummary = useCallback((
    sessionId: string,
    session: Session,
    workspaceId: string,
  ) => {
    const state = useHarnessStore.getState();
    const existing = state.sessionSlots[sessionId];
    if (!existing) {
      return;
    }

    const patch = buildSessionSlotPatchFromSummary(
      session,
      workspaceId,
      existing.transcript ?? createTranscriptState(sessionId),
    );
    const shouldApplyLiveConfig = shouldAcceptAuthoritativeLiveConfig(
      existing.liveConfig,
      patch.liveConfig,
    );
    const shouldApplyConfigFields = shouldApplyLiveConfig || !existing.liveConfig;
    const effectiveLiveConfig = shouldApplyLiveConfig
      ? patch.liveConfig
      : existing.liveConfig;
    const nextTranscript = {
      ...patch.transcript,
      currentModeId: shouldApplyConfigFields
        ? patch.transcript.currentModeId
        : existing.transcript.currentModeId,
    };
    const reconcileResult = reconcilePendingConfigChanges(
      effectiveLiveConfig,
      existing.pendingConfigChanges,
    );

    state.patchSessionSlot(sessionId, {
      ...patch,
      liveConfig: effectiveLiveConfig,
      modelId: shouldApplyConfigFields ? patch.modelId : existing.modelId,
      modeId: shouldApplyConfigFields ? patch.modeId : existing.modeId,
      optimisticPrompt:
        patch.status === "closed" || patch.status === "errored"
          ? null
          : existing.optimisticPrompt,
      transcript: nextTranscript,
      pendingConfigChanges: reconcileResult.pendingConfigChanges,
      status: resolveSessionStatus(patch.status, {
        executionSummary: patch.executionSummary,
        streamConnectionState: existing.streamConnectionState,
        transcript: nextTranscript,
      }),
    });

    persistReconciledModePreferences(
      existing.workspaceId ?? workspaceId,
      patch.agentKind,
      effectiveLiveConfig?.normalizedControls.mode?.rawConfigId ?? null,
      reconcileResult.reconciledChanges,
      (rawConfigId) => getAuthoritativeConfigValue(effectiveLiveConfig, rawConfigId),
    );

    if (!hasQueuedPendingConfigChanges(reconcileResult.pendingConfigChanges)) {
      clearPendingConfigRollbackCheck(sessionId);
    }
  }, [persistReconciledModePreferences]);

  const rehydrateSessionSlotFromHistory = useCallback(async (
    sessionId: string,
    options?: {
      afterSeq?: number;
      replace?: boolean;
      requestHeaders?: HeadersInit;
    },
  ): Promise<boolean> => {
    try {
      const startedAt = performance.now();
      const slot = useHarnessStore.getState().sessionSlots[sessionId];
      if (!slot) {
        return false;
      }

      const afterSeq = options?.replace ? undefined : options?.afterSeq;
      const events = await fetchSessionHistory(
        sessionId,
        afterSeq != null || options?.requestHeaders
          ? {
            ...(afterSeq != null ? { afterSeq } : {}),
            ...(options?.requestHeaders
              ? { requestHeaders: options.requestHeaders }
              : {}),
          }
          : undefined,
      );
      const currentSlot = useHarnessStore.getState().sessionSlots[sessionId];
      if (!currentSlot) {
        return false;
      }

      if (afterSeq != null) {
        const nextState = appendHistoryTail(
          {
            events: currentSlot.events,
            transcript: currentSlot.transcript,
          },
          events,
        );

        if (!nextState.applied) {
          return false;
        }

        useHarnessStore.getState().patchSessionSlot(sessionId, {
          events: nextState.state.events,
          transcript: nextState.state.transcript,
          status: resolveSessionStatus(currentSlot.status, {
            executionSummary: currentSlot.executionSummary,
            streamConnectionState: currentSlot.streamConnectionState,
            transcript: nextState.state.transcript,
          }),
        });
        mountSubagentChildrenFromEvents(
          currentSlot.workspaceId,
          events,
          options?.requestHeaders,
        );
        logLatency("session.history.rehydrate.success", {
          sessionId,
          eventCount: events.length,
          appended: true,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
        return true;
      }

      const nextState = replaySessionHistory(sessionId, events);
      useHarnessStore.getState().patchSessionSlot(sessionId, {
        events: nextState.events,
        transcript: nextState.transcript,
        status: resolveSessionStatus(currentSlot.status, {
          executionSummary: currentSlot.executionSummary,
          streamConnectionState: currentSlot.streamConnectionState,
          transcript: nextState.transcript,
        }),
      });
      mountSubagentChildrenFromEvents(
        currentSlot.workspaceId,
        events,
        options?.requestHeaders,
      );
      logLatency("session.history.rehydrate.success", {
        sessionId,
        eventCount: events.length,
        appended: false,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
      return true;
    } catch {
      logLatency("session.history.rehydrate.failed", {
        sessionId,
      });
      return false;
    }
  }, [mountSubagentChildrenFromEvents]);

  const refreshSessionSlotMeta = useCallback(async (
    sessionId: string,
    options?: {
      resumeIfActive?: boolean;
      requestHeaders?: HeadersInit;
    },
  ): Promise<void> => {
    try {
      const { workspaceId } = await getSessionClientAndWorkspace(sessionId);
      let session = await fetchSessionSummary(sessionId, {
        requestHeaders: options?.requestHeaders,
      });
      applySessionSummary(sessionId, session, workspaceId);

      if (
        options?.resumeIfActive
        && resolveSessionStatus(session.status, {
          executionSummary: session.executionSummary ?? null,
          transcript: createTranscriptState(sessionId),
        }) === "running"
      ) {
        session = await resumeSession(sessionId, {
          pluginsInCodingSessionsEnabled,
          requestHeaders: options?.requestHeaders,
        });
        applySessionSummary(sessionId, session, workspaceId);
      }
    } catch {
      // Session fetch failed.
    }
  }, [applySessionSummary, pluginsInCodingSessionsEnabled]);

  const closeSessionSlotStream = useCallback((sessionId: string) => {
    clearSessionReconnectTimer(sessionId);
    const slot = useHarnessStore.getState().sessionSlots[sessionId];
    if (slot?.sseHandle) {
      slot.sseHandle.close();
    }
    if (slot) {
      useHarnessStore.getState().patchSessionSlot(sessionId, {
        sseHandle: null,
        streamConnectionState: "disconnected",
      });
    }
  }, []);

  const ensureSessionStreamConnected = useCallback(async (
    sessionId: string,
    options?: {
      awaitOpen?: boolean;
      openTimeoutMs?: number;
      resumeIfActive?: boolean;
      allowColdIdleNoStream?: boolean;
      skipInitialRefresh?: boolean;
      refreshOnStartupReady?: boolean;
      requestHeaders?: HeadersInit;
    },
  ): Promise<void> => {
    const initialSlot = useHarnessStore.getState().sessionSlots[sessionId];
    if (!initialSlot) {
      return;
    }

    // Defensive: enforce the invariant "if a stream is connecting/open, the
    // transcript is hydrated." selectSession is meant to hydrate before
    // calling here, but several other paths reach this function without
    // hydrating (findOrCreateSession → promptSession, the reconnect path,
    // selectSession's reused-live-slot early-return). Without this check,
    // an unhydrated live slot leaves useChatSurfaceState stuck at
    // session-loading + substep "loading-history" forever. We always patch
    // transcriptHydrated:true even on rehydrate failure, mirroring
    // selectSession's behavior so the gate clears either way.
    if (!initialSlot.transcriptHydrated) {
      await rehydrateSessionSlotFromHistory(sessionId, {
        requestHeaders: options?.requestHeaders,
      });
      useHarnessStore.getState().patchSessionSlot(sessionId, {
        transcriptHydrated: true,
      });
    }

    const slot = useHarnessStore.getState().sessionSlots[sessionId];
    if (!slot) {
      return;
    }

    if (
      slot.streamConnectionState === "connecting"
      || slot.streamConnectionState === "open"
    ) {
      return;
    }

    if (!options?.skipInitialRefresh) {
      await refreshSessionSlotMeta(sessionId, {
        resumeIfActive: options?.resumeIfActive ?? true,
        requestHeaders: options?.requestHeaders,
      });
    }

    const refreshedSlot = useHarnessStore.getState().sessionSlots[sessionId];
    if (shouldSkipColdIdleSessionStream(refreshedSlot, options?.allowColdIdleNoStream)) {
      return;
    }

    closeSessionSlotStream(sessionId);

    const currentSlot = useHarnessStore.getState().sessionSlots[sessionId];
    const afterSeq = currentSlot?.transcript.lastSeq ?? 0;
    const connectStartedAt = performance.now();
    let handle: SessionStreamHandle | null = null;

    let openResolved = false;
    let resolveOpen: (() => void) | null = null;
    let startupReadyRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let startupReadyRefreshStarted = false;
    const openPromise = new Promise<void>((resolve) => {
      resolveOpen = () => {
        if (openResolved) {
          return;
        }
        openResolved = true;
        resolve();
      };
    });

    const scheduleStartupReadyRefresh = (
      reason: "stream_open" | "available_commands",
      delayMs: number,
    ) => {
      if (!options?.refreshOnStartupReady || startupReadyRefreshStarted) {
        return;
      }
      if (startupReadyRefreshTimer) {
        clearTimeout(startupReadyRefreshTimer);
      }
      startupReadyRefreshTimer = setTimeout(() => {
        startupReadyRefreshTimer = null;
        if (startupReadyRefreshStarted) {
          return;
        }
        startupReadyRefreshStarted = true;
        const refreshStartedAt = performance.now();
        void refreshSessionSlotMeta(sessionId, {
          resumeIfActive: false,
          requestHeaders: options?.requestHeaders,
        }).then(() => {
          logLatency("session.stream.startup_meta_refreshed", {
            sessionId,
            reason,
            elapsedMs: Math.round(performance.now() - refreshStartedAt),
          });
        }).catch(() => {
          logLatency("session.stream.startup_meta_refresh_failed", {
            sessionId,
            reason,
            elapsedMs: Math.round(performance.now() - refreshStartedAt),
          });
        });
      }, delayMs);
    };
    const clearStartupReadyRefreshTimer = () => {
      if (!startupReadyRefreshTimer) {
        return;
      }
      clearTimeout(startupReadyRefreshTimer);
      startupReadyRefreshTimer = null;
    };

    const scheduleReconnect = (delayMs = 350) => {
      clearSessionReconnectTimer(sessionId);
      if (!shouldReconnectStream(sessionId)) {
        return;
      }

      scheduleSessionReconnectTimer(sessionId, () => {
        if (!shouldReconnectStream(sessionId)) {
          return;
        }

        void refreshSessionSlotMeta(sessionId, { resumeIfActive: true })
          .finally(() => {
            void ensureSessionStreamConnected(sessionId);
          });
      }, delayMs);
    };

    await openSessionStream(sessionId, {
      afterSeq,
      requestHeaders: options?.requestHeaders,
      onHandle: (nextHandle) => {
        handle = nextHandle;
        useHarnessStore.getState().patchSessionSlot(sessionId, {
          sseHandle: nextHandle,
          streamConnectionState: "connecting",
        });
      },
      onOpen: () => {
        if (!handle || !isCurrentStreamHandle(sessionId, handle)) {
          return;
        }
        useHarnessStore.getState().patchSessionSlot(sessionId, {
          streamConnectionState: "open",
        });
        markLatencyFlowLiveAttached(sessionId);
        logLatency("session.stream.open", {
          sessionId,
          elapsedMs: Math.round(performance.now() - connectStartedAt),
        });
        scheduleStartupReadyRefresh("stream_open", 3500);
        resolveOpen?.();
      },
      onEvent: (envelope) => {
        if (!handle || !isCurrentStreamHandle(sessionId, handle)) {
          return;
        }

        const currentState = useHarnessStore.getState();
        const slotState = currentState.sessionSlots[sessionId];
        if (!slotState) {
          return;
        }

        const result = applyStreamEnvelope(
          {
            events: slotState.events,
            transcript: slotState.transcript,
          },
          envelope,
        );

        if (result.status === "duplicate") {
          logDevSSEEvent(sessionId, envelope, "duplicate");
          return;
        }

        if (result.status === "gap") {
          logDevSSEEvent(sessionId, envelope, "gap");
          useHarnessStore.getState().patchSessionSlot(sessionId, {
            sseHandle: null,
            streamConnectionState: "disconnected",
          });
          handle.close();
          scheduleReconnect(0);
          return;
        }

        logDevSSEEvent(sessionId, envelope, "applied");
        const event = envelope.event;
        if (event.type === "available_commands_update") {
          scheduleStartupReadyRefresh("available_commands", 0);
        }
        if (event.type === "turn_started" || event.type === "session_ended") {
          clearPendingConfigRollbackCheck(sessionId);
        }

        const patch = buildSessionStreamPatch({
          slot: slotState,
          nextTranscript: result.state.transcript,
          envelope,
        });
        const reconcileResult = event.type === "config_option_update"
          ? reconcilePendingConfigChanges(
            event.liveConfig,
            slotState.pendingConfigChanges,
          )
          : {
            pendingConfigChanges: slotState.pendingConfigChanges,
            reconciledChanges: [] as PendingSessionConfigChange[],
          };

        useHarnessStore.getState().patchSessionSlot(sessionId, {
          events: result.state.events,
          ...patch,
          optimisticPrompt: shouldClearOptimisticPendingPrompt(event.type)
            ? null
            : slotState.optimisticPrompt,
          pendingConfigChanges: reconcileResult.pendingConfigChanges,
        });

        if (event.type === "subagent_turn_completed") {
          void mountSubagentChildSession({
            childSessionId: event.childSessionId,
            label: event.label ?? null,
            workspaceId: slotState.workspaceId,
            requestHeaders: options?.requestHeaders,
          });
          void queryClient.invalidateQueries({
            queryKey: anyHarnessSessionSubagentsKey(
              currentState.runtimeUrl,
              slotState.workspaceId,
              sessionId,
            ),
          });
        }

        if (
          event.type === "session_link_turn_completed"
          && event.relation === "cowork_coding_session"
        ) {
          void queryClient.invalidateQueries({
            queryKey: anyHarnessCoworkManagedWorkspacesKey(
              currentState.runtimeUrl,
              sessionId,
            ),
          });
        }

        if (event.type === "review_run_updated") {
          void queryClient.invalidateQueries({
            queryKey: anyHarnessSessionReviewsKey(
              currentState.runtimeUrl,
              slotState.workspaceId,
              event.parentSessionId,
            ),
          });
        }

        if (event.type === "item_completed" && envelope.itemId) {
          const item = result.state.transcript.itemsById[envelope.itemId];
          if (item?.kind === "tool_call" && isSubagentMcpMutation(item)) {
            const launchResult = parseSubagentLaunchResult(item);
            const display = resolveSubagentLaunchDisplay(item);
            if (launchResult?.childSessionId) {
              void mountSubagentChildSession({
                childSessionId: launchResult.childSessionId,
                label: display.title,
                workspaceId: slotState.workspaceId,
                requestHeaders: options?.requestHeaders,
              });
            }
            void queryClient.invalidateQueries({
              queryKey: anyHarnessSessionSubagentsKey(
                currentState.runtimeUrl,
                slotState.workspaceId,
                sessionId,
              ),
            });
          }
          if (
            item?.kind === "tool_call"
            && item.status === "completed"
            && isCoworkCodingCreateMcpMutation(item)
          ) {
            void queryClient.invalidateQueries({
              queryKey: anyHarnessCoworkManagedWorkspacesKey(
                currentState.runtimeUrl,
                sessionId,
              ),
            });
            void queryClient.invalidateQueries({
              queryKey: workspaceCollectionsScopeKey(currentState.runtimeUrl),
            });
          }
        }

        if (reconcileResult.reconciledChanges.length > 0) {
          persistReconciledModePreferences(
            slotState.workspaceId,
            slotState.agentKind,
            event.type === "config_option_update"
              ? event.liveConfig.normalizedControls.mode?.rawConfigId ?? null
              : null,
            reconcileResult.reconciledChanges,
            (rawConfigId) => (
              event.type === "config_option_update"
                ? getAuthoritativeConfigValue(event.liveConfig, rawConfigId)
                : null
            ),
          );
        }

        if (!hasQueuedPendingConfigChanges(reconcileResult.pendingConfigChanges)) {
          clearPendingConfigRollbackCheck(sessionId);
        }

        if (
          event.type === "turn_started"
          || event.type === "interaction_requested"
          || event.type === "interaction_resolved"
          || event.type === "turn_ended"
          || event.type === "error"
          || event.type === "session_ended"
        ) {
          void queryClient.invalidateQueries({
            queryKey: workspaceCollectionsScopeKey(currentState.runtimeUrl),
          });
        }

        if (event.type === "turn_ended" || event.type === "error") {
          if (hasQueuedPendingConfigChanges(reconcileResult.pendingConfigChanges)) {
            schedulePendingConfigRollbackCheck(
              sessionId,
              refreshSessionSlotMeta,
              showToast,
            );
          }

          if (slotState.workspaceId) {
            void queryClient.invalidateQueries({
              queryKey: anyHarnessGitStatusKey(
                currentState.runtimeUrl,
                slotState.workspaceId,
              ),
            });
            trackWorkspaceInteraction(slotState.workspaceId, envelope.timestamp);
            if (slotState.workspaceId === currentState.selectedWorkspaceId) {
              markWorkspaceViewed(slotState.workspaceId);
            }
          }

          notifyTurnEnd(sessionId, event.type);
        }
      },
      onError: () => {
        resolveOpen?.();
        clearStartupReadyRefreshTimer();
        if (!handle || !isCurrentStreamHandle(sessionId, handle)) {
          return;
        }
        useHarnessStore.getState().patchSessionSlot(sessionId, {
          sseHandle: null,
          streamConnectionState: "disconnected",
        });
        scheduleReconnect();
      },
      onClose: () => {
        resolveOpen?.();
        clearStartupReadyRefreshTimer();
        if (!handle || !isCurrentStreamHandle(sessionId, handle)) {
          return;
        }

        useHarnessStore.getState().patchSessionSlot(sessionId, {
          sseHandle: null,
          streamConnectionState: "ended",
        });
        if (shouldReconnectStream(sessionId)) {
          scheduleReconnect();
        }
      },
    });

    if (!options?.awaitOpen) {
      return;
    }

    await Promise.race([
      openPromise,
      new Promise<void>((resolve) => {
        setTimeout(resolve, options?.openTimeoutMs ?? 2500);
      }),
    ]);
  }, [
    closeSessionSlotStream,
    mountSubagentChildSession,
    persistReconciledModePreferences,
    queryClient,
    refreshSessionSlotMeta,
    rehydrateSessionSlotFromHistory,
    showToast,
  ]);

  return {
    activateSession,
    applySessionSummary,
    closeSessionSlotStream,
    ensureSessionStreamConnected,
    rehydrateSessionSlotFromHistory,
    refreshSessionSlotMeta,
  };
}

function isSubagentMcpMutation(item: ToolCallItem): boolean {
  const nativeToolName = item.nativeToolName?.trim().toLowerCase();
  return nativeToolName === "mcp__subagents__create_subagent"
    || nativeToolName === "mcp__subagents__send_subagent_message"
    || nativeToolName === "mcp__subagents__schedule_subagent_wake";
}

function isCoworkCodingCreateMcpMutation(item: ToolCallItem): boolean {
  const nativeToolName = item.nativeToolName?.trim().toLowerCase();
  return nativeToolName === "mcp__cowork__create_coding_workspace"
    || nativeToolName === "mcp__cowork__create_coding_session"
    || nativeToolName === "mcp__cowork__send_coding_message"
    || nativeToolName === "mcp__cowork__schedule_coding_wake";
}
