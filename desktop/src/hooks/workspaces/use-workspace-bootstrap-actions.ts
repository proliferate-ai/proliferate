import {
  anyHarnessModelRegistriesKey,
  anyHarnessSessionsKey,
  anyHarnessWorkspaceSessionLaunchKey,
  getAnyHarnessClient,
  type AnyHarnessResolvedConnection,
} from "@anyharness/sdk-react";
import type { AnyHarnessRequestOptions, ModelRegistry } from "@anyharness/sdk";
import { useCallback, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { orderChatLaunchAgents, shouldExposeChatLaunchAgent } from "@/config/chat-launch";
import { useWorkspaceFileActions } from "@/hooks/workspaces/files/use-workspace-file-actions";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";
import { isSessionModelAvailabilityInterruption } from "@/hooks/sessions/use-session-model-availability-workflow";
import type { WorkspaceSession } from "@/hooks/sessions/use-session-selection-actions";
import { resolveStatusFromExecutionSummary } from "@/lib/domain/sessions/activity";
import {
  choosePreferredWorkspaceSession,
} from "@/lib/domain/workspaces/selection/selection";
import { workspaceFileTreeStateKey } from "@/lib/domain/workspaces/cloud/collections";
import { resolveEffectiveLaunchSelection } from "@/lib/domain/chat/models/model-selection";
import { mergeLaunchAgentsWithRegistries } from "@/lib/domain/chat/launch/session-config";
import { hasHiddenDismissedWorkspaceSessions } from "@/lib/domain/workspaces/selection/selection";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";
import { getLatencyFlowRequestHeaders } from "@/lib/infra/measurement/latency-flow";
import {
  bindMeasurementCategories,
  finishOrCancelMeasurementOperation,
  getMeasurementRequestOptions,
  hashMeasurementScope,
  markOperationForNextCommit,
  recordMeasurementMetric,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
  type MeasurementFinishReason,
  type MeasurementOperationId,
} from "@/lib/infra/measurement/debug-measurement";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import {
  clearLastViewedSession,
  useWorkspaceUiStore,
} from "@/stores/preferences/workspace-ui-store";
import {
  getSessionRecord,
  patchSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { scheduleAfterNextPaint } from "@/lib/infra/scheduling/schedule-after-next-paint";
import { markWorkspaceBootstrappedInSession } from "./workspace-bootstrap-memory";

interface BootstrapWorkspaceInput {
  workspaceId: string;
  logicalWorkspaceId: string;
  runtimeUrl: string;
  workspaceConnection: AnyHarnessResolvedConnection;
  startedAt: number;
  latencyFlowId?: string | null;
  isCurrent: () => boolean;
}

interface ReconcileHotWorkspaceInput {
  workspaceId: string;
  logicalWorkspaceId: string;
  runtimeUrl: string;
  workspaceConnection: AnyHarnessResolvedConnection;
  sessionId: string;
  selectionNonce: number;
  latencyFlowId?: string | null;
  isCurrent: () => boolean;
}

const EMPTY_WORKSPACES = [] as const;
const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];
const WORKSPACE_BOOTSTRAP_SESSION_LIST_TIMEOUT_MS = 8_000;
const WORKSPACE_RECONCILE_SESSION_LIST_TIMEOUT_MS = 3_000;

function requestOptionsWithSignal(
  requestOptions: AnyHarnessRequestOptions | undefined,
  signal: AbortSignal,
): AnyHarnessRequestOptions {
  return {
    ...requestOptions,
    signal: requestOptions?.signal ?? signal,
  };
}

async function withAbortTimeout<T>(
  timeoutMs: number | undefined,
  run: (signal: AbortSignal | null) => Promise<T>,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return await run(null);
  }

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
      controller.abort();
    }, timeoutMs);
  });
  const runPromise = run(controller.signal);
  runPromise.catch(() => undefined);
  try {
    return await Promise.race([runPromise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

async function fetchWorkspaceSessionsWithConnection(
  workspaceConnection: AnyHarnessResolvedConnection,
  workspaceId: string,
  options?: {
    includeDismissed?: boolean;
    requestOptions?: AnyHarnessRequestOptions;
    timeoutMs?: number;
  },
): Promise<WorkspaceSession[]> {
  const sessions = await withAbortTimeout(
    options?.timeoutMs,
    async (signal) => {
      const timedRequestOptions = signal
        ? requestOptionsWithSignal(options?.requestOptions, signal)
        : options?.requestOptions;
      const requestOptions = options?.includeDismissed
        ? { ...timedRequestOptions, includeDismissed: true }
        : timedRequestOptions;
      return await getAnyHarnessClient(workspaceConnection).sessions.list(
        workspaceConnection.anyharnessWorkspaceId,
        requestOptions,
      );
    },
  );
  return sessions.map((session) => ({
    ...session,
    workspaceId,
  }));
}

async function fetchWorkspaceLaunchCatalog(
  workspaceConnection: AnyHarnessResolvedConnection,
  latencyFlowId?: string | null,
  signal?: AbortSignal,
) {
  const requestOptions = latencyFlowId
    ? { headers: getLatencyFlowRequestHeaders(latencyFlowId) }
    : undefined;
  return getAnyHarnessClient(workspaceConnection).workspaces.getSessionLaunchCatalog(
    workspaceConnection.anyharnessWorkspaceId,
    signal ? requestOptionsWithSignal(requestOptions, signal) : requestOptions,
  );
}

async function loadWorkflowWorkspaceSessions(input: {
  queryClient: QueryClient;
  queryKey: readonly unknown[];
  workspaceConnection: AnyHarnessResolvedConnection;
  workspaceId: string;
  requestOptions?: AnyHarnessRequestOptions;
  forceRefresh?: boolean;
  timeoutMs?: number;
}): Promise<WorkspaceSession[]> {
  const cacheState = input.queryClient.getQueryState(input.queryKey);
  const cachedSessions = input.queryClient.getQueryData<WorkspaceSession[]>(input.queryKey);
  if (
    !input.forceRefresh
    && cachedSessions
    && cacheState?.dataUpdatedAt
    && !cacheState.isInvalidated
  ) {
    return cachedSessions;
  }

  // Bootstrap/reconcile own workspace activation. Fetch directly instead of
  // joining a possibly hung automatic session-list query triggered by
  // selectedWorkspaceId subscribers, then seed React Query for those surfaces.
  const sessions = await fetchWorkspaceSessionsWithConnection(
    input.workspaceConnection,
    input.workspaceId,
    {
      requestOptions: input.requestOptions,
      timeoutMs: input.timeoutMs,
    },
  );
  input.queryClient.setQueryData(input.queryKey, sessions);
  return sessions;
}

export function useWorkspaceBootstrapActions() {
  const queryClient = useQueryClient();
  const workspaceCollections = useWorkspaces().data;
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
  })));
  const lastViewedSessionByWorkspace = useWorkspaceUiStore(
    (state) => state.lastViewedSessionByWorkspace,
  );
  const {
    prepareFileWorkspace,
    prefetchWorkspaceDirectories,
  } = useWorkspaceFileActions();
  const { selectSession, createEmptySessionWithResolvedConfig } = useSessionActions();
  const { rehydrateSessionSlotFromHistory } = useSessionRuntimeActions();
  const cancelDeferredFileTreePrefetchRef = useRef<(() => void) | null>(null);

  const cancelDeferredFileTreePrefetch = useCallback(() => {
    cancelDeferredFileTreePrefetchRef.current?.();
    cancelDeferredFileTreePrefetchRef.current = null;
  }, []);

  const scheduleDeferredFileTreePrefetch = useCallback((input: {
    workspaceId: string;
    materializedWorkspaceId: string;
    anyharnessWorkspaceId: string;
    runtimeUrl: string;
    treeStateKey: string;
    authToken?: string | null;
    measurementOperationId: MeasurementOperationId | null;
    startedAt: number;
    isCurrent: () => boolean;
  }) => {
    cancelDeferredFileTreePrefetch();
    let cancel: (() => void) | null = null;
    cancel = scheduleAfterNextPaint(() => {
      if (cancelDeferredFileTreePrefetchRef.current !== cancel) {
        return;
      }
      cancelDeferredFileTreePrefetchRef.current = null;
      if (!input.isCurrent()) {
        return;
      }
      void prefetchWorkspaceDirectories({
        materializedWorkspaceId: input.materializedWorkspaceId,
        anyharnessWorkspaceId: input.anyharnessWorkspaceId,
        runtimeUrl: input.runtimeUrl,
        treeStateKey: input.treeStateKey,
        authToken: input.authToken,
        isCurrent: input.isCurrent,
      }).then(() => {
        recordMeasurementWorkflowStep({
          operationId: input.measurementOperationId,
          step: "workspace.bootstrap.file_tree_init",
          startedAt: input.startedAt,
        });
        logLatency("workspace.select.file_tree_prefetched", {
          workspaceId: input.workspaceId,
          elapsedMs: elapsedMs(input.startedAt),
        });
      }).catch(() => {
        recordMeasurementWorkflowStep({
          operationId: input.measurementOperationId,
          step: "workspace.bootstrap.file_tree_init",
          startedAt: input.startedAt,
          outcome: "error_sanitized",
        });
      });
    });
    cancelDeferredFileTreePrefetchRef.current = cancel;
  }, [
    cancelDeferredFileTreePrefetch,
    prefetchWorkspaceDirectories,
  ]);

  const bootstrapWorkspace = useCallback(async ({
    workspaceId,
    logicalWorkspaceId,
    runtimeUrl,
    workspaceConnection,
    startedAt,
    latencyFlowId,
    isCurrent,
  }: BootstrapWorkspaceInput): Promise<{ sessions: WorkspaceSession[] }> => {
    const measurementOperationId = startMeasurementOperation({
      kind: "workspace_open",
      surfaces: [
        "workspace-shell",
        "workspace-sidebar",
        "global-header",
        "header-tabs",
        "chat-surface",
        "session-transcript-pane",
        "transcript-list",
        "file-tree",
      ],
      linkedLatencyFlowId: latencyFlowId ?? undefined,
      maxDurationMs: 30_000,
    });
    let measurementFinishReason: MeasurementFinishReason = "completed";
    cancelDeferredFileTreePrefetch();
    const unbindMeasurementCategories = measurementOperationId
      ? bindMeasurementCategories({
        operationId: measurementOperationId,
        categories: [
          "session.list",
          "session.get",
          "session.events.list",
          "session.resume",
          "session.stream",
          "file.list",
          "git.status",
          "workspace.session_launch",
          "workspace.setup_status",
        ],
        scope: {
          runtimeUrlHash: hashMeasurementScope(workspaceConnection.runtimeUrl),
        },
        ttlMs: 30_000,
      })
      : () => undefined;
    try {
    const workspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;
    const workspace = workspaces.find((entry) => entry.id === workspaceId);
    const treeStateKey = workspace
      ? workspaceFileTreeStateKey(workspace)
      : workspaceId;
    const sessionsStartedAt = startLatencyTimer();
    const initWorkspaceStartedAt = startLatencyTimer();
    const fileWorkspaceArgs = {
      workspaceUiKey: logicalWorkspaceId ?? workspaceId,
      materializedWorkspaceId: workspaceId,
      anyharnessWorkspaceId: workspaceConnection.anyharnessWorkspaceId,
      runtimeUrl: workspaceConnection.runtimeUrl,
      treeStateKey,
      authToken: workspaceConnection.authToken ?? undefined,
    };
    prepareFileWorkspace(fileWorkspaceArgs);
    recordMeasurementWorkflowStep({
      operationId: measurementOperationId,
      step: "workspace.bootstrap.file_tree_init",
      startedAt: initWorkspaceStartedAt,
    });
    scheduleDeferredFileTreePrefetch({
      workspaceId,
      materializedWorkspaceId: workspaceId,
      anyharnessWorkspaceId: workspaceConnection.anyharnessWorkspaceId,
      runtimeUrl: workspaceConnection.runtimeUrl,
      treeStateKey,
      authToken: workspaceConnection.authToken ?? undefined,
      measurementOperationId,
      startedAt: initWorkspaceStartedAt,
      isCurrent,
    });
    let sessionsLoadFailed = false;
    const sessionsQueryKey = anyHarnessSessionsKey(runtimeUrl, workspaceId);
    if (measurementOperationId) {
      const sessionsCacheState = queryClient.getQueryState(sessionsQueryKey);
      recordMeasurementMetric({
        type: "cache",
        category: "session.list",
        operationId: measurementOperationId,
        decision: sessionsCacheState?.dataUpdatedAt
          ? sessionsCacheState.isInvalidated ? "stale" : "hit"
          : "miss",
        source: "react_query",
      });
    }
    const sessionRequestOptions = getMeasurementRequestOptions({
      operationId: measurementOperationId,
      category: "session.list",
      headers: getLatencyFlowRequestHeaders(latencyFlowId) ?? undefined,
    });
    const sessions = await loadWorkflowWorkspaceSessions({
        queryClient,
        queryKey: sessionsQueryKey,
        workspaceConnection,
        workspaceId,
        requestOptions: sessionRequestOptions ?? undefined,
        timeoutMs: WORKSPACE_BOOTSTRAP_SESSION_LIST_TIMEOUT_MS,
      }).then((result) => {
        recordMeasurementWorkflowStep({
          operationId: measurementOperationId,
          step: "workspace.bootstrap.sessions",
          startedAt: sessionsStartedAt,
          count: result.length,
        });
        logLatency("workspace.select.sessions_loaded", {
          workspaceId,
          sessionCount: result.length,
          elapsedMs: elapsedMs(sessionsStartedAt),
        });
        return result;
      }).catch(() => {
        sessionsLoadFailed = true;
        recordMeasurementWorkflowStep({
          operationId: measurementOperationId,
          step: "workspace.bootstrap.sessions",
          startedAt: sessionsStartedAt,
          outcome: "error_sanitized",
        });
        logLatency("workspace.select.sessions_loaded", {
          workspaceId,
          sessionCount: 0,
          fallback: "load_failed",
        });
        return [] as WorkspaceSession[];
      });

    if (!isCurrent()) {
      return { sessions };
    }

    if (sessions.length === 0) {
      if (!sessionsLoadFailed) {
        clearLastViewedSession(logicalWorkspaceId);
      }
      const dismissedCheckStartedAt = startLatencyTimer();
      const sessionsIncludingDismissed = await fetchWorkspaceSessionsWithConnection(
        workspaceConnection,
        workspaceId,
        {
          includeDismissed: true,
          requestOptions: sessionRequestOptions,
          timeoutMs: WORKSPACE_BOOTSTRAP_SESSION_LIST_TIMEOUT_MS,
        },
      ).catch(() => sessions);
      const hasDismissedSessions = hasHiddenDismissedWorkspaceSessions(
        sessions,
        sessionsIncludingDismissed,
      );
      logLatency("workspace.select.dismissed_sessions_checked", {
        workspaceId,
        visibleSessionCount: sessions.length,
        totalSessionCount: sessionsIncludingDismissed.length,
        hasDismissedSessions,
        elapsedMs: elapsedMs(dismissedCheckStartedAt),
        totalElapsedMs: elapsedMs(startedAt),
      });
      recordMeasurementWorkflowStep({
        operationId: measurementOperationId,
        step: "workspace.bootstrap.dismissed_sessions",
        startedAt: dismissedCheckStartedAt,
        count: sessionsIncludingDismissed.length,
      });

      if (hasDismissedSessions) {
        useSessionSelectionStore.getState().setActiveSessionId(null);
        if (isCurrent()) {
          markWorkspaceBootstrappedInSession(workspaceId);
        }
        return { sessions };
      }

      const launchCatalogStartedAt = startLatencyTimer();
      const launchCatalog = await queryClient.ensureQueryData({
        queryKey: anyHarnessWorkspaceSessionLaunchKey(workspaceConnection.runtimeUrl, workspaceId),
        queryFn: ({ signal }) => fetchWorkspaceLaunchCatalog(
          workspaceConnection,
          latencyFlowId,
          signal,
        ),
      }).catch(() => null);
      const modelRegistries = await queryClient.ensureQueryData({
        queryKey: anyHarnessModelRegistriesKey(runtimeUrl),
        queryFn: ({ signal }) => getAnyHarnessClient(workspaceConnection)
          .modelRegistries
          .list({ signal }),
      }).catch(() => EMPTY_MODEL_REGISTRIES);

      logLatency("workspace.select.launch_catalog_loaded", {
        workspaceId,
        agentCount: launchCatalog?.agents?.length ?? 0,
        elapsedMs: elapsedMs(launchCatalogStartedAt),
      });
      recordMeasurementWorkflowStep({
        operationId: measurementOperationId,
        step: "workspace.bootstrap.launch_catalog",
        startedAt: launchCatalogStartedAt,
        count: launchCatalog?.agents?.length ?? 0,
      });

      if (!isCurrent()) {
        return { sessions };
      }

      const launchAgents = orderChatLaunchAgents(
        mergeLaunchAgentsWithRegistries(
          launchCatalog?.agents ?? [],
          modelRegistries,
        ).filter(shouldExposeChatLaunchAgent),
      );
      const defaultLaunch = resolveEffectiveLaunchSelection(
        launchAgents,
        preferences,
      );
      logLatency("workspace.select.default_launch_resolved", {
        workspaceId,
        hasDefaultLaunch: !!defaultLaunch,
        agentKind: defaultLaunch?.kind ?? null,
        modelId: defaultLaunch?.modelId ?? null,
        totalElapsedMs: elapsedMs(startedAt),
      });

      if (defaultLaunch) {
        logLatency("workspace.select.initial_session_open.start", {
          workspaceId,
          agentKind: defaultLaunch.kind,
          modelId: defaultLaunch.modelId,
          totalElapsedMs: elapsedMs(startedAt),
        });
        const sessionDispatchStartedAt = startLatencyTimer();
        try {
          await createEmptySessionWithResolvedConfig({
            workspaceId,
            agentKind: defaultLaunch.kind,
            modelId: defaultLaunch.modelId,
            latencyFlowId,
            reuseInFlightEmptySession: true,
          });
        } catch (error) {
          if (isSessionModelAvailabilityInterruption(error)) {
            return { sessions };
          }
          throw error;
        }
        recordMeasurementWorkflowStep({
          operationId: measurementOperationId,
          step: "workspace.bootstrap.initial_session",
          startedAt: sessionDispatchStartedAt,
        });
        logLatency("workspace.select.initial_session_open.dispatched", {
          workspaceId,
          agentKind: defaultLaunch.kind,
          modelId: defaultLaunch.modelId,
          dispatchElapsedMs: elapsedMs(sessionDispatchStartedAt),
          totalElapsedMs: elapsedMs(startedAt),
        });
        logLatency("workspace.select.initial_session_open.success", {
          workspaceId,
          agentKind: defaultLaunch.kind,
          modelId: defaultLaunch.modelId,
          totalElapsedMs: elapsedMs(startedAt),
        });
      }
    } else {
      const rememberedSessionId = lastViewedSessionByWorkspace[logicalWorkspaceId] ?? null;
      const targetSession = choosePreferredWorkspaceSession(
        sessions,
        rememberedSessionId,
      );
      if (rememberedSessionId && targetSession?.id !== rememberedSessionId) {
        clearLastViewedSession(logicalWorkspaceId, rememberedSessionId);
      }

      if (targetSession && isCurrent()) {
        const currentActiveSessionId = useSessionSelectionStore.getState().activeSessionId;
        if (currentActiveSessionId && currentActiveSessionId !== targetSession.id) {
          logLatency("workspace.select.session_select.skipped", {
            workspaceId,
            sessionId: targetSession.id,
            currentActiveSessionId,
            reason: "active_session_changed",
            totalElapsedMs: elapsedMs(startedAt),
          });
          if (isCurrent()) {
            markWorkspaceBootstrappedInSession(workspaceId);
          }
          return { sessions };
        }
        logLatency("workspace.select.session_select.start", {
          workspaceId,
          sessionId: targetSession.id,
          totalElapsedMs: elapsedMs(startedAt),
        });
        const sessionSelectStartedAt = performance.now();
        await selectSession(targetSession.id, { latencyFlowId });
        recordMeasurementWorkflowStep({
          operationId: measurementOperationId,
          step: "workspace.bootstrap.session_select",
          startedAt: sessionSelectStartedAt,
        });
        logLatency("workspace.select.success", {
          workspaceId,
          sessionId: targetSession.id,
          sessionCount: sessions.length,
          totalElapsedMs: elapsedMs(startedAt),
        });
      }
    }

    if (isCurrent()) {
      markWorkspaceBootstrappedInSession(workspaceId);
    }

    return { sessions };
    } catch (error) {
      measurementFinishReason = "error_sanitized";
      throw error;
    } finally {
      unbindMeasurementCategories();
      if (measurementOperationId) {
        markOperationForNextCommit(measurementOperationId, [
          "workspace-shell",
          "workspace-sidebar",
          "global-header",
          "header-tabs",
          "chat-surface",
          "session-transcript-pane",
          "transcript-list",
          "file-tree",
        ]);
        finishOrCancelMeasurementOperation(measurementOperationId, measurementFinishReason);
      }
    }
  }, [
    cancelDeferredFileTreePrefetch,
    lastViewedSessionByWorkspace,
    createEmptySessionWithResolvedConfig,
    prepareFileWorkspace,
    preferences,
    queryClient,
    scheduleDeferredFileTreePrefetch,
    selectSession,
    workspaceCollections,
  ]);

  return {
    bootstrapWorkspace,
    reconcileHotWorkspace: useCallback(async ({
      workspaceId,
      logicalWorkspaceId,
      runtimeUrl,
      workspaceConnection,
      sessionId,
      latencyFlowId,
      isCurrent,
    }: ReconcileHotWorkspaceInput): Promise<"completed" | "stale" | "session_missing"> => {
      if (!isCurrent()) {
        return "stale";
      }

      const measurementOperationId = startMeasurementOperation({
        kind: "workspace_background_reconcile",
        surfaces: [
          "workspace-shell",
          "workspace-sidebar",
          "global-header",
          "header-tabs",
          "chat-surface",
          "session-transcript-pane",
          "transcript-list",
          "file-tree",
        ],
        linkedLatencyFlowId: latencyFlowId ?? undefined,
        maxDurationMs: 30_000,
      });
      const unbindMeasurementCategories = measurementOperationId
        ? bindMeasurementCategories({
          operationId: measurementOperationId,
          categories: [
            "session.list",
            "session.get",
            "session.events.list",
            "session.resume",
            "session.stream",
            "file.list",
            "git.status",
            "workspace.session_launch",
            "workspace.setup_status",
          ],
          scope: {
            runtimeUrlHash: hashMeasurementScope(workspaceConnection.runtimeUrl),
          },
          ttlMs: 30_000,
        })
        : () => undefined;
      let finishReason: MeasurementFinishReason = "completed";
      cancelDeferredFileTreePrefetch();

      try {
        const workspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;
        const workspace = workspaces.find((entry) => entry.id === workspaceId);
        const treeStateKey = workspace
          ? workspaceFileTreeStateKey(workspace)
          : workspaceId;
        const requestHeaders = getLatencyFlowRequestHeaders(latencyFlowId) ?? undefined;
        const sessionRequestOptions = getMeasurementRequestOptions({
          operationId: measurementOperationId,
          category: "session.list",
          headers: requestHeaders,
        });
        const sessionsStartedAt = startLatencyTimer();
        const sessionsQueryKey = anyHarnessSessionsKey(runtimeUrl, workspaceId);
        const sessions = await loadWorkflowWorkspaceSessions({
          queryClient,
          queryKey: sessionsQueryKey,
          workspaceConnection,
          workspaceId,
          requestOptions: sessionRequestOptions ?? undefined,
          forceRefresh: true,
          timeoutMs: WORKSPACE_RECONCILE_SESSION_LIST_TIMEOUT_MS,
        });
        recordMeasurementWorkflowStep({
          operationId: measurementOperationId,
          step: "workspace.bootstrap.sessions",
          startedAt: sessionsStartedAt,
          count: sessions.length,
        });
        if (!isCurrent()) {
          return "stale";
        }

        const sessionMeta = sessions.find((session) =>
          session.id === sessionId && !session.dismissedAt
        ) ?? null;
        if (!sessionMeta) {
          return "session_missing";
        }

        const currentSlot = getSessionRecord(sessionId);
        if (!currentSlot) {
          return "session_missing";
        }
        const storeStartedAt = performance.now();
        patchSessionRecord(sessionId, {
          workspaceId,
          agentKind: sessionMeta.agentKind ?? currentSlot.agentKind,
          modelId: sessionMeta.modelId ?? currentSlot.modelId ?? null,
          modeId: sessionMeta.modeId ?? currentSlot.modeId ?? null,
          title: sessionMeta.title ?? currentSlot.title ?? null,
          liveConfig: sessionMeta.liveConfig ?? currentSlot.liveConfig ?? null,
          executionSummary: sessionMeta.executionSummary ?? currentSlot.executionSummary ?? null,
          mcpBindingSummaries: sessionMeta.mcpBindingSummaries ?? currentSlot.mcpBindingSummaries ?? null,
          status: resolveStatusFromExecutionSummary(
            sessionMeta.executionSummary ?? currentSlot.executionSummary ?? null,
            sessionMeta.status ?? currentSlot.status,
          ),
          lastPromptAt: sessionMeta.lastPromptAt ?? currentSlot.lastPromptAt ?? null,
        });
        recordMeasurementMetric({
          type: "store",
          category: "session.list",
          operationId: measurementOperationId ?? undefined,
          durationMs: performance.now() - storeStartedAt,
        });

        const initStartedAt = startLatencyTimer();
        const fileWorkspaceArgs = {
          workspaceUiKey: logicalWorkspaceId ?? workspaceId,
          materializedWorkspaceId: workspaceId,
          anyharnessWorkspaceId: workspaceConnection.anyharnessWorkspaceId,
          runtimeUrl: workspaceConnection.runtimeUrl,
          treeStateKey,
          authToken: workspaceConnection.authToken ?? undefined,
        };
        prepareFileWorkspace(fileWorkspaceArgs);
        recordMeasurementWorkflowStep({
          operationId: measurementOperationId,
          step: "workspace.bootstrap.file_tree_init",
          startedAt: initStartedAt,
        });
        if (!isCurrent()) {
          return "stale";
        }
        scheduleDeferredFileTreePrefetch({
          workspaceId,
          materializedWorkspaceId: workspaceId,
          anyharnessWorkspaceId: workspaceConnection.anyharnessWorkspaceId,
          runtimeUrl: workspaceConnection.runtimeUrl,
          treeStateKey,
          authToken: workspaceConnection.authToken ?? undefined,
          measurementOperationId,
          startedAt: initStartedAt,
          isCurrent,
        });

        const slotBeforeHydrate = getSessionRecord(sessionId);
        const lastSeq = slotBeforeHydrate?.transcript.lastSeq ?? 0;
        const hydrateStartedAt = startLatencyTimer();
        const tailHydrated = await rehydrateSessionSlotFromHistory(sessionId, {
          afterSeq: lastSeq,
          requestHeaders,
          measurementOperationId,
          isCurrent,
        });
        if (!isCurrent()) {
          return "stale";
        }
        if (!tailHydrated) {
          await rehydrateSessionSlotFromHistory(sessionId, {
            replace: true,
            requestHeaders,
            measurementOperationId,
            isCurrent,
          });
        }
        if (!isCurrent()) {
          return "stale";
        }
        patchSessionRecord(sessionId, { transcriptHydrated: true });
        recordMeasurementWorkflowStep({
          operationId: measurementOperationId,
          step: "session.select.history_hydrate",
          startedAt: hydrateStartedAt,
        });

        markWorkspaceBootstrappedInSession(workspaceId);
        markWorkspaceBootstrappedInSession(logicalWorkspaceId);
        return "completed";
      } catch (error) {
        if (import.meta.env.DEV) {
          console.debug("[workspace-bootstrap] hot reconcile failed", error);
        }
        finishReason = "error_sanitized";
        return "stale";
      } finally {
        unbindMeasurementCategories();
        finishOrCancelMeasurementOperation(measurementOperationId, finishReason);
      }
    }, [
      cancelDeferredFileTreePrefetch,
      prepareFileWorkspace,
      queryClient,
      rehydrateSessionSlotFromHistory,
      scheduleDeferredFileTreePrefetch,
      workspaceCollections,
    ]),
  };
}
