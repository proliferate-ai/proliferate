import type { AnyHarnessRequestOptions } from "@anyharness/sdk";
import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import { useCallback } from "react";
import type { WorkspaceSession } from "#product/hooks/access/anyharness/sessions/use-workspace-session-cache";
import type { WorkspaceCollections } from "#product/lib/domain/workspaces/cloud/collections";
import { workspaceFileTreeStateKey } from "#product/lib/domain/workspaces/cloud/collections";
import type {
  MeasurementFinishReason,
  MeasurementOperationId,
} from "#product/lib/domain/telemetry/debug-measurement-catalog";
import {
  startLatencyTimer,
} from "#product/lib/infra/measurement/measurement-port";
import {
  bindMeasurementCategories,
  finishOrCancelMeasurementOperation,
  recordMeasurementMetric,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
} from "#product/lib/infra/measurement/measurement-port";
import { hashMeasurementScope } from "#product/lib/infra/measurement/measurement-port";
import { getMeasurementRequestOptions } from "#product/lib/infra/measurement/measurement-port";
import { getLatencyFlowRequestHeaders } from "#product/lib/infra/measurement/measurement-port";
import type { DeferredWorkspaceFileTreePrefetchInput } from "#product/hooks/workspaces/lifecycle/files/use-deferred-workspace-file-tree-prefetch";
import { markWorkspaceBootstrappedInSession } from "#product/hooks/workspaces/lifecycle/workspace-bootstrap-memory";
import {
  getSessionRecord,
  patchSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionIngestStore } from "#product/stores/sessions/session-ingest-store";
import { recordHotWorkspaceReconcileFailure } from "#product/lib/infra/diagnostics/renderer-diagnostic-migrations";
import { safeRendererErrorName } from "#product/lib/infra/diagnostics/renderer-diagnostic-values";

const EMPTY_WORKSPACES = [] as const;
const WORKSPACE_RECONCILE_SESSION_LIST_TIMEOUT_MS = 3_000;

export interface ReconcileHotWorkspaceInput {
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
  applySessionSummary: (
    clientSessionId: string,
    session: WorkspaceSession,
    workspaceId: string,
  ) => void;
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
  applySessionSummary,
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

      const currentSlot = getSessionRecord(sessionId);
      if (!currentSlot) {
        return "session_missing";
      }
      // Runtime sessions carry materialized ids while a slot created in this
      // app run stays keyed by its client session id; compare through the
      // slot's materialized id or every such session reconciles as missing.
      const runtimeSessionId = currentSlot.materializedSessionId ?? sessionId;
      const sessionMeta = sessions.find((session) =>
        session.id === runtimeSessionId && !session.dismissedAt
      ) ?? null;
      if (!sessionMeta) {
        return "session_missing";
      }
      const storeStartedAt = performance.now();
      applySessionSummary(sessionId, sessionMeta, workspaceId);
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

      // Streaming continuity (ADR Q15): a slot whose hot stream stayed open
      // and contiguous while the workspace was backgrounded already holds the
      // full transcript, so the store is trusted as-is. History is fetched
      // only to repair a real gap (closed stream, missed sequence), and the
      // full replace stays a last resort for a non-contiguous tail.
      const slotBeforeHydrate = getSessionRecord(sessionId);
      const ingestFreshness = useSessionIngestStore
        .getState()
        .freshnessByClientSessionId[sessionId];
      const slotStreamLive = slotBeforeHydrate?.transcriptHydrated === true
        && slotBeforeHydrate.streamConnectionState === "open"
        && ingestFreshness?.freshness === "current"
        && ingestFreshness.gapAfterSeq === null;
      let transcriptHydrated = slotBeforeHydrate?.transcriptHydrated === true;
      const lastSeq = slotBeforeHydrate?.transcript.lastSeq ?? 0;
      const hydrateStartedAt = startLatencyTimer();
      if (!slotStreamLive) {
        let hydrationApplied = await rehydrateSessionSlotFromHistory(sessionId, {
          afterSeq: lastSeq,
          requestHeaders,
          measurementOperationId,
          isCurrent,
        });
        if (!isCurrent()) {
          return "stale";
        }
        if (!hydrationApplied) {
          hydrationApplied = await rehydrateSessionSlotFromHistory(sessionId, {
            replace: true,
            requestHeaders,
            measurementOperationId,
            isCurrent,
          });
        }
        if (!isCurrent()) {
          return "stale";
        }
        transcriptHydrated ||= hydrationApplied;
      }
      if (transcriptHydrated) {
        patchSessionRecord(sessionId, { transcriptHydrated: true });
      }
      recordMeasurementWorkflowStep({
        operationId: measurementOperationId,
        step: "session.select.history_hydrate",
        startedAt: hydrateStartedAt,
        outcome: slotStreamLive ? "skipped" : undefined,
      });

      markWorkspaceBootstrappedInSession(workspaceId);
      markWorkspaceBootstrappedInSession(logicalWorkspaceId);
      return "completed";
    } catch (error) {
      recordHotWorkspaceReconcileFailure({
        operationId: measurementOperationId,
        workspaceId,
        sessionId,
        errorName: safeRendererErrorName(error),
      });
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
    applySessionSummary,
    cancelDeferredFileTreePrefetch,
    loadWorkspaceSessions,
    prepareFileWorkspace,
    rehydrateSessionSlotFromHistory,
    scheduleDeferredFileTreePrefetch,
    workspaceCollections,
  ]);
}
