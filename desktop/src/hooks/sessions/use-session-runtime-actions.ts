import {
  appendHistoryTail,
  replaySessionHistory,
} from "@/lib/integrations/anyharness/session-stream-state";
import {
  createTranscriptState,
  type Session,
  type SessionEventEnvelope,
  type SessionStreamHandle,
  type TranscriptState,
} from "@anyharness/sdk";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  fetchSessionHistory,
  fetchSessionSummary,
  getSessionClientAndWorkspace,
  openSessionStream,
  resumeSession,
  type FlushAwareSessionStreamHandle,
} from "@/lib/integrations/anyharness/session-runtime";
import { logLatency } from "@/lib/infra/debug-latency";
import {
  finishOrCancelMeasurementOperation,
  markOperationForNextCommit,
  recordMeasurementMetric,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
  type MeasurementOperationId,
  type MeasurementOperationKind,
  type MeasurementSurface,
} from "@/lib/infra/debug-measurement";
import { scheduleAfterNextPaint } from "@/lib/infra/schedule-after-next-paint";
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
import { shouldClearOptimisticPromptAfterSessionSummary } from "@/lib/domain/chat/pending-prompts";
import { buildSessionSlotPatchFromSummary } from "@/lib/domain/sessions/summary";
import {
  clearSessionReconnectTimer,
  scheduleSessionReconnectTimer,
} from "@/lib/integrations/anyharness/session-reconnect-state";
import {
  rememberLastViewedSession,
  trackWorkspaceInteraction,
} from "@/stores/preferences/workspace-ui-store";
import { resolveWorkspaceUiKey } from "@/lib/domain/workspaces/workspace-ui-key";
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
} from "@/hooks/sessions/session-runtime-pending-config";
import { useLinkedSessionMounting } from "@/hooks/chat/subagents/use-linked-session-mounting";
import {
  useSessionStreamFlushControllerFactory,
  type SessionStreamFlushController,
} from "@/hooks/sessions/use-session-stream-flush";
import { batchSessionStoreWrites } from "@/lib/infra/react-batching";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import {
  activityFromTranscript,
  activitySnapshotFromDirectoryEntry,
  useSessionDirectoryStore,
} from "@/stores/sessions/session-directory-store";
import {
  getMaterializedSessionId,
  getSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionIngestStore } from "@/stores/sessions/session-ingest-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import {
  clearSessionStreamHandle,
  closeSessionStreamHandle,
  setSessionStreamHandle,
} from "@/lib/integrations/anyharness/session-stream-handles";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";

const ACTIVE_SUMMARY_REFRESH_DELAY_MS = 8_000;
const SESSION_APPLY_MEASUREMENT_SURFACES: readonly MeasurementSurface[] = [
  "session-transcript-pane",
  "transcript-list",
  "chat-surface",
  "header-tabs",
  "workspace-sidebar",
  "global-header",
  "chat-composer-dock",
];
const SESSION_HISTORY_APPLY_MAX_DURATION_MS = 30_000;

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
    useSessionSelectionStore.getState().setActiveSessionId(sessionId);
    if (!sessionId) {
      return;
    }

    const entry = useSessionDirectoryStore.getState().entriesById[sessionId];
    if (entry?.workspaceId) {
      const selection = useSessionSelectionStore.getState();
      const workspaceUiKey = entry.workspaceId === selection.selectedWorkspaceId
        ? resolveWorkspaceUiKey(
          selection.selectedLogicalWorkspaceId,
          selection.selectedWorkspaceId,
        )
        : entry.workspaceId;
      if (workspaceUiKey) {
        if (entry.materializedSessionId) {
          rememberLastViewedSession(workspaceUiKey, entry.materializedSessionId);
        }
      }
    }
  }, []);

  const applySessionSummary = useCallback((
    sessionId: string,
    session: Session,
    workspaceId: string,
  ) => {
    const existing = getSessionRecord(sessionId);
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
    const nextStatus = resolveSessionStatus(patch.status, {
      executionSummary: patch.executionSummary,
      streamConnectionState: existing.streamConnectionState,
      transcript: nextTranscript,
    });
    batchSessionStoreWrites(() => {
      useSessionDirectoryStore.getState().patchEntry(sessionId, {
        materializedSessionId: session.id,
        agentKind: patch.agentKind,
        workspaceId: patch.workspaceId,
        modelId: shouldApplyConfigFields ? patch.modelId : existing.modelId,
        modeId: shouldApplyConfigFields ? patch.modeId : existing.modeId,
        title: patch.title,
        actionCapabilities: patch.actionCapabilities,
        liveConfig: effectiveLiveConfig,
        executionSummary: patch.executionSummary,
        mcpBindingSummaries: patch.mcpBindingSummaries,
        pendingConfigChanges: reconcileResult.pendingConfigChanges,
        status: nextStatus,
        lastPromptAt: patch.lastPromptAt,
        activity: activityFromTranscript(nextTranscript, {
          status: nextStatus,
          executionSummary: patch.executionSummary,
        }),
      });
      useSessionTranscriptStore.getState().patchEntry(sessionId, {
        transcript: nextTranscript,
        optimisticPrompt:
          shouldClearOptimisticPromptAfterSessionSummary(patch.status)
            ? null
            : existing.optimisticPrompt,
      });
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
    let standaloneMeasurementOperationId: MeasurementOperationId | null = null;
    try {
      if (options?.isCurrent && !options.isCurrent()) {
        return false;
      }
      const slot = getSessionRecord(sessionId);
      if (!slot) {
        return false;
      }

      const afterSeq = options?.replace ? undefined : options?.afterSeq;
      const beforeSeq = options?.replace || afterSeq != null ? undefined : options?.beforeSeq;
      standaloneMeasurementOperationId = startMeasurementOperation({
        kind: resolveHistoryApplyOperationKind({ afterSeq, beforeSeq }),
        surfaces: SESSION_APPLY_MEASUREMENT_SURFACES,
        maxDurationMs: SESSION_HISTORY_APPLY_MAX_DURATION_MS,
      });
      const requestMeasurementOperationId =
        options?.measurementOperationId ?? standaloneMeasurementOperationId;
      const historyApplyOperationIds = uniqueMeasurementOperationIds([
        options?.measurementOperationId,
        standaloneMeasurementOperationId,
      ]);
      for (const operationId of historyApplyOperationIds) {
        recordHistoryStateCounts(
          operationId,
          "before",
          slot.events,
          slot.transcript,
        );
      }
      const fetchStartedAt = performance.now();
      const events = await fetchSessionHistory(
        sessionId,
        afterSeq != null
          || beforeSeq != null
          || options?.limit != null
          || options?.turnLimit != null
          || options?.requestHeaders
          || requestMeasurementOperationId
          || options?.timeoutMs != null
          ? {
            ...(afterSeq != null ? { afterSeq } : {}),
            ...(beforeSeq != null ? { beforeSeq } : {}),
            ...(options?.limit != null ? { limit: options.limit } : {}),
            ...(options?.turnLimit != null ? { turnLimit: options.turnLimit } : {}),
            ...(options?.requestHeaders
              ? { requestHeaders: options.requestHeaders }
              : {}),
            ...(requestMeasurementOperationId
              ? { measurementOperationId: requestMeasurementOperationId }
              : {}),
            ...(options?.timeoutMs != null ? { timeoutMs: options.timeoutMs } : {}),
          }
          : undefined,
      );
      for (const operationId of historyApplyOperationIds) {
        recordMeasurementWorkflowStep({
          operationId,
          step: "session.history.fetch",
          startedAt: fetchStartedAt,
          count: events.length,
        });
        recordMeasurementMetric({
          type: "state_count",
          operationId,
          target: "session.history.events_fetched",
          count: events.length,
        });
      }
      const currentSlot = getSessionRecord(sessionId);
      if (!currentSlot || (options?.isCurrent && !options.isCurrent())) {
        finishStandaloneApplyOperation(standaloneMeasurementOperationId, "aborted");
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
        for (const operationId of historyApplyOperationIds) {
          recordMeasurementMetric({
            type: "reducer",
            category: "session.events.list",
            operationId,
            durationMs: performance.now() - replayStartedAt,
            count: events.length,
          });
          recordMeasurementWorkflowStep({
            operationId,
            step: "session.history.replay",
            startedAt: replayStartedAt,
            count: events.length,
          });
        }

        if (!nextState.applied) {
          finishStandaloneApplyOperation(standaloneMeasurementOperationId, "completed");
          logLatency("session.history.rehydrate.noop", {
            sessionId,
            eventCount: events.length,
            afterSeq,
            elapsedMs: Math.round(performance.now() - startedAt),
          });
          return true;
        }

        const storeStartedAt = performance.now();
        applyHistoryStateToStores(sessionId, currentSlot, {
          events: nextState.state.events,
          transcript: nextState.state.transcript,
        });
        for (const operationId of historyApplyOperationIds) {
          recordMeasurementMetric({
            type: "store",
            category: "session.events.list",
            operationId,
            durationMs: performance.now() - storeStartedAt,
          });
          recordMeasurementWorkflowStep({
            operationId,
            step: "session.history.store",
            startedAt: storeStartedAt,
          });
        }
        for (const operationId of historyApplyOperationIds) {
          recordHistoryStateCounts(
            operationId,
            "after",
            nextState.state.events,
            nextState.state.transcript,
          );
        }
        const mountStartedAt = performance.now();
        mountSubagentChildrenFromEvents(
          currentSlot.workspaceId,
          events,
          options?.requestHeaders,
        );
        for (const operationId of historyApplyOperationIds) {
          recordMeasurementWorkflowStep({
            operationId,
            step: "session.history.mount_subagents",
            startedAt: mountStartedAt,
          });
          markSessionApplyForNextCommit(operationId);
        }
        finishStandaloneApplyOperation(standaloneMeasurementOperationId, "completed", true);
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
        for (const operationId of historyApplyOperationIds) {
          recordMeasurementMetric({
            type: "reducer",
            category: "session.events.list",
            operationId,
            durationMs: performance.now() - replayStartedAt,
            count: events.length,
          });
          recordMeasurementWorkflowStep({
            operationId,
            step: "session.history.replay",
            startedAt: replayStartedAt,
            count: events.length,
          });
        }

        const storeStartedAt = performance.now();
        applyHistoryStateToStores(sessionId, currentSlot, {
          events: replacementEvents,
          transcript: nextState.transcript,
        });
        for (const operationId of historyApplyOperationIds) {
          recordMeasurementMetric({
            type: "store",
            category: "session.events.list",
            operationId,
            durationMs: performance.now() - storeStartedAt,
          });
          recordMeasurementWorkflowStep({
            operationId,
            step: "session.history.store",
            startedAt: storeStartedAt,
          });
        }
        for (const operationId of historyApplyOperationIds) {
          recordHistoryStateCounts(
            operationId,
            "after",
            replacementEvents,
            nextState.transcript,
          );
        }
        const mountStartedAt = performance.now();
        mountSubagentChildrenFromEvents(
          currentSlot.workspaceId,
          events,
          options?.requestHeaders,
        );
        for (const operationId of historyApplyOperationIds) {
          recordMeasurementWorkflowStep({
            operationId,
            step: "session.history.mount_subagents",
            startedAt: mountStartedAt,
          });
          markSessionApplyForNextCommit(operationId);
        }
        finishStandaloneApplyOperation(standaloneMeasurementOperationId, "completed", true);
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
      for (const operationId of historyApplyOperationIds) {
        recordMeasurementMetric({
          type: "reducer",
          category: "session.events.list",
          operationId,
          durationMs: performance.now() - replayStartedAt,
          count: replacementEvents.length,
        });
        recordMeasurementWorkflowStep({
          operationId,
          step: "session.history.replay",
          startedAt: replayStartedAt,
          count: replacementEvents.length,
        });
      }
      const storeStartedAt = performance.now();
      applyHistoryStateToStores(sessionId, currentSlot, {
        events: nextState.events,
        transcript: nextState.transcript,
      });
      for (const operationId of historyApplyOperationIds) {
        recordMeasurementMetric({
          type: "store",
          category: "session.events.list",
          operationId,
          durationMs: performance.now() - storeStartedAt,
        });
        recordMeasurementWorkflowStep({
          operationId,
          step: "session.history.store",
          startedAt: storeStartedAt,
        });
      }
      for (const operationId of historyApplyOperationIds) {
        recordHistoryStateCounts(
          operationId,
          "after",
          nextState.events,
          nextState.transcript,
        );
      }
      const mountStartedAt = performance.now();
      mountSubagentChildrenFromEvents(
        currentSlot.workspaceId,
        replacementEvents,
        options?.requestHeaders,
      );
      for (const operationId of historyApplyOperationIds) {
        recordMeasurementWorkflowStep({
          operationId,
          step: "session.history.mount_subagents",
          startedAt: mountStartedAt,
        });
        markSessionApplyForNextCommit(operationId);
      }
      finishStandaloneApplyOperation(standaloneMeasurementOperationId, "completed", true);
      logLatency("session.history.rehydrate.success", {
        sessionId,
        eventCount: replacementEvents.length,
        appended: false,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
      return true;
    } catch (error) {
      if (import.meta.env.DEV && !isSessionHistoryTimeoutAbort(error)) {
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
      finishStandaloneApplyOperation(standaloneMeasurementOperationId, "error_sanitized");
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

  const createSessionStreamFlushController = useSessionStreamFlushControllerFactory({
    queryClient,
    mountSubagentChildSession,
    persistReconciledModePreferences,
    refreshSessionSlotMeta,
    showToast,
  });

  const closeSessionSlotStream = useCallback((sessionId: string) => {
    clearSessionReconnectTimer(sessionId);
    const materializedSessionId = getMaterializedSessionId(sessionId);
    const closed = materializedSessionId
      ? closeSessionStreamHandle(materializedSessionId)
      : false;
    if (closed || getSessionRecord(sessionId)) {
      useSessionDirectoryStore.getState().patchEntry(sessionId, {
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
      hydrateBeforeStream?: boolean;
      skipInitialRefresh?: boolean;
      refreshOnStartupReady?: boolean;
      forceReconnect?: boolean;
      reconnectOwner?: "internal" | "external";
      onReconnectNeeded?: () => void;
      requestHeaders?: HeadersInit;
      measurementOperationId?: MeasurementOperationId | null;
      isCurrent?: () => boolean;
    },
  ): Promise<void> => {
    if (options?.isCurrent && !options.isCurrent()) {
      return;
    }
    const initialSlot = getSessionRecord(sessionId);
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
    if (!initialSlot.transcriptHydrated && options?.hydrateBeforeStream !== false) {
      const hydrateStartedAt = performance.now();
      await rehydrateSessionSlotFromHistory(sessionId, {
        requestHeaders: options?.requestHeaders,
        measurementOperationId: options?.measurementOperationId,
        isCurrent: options?.isCurrent,
      });
      if (options?.isCurrent && !options.isCurrent()) {
        return;
      }
      useSessionDirectoryStore.getState().patchEntry(sessionId, {
        transcriptHydrated: true,
      });
      recordMeasurementWorkflowStep({
        operationId: options?.measurementOperationId,
        step: "session.stream.initial_history_hydrate",
        startedAt: hydrateStartedAt,
      });
    } else if (!initialSlot.transcriptHydrated) {
      recordMeasurementWorkflowStep({
        operationId: options?.measurementOperationId,
        step: "session.stream.initial_history_hydrate",
        startedAt: performance.now(),
        outcome: "skipped",
      });
    }

    const slot = getSessionRecord(sessionId);
    if (!slot) {
      return;
    }

    if (
      !options?.forceReconnect
      && (
        slot.streamConnectionState === "connecting"
        || slot.streamConnectionState === "open"
      )
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

    const refreshedSlot = getSessionRecord(sessionId);
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

    const currentSlot = getSessionRecord(sessionId);
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
      const latestEntry = useSessionDirectoryStore.getState().entriesById[sessionId] ?? null;
      return resolveSessionViewState(activitySnapshotFromDirectoryEntry(latestEntry)) === "working";
    };
    const scheduleActiveSummaryRefresh = () => {
      clearActiveSummaryRefreshTimer();
      if (!shouldRefreshActiveSummary()) {
        return;
      }

      activeSummaryRefreshTimer = setTimeout(() => {
        activeSummaryRefreshTimer = null;
        const materializedSessionId = getMaterializedSessionId(sessionId);
        if (!handle || !materializedSessionId || !isCurrentStreamHandle(materializedSessionId, handle)) {
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
          const materializedSessionId = getMaterializedSessionId(sessionId);
          if (
            handle
            && materializedSessionId
            && isCurrentStreamHandle(materializedSessionId, handle)
            && shouldRefreshActiveSummary()
          ) {
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
      if (options?.reconnectOwner === "external") {
        options.onReconnectNeeded?.();
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
    const streamFlushController = createSessionStreamFlushController({
      sessionId,
      streamMeasurementOperationId,
      requestHeaders: options?.requestHeaders,
      isStillCurrent,
      isCurrentStream: () => {
        const materializedSessionId = getMaterializedSessionId(sessionId);
        return !!handle
          && !!materializedSessionId
          && isCurrentStreamHandle(materializedSessionId, handle);
      },
      closeCurrentHandle: () => {
        handle?.close();
      },
      scheduleReconnect,
      clearActiveSummaryRefreshTimer,
      scheduleActiveSummaryRefresh,
      scheduleStartupReadyRefresh,
    });

    await openSessionStream(sessionId, {
      afterSeq,
      requestHeaders: options?.requestHeaders,
      measurementOperationId: streamMeasurementOperationId ?? undefined,
      onHandle: (nextHandle) => {
        if (!isStillCurrent()) {
          nextHandle.close();
          return;
        }
        const flushAwareHandle = createFlushAwareSessionStreamHandle(
          nextHandle,
          streamFlushController,
        );
        handle = flushAwareHandle;
        const materializedSessionId = getMaterializedSessionId(sessionId);
        if (!materializedSessionId) {
          nextHandle.close();
          return;
        }
        setSessionStreamHandle({
          sessionId: materializedSessionId,
          workspaceId: currentSlot?.workspaceId ?? null,
          runtimeUrl: useHarnessConnectionStore.getState().runtimeUrl,
          handle: flushAwareHandle,
        });
        useSessionDirectoryStore.getState().patchEntry(sessionId, {
          streamConnectionState: "connecting",
        });
      },
      onOpen: () => {
        const materializedSessionId = getMaterializedSessionId(sessionId);
        if (!isStillCurrent() || !handle || !materializedSessionId || !isCurrentStreamHandle(materializedSessionId, handle)) {
          return;
        }
        useSessionDirectoryStore.getState().patchEntry(sessionId, {
          streamConnectionState: "open",
        });
        useSessionIngestStore.getState().markCurrentIfContiguous(
          sessionId,
          getSessionRecord(sessionId)?.transcript.lastSeq ?? 0,
        );
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
        const materializedSessionId = getMaterializedSessionId(sessionId);
        if (!isStillCurrent() || !handle || !materializedSessionId || !isCurrentStreamHandle(materializedSessionId, handle)) {
          return;
        }
        streamFlushController.enqueue(envelope);
      },
      onError: () => {
        streamFlushController.flushNow();
        streamFlushController.dispose();
        finishStreamConnectMeasurement("aborted");
        resolveOpen?.();
        clearStartupReadyRefreshTimer();
        clearActiveSummaryRefreshTimer();
        const materializedSessionId = getMaterializedSessionId(sessionId);
        if (!isStillCurrent() || !handle || !materializedSessionId || !isCurrentStreamHandle(materializedSessionId, handle)) {
          return;
        }
        clearSessionStreamHandle(materializedSessionId, handle);
        useSessionDirectoryStore.getState().patchEntry(sessionId, {
          streamConnectionState: "disconnected",
        });
        useSessionIngestStore.getState().markStale(sessionId, {
          lastAppliedSeq: getSessionRecord(sessionId)?.transcript.lastSeq ?? 0,
          lastObservedSeq: getSessionRecord(sessionId)?.transcript.lastSeq ?? 0,
          gapAfterSeq: null,
          lastErrorAt: new Date().toISOString(),
        });
        scheduleReconnect();
      },
      onClose: () => {
        streamFlushController.flushNow();
        streamFlushController.dispose();
        finishStreamConnectMeasurement(openResolved ? "completed" : "aborted");
        resolveOpen?.();
        clearStartupReadyRefreshTimer();
        clearActiveSummaryRefreshTimer();
        const materializedSessionId = getMaterializedSessionId(sessionId);
        if (!isStillCurrent() || !handle || !materializedSessionId || !isCurrentStreamHandle(materializedSessionId, handle)) {
          return;
        }

        clearSessionStreamHandle(materializedSessionId, handle);
        useSessionDirectoryStore.getState().patchEntry(sessionId, {
          streamConnectionState: "ended",
        });
        if (shouldReconnectStream(sessionId)) {
          useSessionIngestStore.getState().markStale(sessionId, {
            lastAppliedSeq: getSessionRecord(sessionId)?.transcript.lastSeq ?? 0,
            lastObservedSeq: getSessionRecord(sessionId)?.transcript.lastSeq ?? 0,
            gapAfterSeq: null,
            lastErrorAt: new Date().toISOString(),
          });
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
    createSessionStreamFlushController,
    refreshSessionSlotMeta,
    rehydrateSessionSlotFromHistory,
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

function isSessionHistoryTimeoutAbort(error: unknown): boolean {
  return error instanceof Error
    && error.name === "AbortError"
    && error.message === "Session history request timed out";
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

function resolveHistoryApplyOperationKind(input: {
  afterSeq?: number;
  beforeSeq?: number;
}): MeasurementOperationKind {
  if (input.beforeSeq != null) {
    return "session_history_older_chunk";
  }
  if (input.afterSeq != null) {
    return "session_history_tail_reconcile";
  }
  return "session_history_initial_hydrate";
}

function finishStandaloneApplyOperation(
  operationId: MeasurementOperationId | null,
  reason: "completed" | "aborted" | "error_sanitized",
  waitForPaint = false,
): void {
  if (!operationId) {
    return;
  }
  const finish = () => finishOrCancelMeasurementOperation(operationId, reason);
  if (waitForPaint) {
    scheduleAfterNextPaint(finish);
    return;
  }
  finish();
}

function markSessionApplyForNextCommit(operationId: MeasurementOperationId | null | undefined): void {
  if (!operationId) {
    return;
  }
  markOperationForNextCommit(operationId, SESSION_APPLY_MEASUREMENT_SURFACES);
}

function applyHistoryStateToStores(
  sessionId: string,
  currentRecord: SessionRuntimeRecord,
  nextState: {
    events: SessionEventEnvelope[];
    transcript: TranscriptState;
  },
): void {
  const status = resolveSessionStatus(currentRecord.status, {
    executionSummary: currentRecord.executionSummary,
    streamConnectionState: currentRecord.streamConnectionState,
    transcript: nextState.transcript,
  });
  batchSessionStoreWrites(() => {
    useSessionTranscriptStore.getState().patchEntry(sessionId, {
      events: nextState.events,
      transcript: nextState.transcript,
    });
    useSessionDirectoryStore.getState().patchEntry(sessionId, {
      status,
      modeId: nextState.transcript.currentModeId ?? currentRecord.modeId,
      activity: activityFromTranscript(nextState.transcript, {
        status,
        executionSummary: currentRecord.executionSummary,
      }),
    });
  });
}

function uniqueMeasurementOperationIds(
  operationIds: readonly (MeasurementOperationId | null | undefined)[],
): MeasurementOperationId[] {
  return [...new Set(operationIds.filter((id): id is MeasurementOperationId => !!id))];
}

function createFlushAwareSessionStreamHandle(
  handle: SessionStreamHandle,
  streamFlushController: SessionStreamFlushController,
): FlushAwareSessionStreamHandle {
  let closed = false;

  return {
    close() {
      streamFlushController.flushNow();
      streamFlushController.dispose();
      if (closed) {
        return;
      }
      closed = true;
      handle.close();
    },
    flushPendingEvents() {
      streamFlushController.flushNow();
    },
  };
}

function recordHistoryStateCounts(
  operationId: MeasurementOperationId | null | undefined,
  phase: "before" | "after",
  events: readonly SessionEventEnvelope[],
  transcript: TranscriptState,
): void {
  if (!operationId) {
    return;
  }
  const isBefore = phase === "before";
  recordMeasurementMetric({
    type: "state_count",
    operationId,
    target: isBefore ? "session.history.events_before" : "session.history.events_after",
    count: events.length,
  });
  recordMeasurementMetric({
    type: "state_count",
    operationId,
    target: isBefore ? "session.history.turns_before" : "session.history.turns_after",
    count: transcript.turnOrder.length,
  });
  recordMeasurementMetric({
    type: "state_count",
    operationId,
    target: isBefore ? "session.history.items_before" : "session.history.items_after",
    count: Object.keys(transcript.itemsById).length,
  });
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
