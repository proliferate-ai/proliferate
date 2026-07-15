import type { AnyHarnessRequestOptions } from "@anyharness/sdk";
import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import { useCallback } from "react";
import { resolveStatusFromExecutionSummary } from "@proliferate/product-domain/sessions/activity";
import type { WorkspaceSession } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import type { WorkspaceCollections } from "@/lib/domain/workspaces/cloud/collections";
import { workspaceFileTreeStateKey } from "@/lib/domain/workspaces/cloud/collections";
import type {
  MeasurementFinishReason,
  MeasurementOperationId,
} from "@/lib/domain/telemetry/debug-measurement-catalog";
import {
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";
import {
  bindMeasurementCategories,
  finishOrCancelMeasurementOperation,
  recordMeasurementMetric,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import { hashMeasurementScope } from "@/lib/infra/measurement/debug-measurement-env";
import { getMeasurementRequestOptions } from "@/lib/infra/measurement/debug-measurement-request-options";
import { getLatencyFlowRequestHeaders } from "@/lib/infra/measurement/latency-flow";
import type { DeferredWorkspaceFileTreePrefetchInput } from "@/hooks/workspaces/lifecycle/files/use-deferred-workspace-file-tree-prefetch";
import { markWorkspaceBootstrappedInSession } from "@/hooks/workspaces/lifecycle/workspace-bootstrap-memory";
import {
  getSessionRecord,
  patchSessionRecord,
} from "@/stores/sessions/session-records";

const EMPTY_WORKSPACES = [] as const;
const WORKSPACE_RECONCILE_SESSION_LIST_TIMEOUT_MS = 3_000;

interface ReconcileHotWorkspaceInput {
  workspaceId: string;
  logicalWorkspaceId: string;
  workspaceConnection: AnyHarnessResolvedConnection;
  sessionId: string;
  selectionNonce: number;
  latencyFlowId?: string | null;
  isCurrent: () => boolean;
}

interface WorkspaceFileAccessInput {
  workspaceUiKey: string;
  materializedWorkspaceId: string;
  anyharnessWorkspaceId: string;
  runtimeUrl: string;
  treeStateKey: string;
  authToken?: string | null;
}

interface UseHotWorkspaceReconcileActionInput {
  cancelDeferredFileTreePrefetch: () => void;
  loadWorkspaceSessions: (input: {
    workspaceConnection: AnyHarnessResolvedConnection;
    workspaceId: string;
    requestOptions?: AnyHarnessRequestOptions;
    forceRefresh?: boolean;
    timeoutMs?: number;
  }) => Promise<WorkspaceSession[]>;
  prepareFileWorkspace: (input: WorkspaceFileAccessInput) => void;
  rehydrateSessionSlotFromHistory: (
    sessionId: string,
    options?: {
      afterSeq?: number;
      replace?: boolean;
      requestHeaders?: HeadersInit;
      measurementOperationId?: MeasurementOperationId | null;
      isCurrent?: () => boolean;
    },
  ) => Promise<boolean>;
  scheduleDeferredFileTreePrefetch: (
    input: DeferredWorkspaceFileTreePrefetchInput,
  ) => void;
  workspaceCollections: WorkspaceCollections | undefined;
}

export function useHotWorkspaceReconcileAction({
  cancelDeferredFileTreePrefetch,
  loadWorkspaceSessions,
  prepareFileWorkspace,
  rehydrateSessionSlotFromHistory,
  scheduleDeferredFileTreePrefetch,
  workspaceCollections,
}: UseHotWorkspaceReconcileActionInput) {
  return useCallback(async ({
    workspaceId,
    logicalWorkspaceId,
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
      const sessions = await loadWorkspaceSessions({
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
        requestedModelId:
          sessionMeta.requestedModelId
          ?? sessionMeta.modelId
          ?? currentSlot.requestedModelId
          ?? null,
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
    loadWorkspaceSessions,
    prepareFileWorkspace,
    rehydrateSessionSlotFromHistory,
    scheduleDeferredFileTreePrefetch,
    workspaceCollections,
  ]);
}
