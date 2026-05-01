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
  type SessionEventEnvelope,
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
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  recordMeasurementMetric,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
  type MeasurementOperationId,
} from "@/lib/infra/debug-measurement";
import { markLatencyFlowLiveAttached } from "@/lib/infra/latency-flow";
import {
  resolveSessionViewState,
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

const ACTIVE_SUMMARY_REFRESH_DELAY_MS = 8_000;

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

    const resolvedWorkspaceId = existing.workspaceId ?? workspaceId;
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

    const interactionTimestamp =
      patch.executionSummary?.updatedAt
      ?? session.updatedAt
      ?? session.lastPromptAt
      ?? null;
    if (resolvedWorkspaceId && interactionTimestamp) {
      trackWorkspaceInteraction(resolvedWorkspaceId, interactionTimestamp);
    }

    persistReconciledModePreferences(
      resolvedWorkspaceId,
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
      beforeSeq?: number;
      limit?: number;
      turnLimit?: number;
      replace?: boolean;
      requestHeaders?: HeadersInit;
      measurementOperationId?: MeasurementOperationId | null;
      timeoutMs?: number;
      isCurrent?: () => boolean;
    },
  ): Promise<boolean> => {
    const startedAt = performance.now();
    try {
      if (options?.isCurrent && !options.isCurrent()) {
        return false;
      }
      const slot = useHarnessStore.getState().sessionSlots[sessionId];
      if (!slot) {
        return false;
      }

      const afterSeq = options?.replace ? undefined : options?.afterSeq;
      const beforeSeq = options?.replace || afterSeq != null ? undefined : options?.beforeSeq;
      const events = await fetchSessionHistory(
        sessionId,
        afterSeq != null
          || beforeSeq != null
          || options?.limit != null
          || options?.turnLimit != null
          || options?.requestHeaders
          || options?.measurementOperationId
          || options?.timeoutMs != null
          ? {
            ...(afterSeq != null ? { afterSeq } : {}),
            ...(beforeSeq != null ? { beforeSeq } : {}),
            ...(options?.limit != null ? { limit: options.limit } : {}),
            ...(options?.turnLimit != null ? { turnLimit: options.turnLimit } : {}),
            ...(options?.requestHeaders
              ? { requestHeaders: options.requestHeaders }
              : {}),
            ...(options?.measurementOperationId
              ? { measurementOperationId: options.measurementOperationId }
              : {}),
            ...(options?.timeoutMs != null ? { timeoutMs: options.timeoutMs } : {}),
          }
          : undefined,
      );
      const currentSlot = useHarnessStore.getState().sessionSlots[sessionId];
      if (!currentSlot || (options?.isCurrent && !options.isCurrent())) {
        return false;
      }

      if (afterSeq != null) {
        const replayStartedAt = performance.now();
        const nextState = appendHistoryTail(
          {
            events: currentSlot.events,
            transcript: currentSlot.transcript,
          },
          events,
        );
        if (options?.measurementOperationId) {
          recordMeasurementMetric({
            type: "reducer",
            category: "session.events.list",
            operationId: options.measurementOperationId,
            durationMs: performance.now() - replayStartedAt,
            count: events.length,
          });
          recordMeasurementWorkflowStep({
            operationId: options.measurementOperationId,
            step: "session.history.replay",
            startedAt: replayStartedAt,
            count: events.length,
          });
        }

        if (!nextState.applied) {
          return false;
        }

        const storeStartedAt = performance.now();
        useHarnessStore.getState().patchSessionSlot(sessionId, {
          events: nextState.state.events,
          transcript: nextState.state.transcript,
          status: resolveSessionStatus(currentSlot.status, {
            executionSummary: currentSlot.executionSummary,
            streamConnectionState: currentSlot.streamConnectionState,
            transcript: nextState.state.transcript,
          }),
        });
        if (options?.measurementOperationId) {
          recordMeasurementMetric({
            type: "store",
            category: "session.events.list",
            operationId: options.measurementOperationId,
            durationMs: performance.now() - storeStartedAt,
          });
          recordMeasurementWorkflowStep({
            operationId: options.measurementOperationId,
            step: "session.history.store",
            startedAt: storeStartedAt,
          });
        }
        const mountStartedAt = performance.now();
        mountSubagentChildrenFromEvents(
          currentSlot.workspaceId,
          events,
          options?.requestHeaders,
        );
        recordMeasurementWorkflowStep({
          operationId: options?.measurementOperationId,
          step: "session.history.mount_subagents",
          startedAt: mountStartedAt,
        });
        logLatency("session.history.rehydrate.success", {
          sessionId,
          eventCount: events.length,
          appended: true,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
        return true;
      }

      if (beforeSeq != null) {
        const replayStartedAt = performance.now();
        const replacementEvents = mergeFetchedHistoryWithExistingEvents(
          events,
          currentSlot.events,
        );
        const nextState = replaySessionHistory(sessionId, replacementEvents);
        if (options?.measurementOperationId) {
          recordMeasurementMetric({
            type: "reducer",
            category: "session.events.list",
            operationId: options.measurementOperationId,
            durationMs: performance.now() - replayStartedAt,
            count: events.length,
          });
          recordMeasurementWorkflowStep({
            operationId: options.measurementOperationId,
            step: "session.history.replay",
            startedAt: replayStartedAt,
            count: events.length,
          });
        }

        const storeStartedAt = performance.now();
        useHarnessStore.getState().patchSessionSlot(sessionId, {
          events: replacementEvents,
          transcript: nextState.transcript,
          status: resolveSessionStatus(currentSlot.status, {
            executionSummary: currentSlot.executionSummary,
            streamConnectionState: currentSlot.streamConnectionState,
            transcript: nextState.transcript,
          }),
        });
        if (options?.measurementOperationId) {
          recordMeasurementMetric({
            type: "store",
            category: "session.events.list",
            operationId: options.measurementOperationId,
            durationMs: performance.now() - storeStartedAt,
          });
          recordMeasurementWorkflowStep({
            operationId: options.measurementOperationId,
            step: "session.history.store",
            startedAt: storeStartedAt,
          });
        }
        const mountStartedAt = performance.now();
        mountSubagentChildrenFromEvents(
          currentSlot.workspaceId,
          events,
          options?.requestHeaders,
        );
        recordMeasurementWorkflowStep({
          operationId: options?.measurementOperationId,
          step: "session.history.mount_subagents",
          startedAt: mountStartedAt,
        });
        logLatency("session.history.rehydrate.success", {
          sessionId,
          eventCount: events.length,
          prepended: true,
          totalEventCount: replacementEvents.length,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
        return events.length > 0;
      }

      const replayStartedAt = performance.now();
      const replacementEvents = options?.replace
        ? mergeFetchedHistoryWithNewerEvents(events, currentSlot.events)
        : events;
      const nextState = replaySessionHistory(sessionId, replacementEvents);
      if (options?.measurementOperationId) {
        recordMeasurementMetric({
          type: "reducer",
          category: "session.events.list",
          operationId: options.measurementOperationId,
          durationMs: performance.now() - replayStartedAt,
          count: replacementEvents.length,
        });
        recordMeasurementWorkflowStep({
          operationId: options.measurementOperationId,
          step: "session.history.replay",
          startedAt: replayStartedAt,
          count: replacementEvents.length,
        });
      }
      const storeStartedAt = performance.now();
      useHarnessStore.getState().patchSessionSlot(sessionId, {
        events: nextState.events,
        transcript: nextState.transcript,
        status: resolveSessionStatus(currentSlot.status, {
          executionSummary: currentSlot.executionSummary,
          streamConnectionState: currentSlot.streamConnectionState,
          transcript: nextState.transcript,
        }),
      });
      if (options?.measurementOperationId) {
        recordMeasurementMetric({
          type: "store",
          category: "session.events.list",
          operationId: options.measurementOperationId,
          durationMs: performance.now() - storeStartedAt,
        });
        recordMeasurementWorkflowStep({
          operationId: options.measurementOperationId,
          step: "session.history.store",
          startedAt: storeStartedAt,
        });
      }
      const mountStartedAt = performance.now();
      mountSubagentChildrenFromEvents(
        currentSlot.workspaceId,
        replacementEvents,
        options?.requestHeaders,
      );
      recordMeasurementWorkflowStep({
        operationId: options?.measurementOperationId,
        step: "session.history.mount_subagents",
        startedAt: mountStartedAt,
      });
      logLatency("session.history.rehydrate.success", {
        sessionId,
        eventCount: replacementEvents.length,
        appended: false,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
      return true;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.debug("[session-runtime] session history rehydrate failed", error);
      }
      logLatency("session.history.rehydrate.failed", {
        sessionId,
        afterSeq: options?.afterSeq ?? null,
        beforeSeq: options?.beforeSeq ?? null,
        limit: options?.limit ?? null,
        turnLimit: options?.turnLimit ?? null,
        timeoutMs: options?.timeoutMs ?? null,
        elapsedMs: Math.round(performance.now() - startedAt),
        errorName: error instanceof Error ? error.name : "unknown",
      });
      return false;
    }
  }, [mountSubagentChildrenFromEvents]);

  const refreshSessionSlotMeta = useCallback(async (
    sessionId: string,
    options?: {
      resumeIfActive?: boolean;
      requestHeaders?: HeadersInit;
      measurementOperationId?: MeasurementOperationId | null;
      isCurrent?: () => boolean;
    },
  ): Promise<void> => {
    try {
      if (options?.isCurrent && !options.isCurrent()) {
        return;
      }
      const { workspaceId } = await getSessionClientAndWorkspace(sessionId);
      let session = await fetchSessionSummary(sessionId, {
        requestHeaders: options?.requestHeaders,
        measurementOperationId: options?.measurementOperationId,
      });
      if (options?.isCurrent && !options.isCurrent()) {
        return;
      }
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
          measurementOperationId: options?.measurementOperationId,
        });
        if (options?.isCurrent && !options.isCurrent()) {
          return;
        }
        applySessionSummary(sessionId, session, workspaceId);
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.debug("[session-runtime] session metadata refresh failed", error);
      }
    }
  }, [applySessionSummary, pluginsInCodingSessionsEnabled]);

  const closeSessionSlotStream = useCallback((sessionId: string) => {
    clearSessionReconnectTimer(sessionId);
    const slot = useHarnessStore.getState().sessionSlots[sessionId];
    if (slot) {
      const handle = slot.sseHandle;
      useHarnessStore.getState().patchSessionSlot(sessionId, {
        sseHandle: null,
        streamConnectionState: "disconnected",
      });
      handle?.close();
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
      measurementOperationId?: MeasurementOperationId | null;
      isCurrent?: () => boolean;
    },
  ): Promise<void> => {
    if (options?.isCurrent && !options.isCurrent()) {
      return;
    }
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
      const hydrateStartedAt = performance.now();
      await rehydrateSessionSlotFromHistory(sessionId, {
        requestHeaders: options?.requestHeaders,
        measurementOperationId: options?.measurementOperationId,
        isCurrent: options?.isCurrent,
      });
      if (options?.isCurrent && !options.isCurrent()) {
        return;
      }
      useHarnessStore.getState().patchSessionSlot(sessionId, {
        transcriptHydrated: true,
      });
      recordMeasurementWorkflowStep({
        operationId: options?.measurementOperationId,
        step: "session.stream.initial_history_hydrate",
        startedAt: hydrateStartedAt,
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
      const refreshStartedAt = performance.now();
      await refreshSessionSlotMeta(sessionId, {
        resumeIfActive: options?.resumeIfActive ?? true,
        requestHeaders: options?.requestHeaders,
        measurementOperationId: options?.measurementOperationId,
        isCurrent: options?.isCurrent,
      });
      if (options?.isCurrent && !options.isCurrent()) {
        return;
      }
      recordMeasurementWorkflowStep({
        operationId: options?.measurementOperationId,
        step: "session.stream.initial_refresh",
        startedAt: refreshStartedAt,
      });
    }

    const refreshedSlot = useHarnessStore.getState().sessionSlots[sessionId];
    if (options?.isCurrent && !options.isCurrent()) {
      return;
    }
    if (shouldSkipColdIdleSessionStream(refreshedSlot, options?.allowColdIdleNoStream)) {
      recordMeasurementMetric({
        type: "workflow",
        operationId: options?.measurementOperationId ?? undefined,
        step: "session.stream.skip_cold_idle",
        durationMs: 0,
        outcome: "skipped",
      });
      return;
    }

    closeSessionSlotStream(sessionId);
    if (options?.isCurrent && !options.isCurrent()) {
      return;
    }

    const currentSlot = useHarnessStore.getState().sessionSlots[sessionId];
    const afterSeq = currentSlot?.transcript.lastSeq ?? 0;
    const connectStartedAt = performance.now();
    const standaloneStreamMeasurementOperationId = startMeasurementOperation({
      kind: "session_stream_sample",
      sampleKey: "stream",
      surfaces: [
        "session-transcript-pane",
        "transcript-list",
        "header-tabs",
        "workspace-sidebar",
        "global-header",
        "chat-composer-dock",
      ],
      maxDurationMs: 30_000,
    });
    const streamMeasurementOperationId = standaloneStreamMeasurementOperationId;
    let handle: SessionStreamHandle | null = null;
    const isStillCurrent = () => !options?.isCurrent || options.isCurrent();

    let openResolved = false;
    let resolveOpen: (() => void) | null = null;
    let startupReadyRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let activeSummaryRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let startupReadyRefreshStarted = false;
    let streamConnectMeasurementFinished = false;
    const openPromise = new Promise<void>((resolve) => {
      resolveOpen = () => {
        if (openResolved) {
          return;
        }
        openResolved = true;
        resolve();
      };
    });
    const finishStreamConnectMeasurement = (reason: "completed" | "aborted") => {
      if (streamConnectMeasurementFinished) {
        return;
      }
      streamConnectMeasurementFinished = true;
      finishOrCancelMeasurementOperation(
        standaloneStreamMeasurementOperationId,
        reason,
      );
    };

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
          measurementOperationId: streamMeasurementOperationId,
          isCurrent: options?.isCurrent,
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
    const clearActiveSummaryRefreshTimer = () => {
      if (!activeSummaryRefreshTimer) {
        return;
      }
      clearTimeout(activeSummaryRefreshTimer);
      activeSummaryRefreshTimer = null;
    };
    const shouldRefreshActiveSummary = () => {
      if (!isStillCurrent()) {
        return false;
      }
      const latestSlot = useHarnessStore.getState().sessionSlots[sessionId] ?? null;
      return resolveSessionViewState(latestSlot) === "working";
    };
    const scheduleActiveSummaryRefresh = () => {
      clearActiveSummaryRefreshTimer();
      if (!shouldRefreshActiveSummary()) {
        return;
      }

      activeSummaryRefreshTimer = setTimeout(() => {
        activeSummaryRefreshTimer = null;
        if (!handle || !isCurrentStreamHandle(sessionId, handle)) {
          return;
        }
        if (!shouldRefreshActiveSummary()) {
          return;
        }

        const refreshStartedAt = performance.now();
        void refreshSessionSlotMeta(sessionId, {
          resumeIfActive: false,
          requestHeaders: options?.requestHeaders,
          measurementOperationId: streamMeasurementOperationId,
          isCurrent: options?.isCurrent,
        }).then(() => {
          logLatency("session.stream.active_meta_refreshed", {
            sessionId,
            elapsedMs: Math.round(performance.now() - refreshStartedAt),
          });
        }).catch(() => {
          logLatency("session.stream.active_meta_refresh_failed", {
            sessionId,
            elapsedMs: Math.round(performance.now() - refreshStartedAt),
          });
        }).finally(() => {
          if (handle && isCurrentStreamHandle(sessionId, handle) && shouldRefreshActiveSummary()) {
            scheduleActiveSummaryRefresh();
          }
        });
      }, ACTIVE_SUMMARY_REFRESH_DELAY_MS);
    };

    const scheduleReconnect = (delayMs = 350) => {
      clearSessionReconnectTimer(sessionId);
      if (!isStillCurrent() || !shouldReconnectStream(sessionId)) {
        return;
      }

      scheduleSessionReconnectTimer(sessionId, () => {
        if (!isStillCurrent() || !shouldReconnectStream(sessionId)) {
          return;
        }

        void refreshSessionSlotMeta(sessionId, {
          resumeIfActive: true,
          isCurrent: options?.isCurrent,
        })
          .finally(() => {
            if (isStillCurrent()) {
              void ensureSessionStreamConnected(sessionId, {
                isCurrent: options?.isCurrent,
              });
            }
          });
      }, delayMs);
    };

    await openSessionStream(sessionId, {
      afterSeq,
      requestHeaders: options?.requestHeaders,
      measurementOperationId: streamMeasurementOperationId ?? undefined,
      onHandle: (nextHandle) => {
        if (!isStillCurrent()) {
          nextHandle.close();
          return;
        }
        handle = nextHandle;
        useHarnessStore.getState().patchSessionSlot(sessionId, {
          sseHandle: nextHandle,
          streamConnectionState: "connecting",
        });
      },
      onOpen: () => {
        if (!isStillCurrent() || !handle || !isCurrentStreamHandle(sessionId, handle)) {
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
        recordMeasurementWorkflowStep({
          operationId: streamMeasurementOperationId,
          step: "session.stream.open",
          startedAt: connectStartedAt,
        });
        scheduleStartupReadyRefresh("stream_open", 3500);
        resolveOpen?.();
        finishStreamConnectMeasurement("completed");
      },
      onEvent: (envelope) => {
        if (!isStillCurrent() || !handle || !isCurrentStreamHandle(sessionId, handle)) {
          return;
        }

        const currentState = useHarnessStore.getState();
        const slotState = currentState.sessionSlots[sessionId];
        if (!slotState) {
          return;
        }

        const reducerStartedAt = performance.now();
        const result = applyStreamEnvelope(
          {
            events: slotState.events,
            transcript: slotState.transcript,
          },
          envelope,
        );
        if (streamMeasurementOperationId) {
          recordMeasurementMetric({
            type: "reducer",
            category: "session.stream",
            operationId: streamMeasurementOperationId,
            durationMs: performance.now() - reducerStartedAt,
          });
        }

        if (result.status === "duplicate") {
          logDevSSEEvent(sessionId, envelope, "duplicate");
          return;
        }

        if (result.status === "gap") {
          logDevSSEEvent(sessionId, envelope, "gap");
          clearActiveSummaryRefreshTimer();
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

        const storeStartedAt = performance.now();
        useHarnessStore.getState().patchSessionSlot(sessionId, {
          events: result.state.events,
          ...patch,
          optimisticPrompt: shouldClearOptimisticPendingPrompt(event.type)
            ? null
            : slotState.optimisticPrompt,
          pendingConfigChanges: reconcileResult.pendingConfigChanges,
        });
        if (streamMeasurementOperationId) {
          recordMeasurementMetric({
            type: "store",
            category: "session.stream",
            operationId: streamMeasurementOperationId,
            durationMs: performance.now() - storeStartedAt,
          });
          markOperationForNextCommit(streamMeasurementOperationId, [
            "session-transcript-pane",
            "transcript-list",
            "header-tabs",
            "workspace-sidebar",
            "global-header",
            "chat-composer-dock",
          ]);
        }

        if (shouldScheduleActiveSummaryRefresh(event.type)) {
          scheduleActiveSummaryRefresh();
        }
        if (
          event.type === "turn_ended"
          || event.type === "error"
          || event.type === "session_ended"
        ) {
          clearActiveSummaryRefreshTimer();
        }

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

        if (slotState.workspaceId && shouldTrackWorkspaceWorkActivity(event.type)) {
          trackWorkspaceInteraction(slotState.workspaceId, envelope.timestamp);
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
          }

          notifyTurnEnd(sessionId, event.type);
        }
      },
      onError: () => {
        finishStreamConnectMeasurement("aborted");
        resolveOpen?.();
        clearStartupReadyRefreshTimer();
        clearActiveSummaryRefreshTimer();
        if (!isStillCurrent() || !handle || !isCurrentStreamHandle(sessionId, handle)) {
          return;
        }
        useHarnessStore.getState().patchSessionSlot(sessionId, {
          sseHandle: null,
          streamConnectionState: "disconnected",
        });
        scheduleReconnect();
      },
      onClose: () => {
        finishStreamConnectMeasurement(openResolved ? "completed" : "aborted");
        resolveOpen?.();
        clearStartupReadyRefreshTimer();
        clearActiveSummaryRefreshTimer();
        if (!isStillCurrent() || !handle || !isCurrentStreamHandle(sessionId, handle)) {
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
    if (!isStillCurrent()) {
      return;
    }
    recordMeasurementWorkflowStep({
      operationId: streamMeasurementOperationId,
      step: "session.stream.open_handle",
      startedAt: connectStartedAt,
    });
    recordMeasurementWorkflowStep({
      operationId: options?.measurementOperationId,
      step: "session.stream.open_handle",
      startedAt: connectStartedAt,
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

function mergeFetchedHistoryWithNewerEvents(
  fetchedEvents: SessionEventEnvelope[],
  currentEvents: SessionEventEnvelope[],
): SessionEventEnvelope[] {
  const fetchedLastSeq = fetchedEvents.length > 0
    ? fetchedEvents[fetchedEvents.length - 1]?.seq ?? 0
    : 0;
  if (fetchedLastSeq <= 0) {
    return fetchedEvents;
  }

  const newerEvents = currentEvents.filter((event) => event.seq > fetchedLastSeq);
  if (newerEvents.length === 0) {
    return fetchedEvents;
  }

  return [...fetchedEvents, ...newerEvents].sort((a, b) => a.seq - b.seq);
}

function mergeFetchedHistoryWithExistingEvents(
  fetchedEvents: SessionEventEnvelope[],
  currentEvents: SessionEventEnvelope[],
): SessionEventEnvelope[] {
  if (fetchedEvents.length === 0) {
    return currentEvents;
  }

  const eventsBySeq = new Map<number, SessionEventEnvelope>();
  for (const event of currentEvents) {
    eventsBySeq.set(event.seq, event);
  }
  for (const event of fetchedEvents) {
    eventsBySeq.set(event.seq, event);
  }

  return Array.from(eventsBySeq.values()).sort((a, b) => a.seq - b.seq);
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

function shouldScheduleActiveSummaryRefresh(eventType: string): boolean {
  switch (eventType) {
    case "turn_started":
    case "item_started":
    case "item_delta":
    case "item_completed":
    case "usage_update":
    case "interaction_resolved":
      return true;
    default:
      return false;
  }
}

function shouldTrackWorkspaceWorkActivity(eventType: string): boolean {
  switch (eventType) {
    case "turn_started":
    case "item_started":
    case "item_completed":
    case "interaction_requested":
    case "interaction_resolved":
    case "turn_ended":
    case "error":
    case "session_ended":
    case "subagent_turn_completed":
    case "session_link_turn_completed":
    case "review_run_updated":
      return true;
    default:
      return false;
  }
}
