import {
  createTranscriptState,
  type Session,
} from "@anyharness/sdk";
import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  fetchSessionSummary,
  getSessionClientAndWorkspace,
  resumeSession,
} from "@/lib/access/anyharness/session-runtime";
import { logDevSessionRuntimeEvent } from "@/lib/infra/debug/dev-session-runtime-log";
import type { MeasurementOperationId } from "@/lib/domain/telemetry/debug-measurement-catalog";
import {
  resolveSessionStatus,
} from "@proliferate/product-domain/sessions/activity";
import { rememberLastViewedSession } from "@/stores/preferences/workspace-ui-store";
import { resolveWorkspaceUiKey } from "@/lib/domain/workspaces/selection/workspace-ui-key";
import { useToastStore } from "@/stores/toast/toast-store";
import { useLinkedSessionMounting } from "@/hooks/chat/workflows/subagents/use-linked-session-mounting";
import {
  useSessionStreamFlushControllerFactory,
} from "@/hooks/sessions/lifecycle/use-session-stream-flush";
import { useSessionStreamCache } from "@/hooks/sessions/cache/use-session-stream-cache";
import { useSessionHistoryHydration } from "@/hooks/sessions/lifecycle/use-session-history-hydration";
import { useSessionSummaryActions } from "@/hooks/sessions/workflows/use-session-summary-actions";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import {
  getSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionStreamConnectionActions } from "@/hooks/sessions/lifecycle/use-session-stream-connection-actions";

export function useSessionRuntimeActions() {
  const ssh = useProductHost().desktop?.ssh ?? null;
  const sessionStreamCache = useSessionStreamCache();
  const showToast = useToastStore((state) => state.show);
  const { mountSubagentChildSession } = useLinkedSessionMounting();
  const {
    applySessionSummary,
    persistReconciledModePreferences,
  } = useSessionSummaryActions();
  const { rehydrateSessionSlotFromHistory } = useSessionHistoryHydration();

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
      const { workspaceId } = await getSessionClientAndWorkspace(sessionId, ssh);
      let session = await fetchSessionSummary(sessionId, {
        requestHeaders: options?.requestHeaders,
        measurementOperationId: options?.measurementOperationId,
        ssh,
      });
      if (options?.isCurrent && !options.isCurrent()) {
        logDevSessionRuntimeEvent(sessionId, "summary_ignored_not_current", {
          phase: session.executionSummary?.phase ?? null,
          status: session.status,
        });
        return;
      }
      const beforeSummarySlot = getSessionRecord(sessionId);
      logDevSessionRuntimeEvent(sessionId, "summary_received", {
        status: session.status,
        phase: session.executionSummary?.phase ?? null,
        pendingInteractionCount: session.executionSummary?.pendingInteractions?.length ?? 0,
        previousStatus: beforeSummarySlot?.status ?? null,
        previousPhase: beforeSummarySlot?.executionSummary?.phase ?? null,
        previousStreamConnectionState: beforeSummarySlot?.streamConnectionState ?? null,
        previousIsStreaming: beforeSummarySlot?.transcript.isStreaming ?? null,
        previousLastSeq: beforeSummarySlot?.transcript.lastSeq ?? null,
        previousTurnCount: beforeSummarySlot?.transcript.turnOrder.length ?? null,
      });
      applySessionSummary(sessionId, session, workspaceId);
      await reconcileHistoryTailAfterSettledSummary(
        sessionId,
        session,
        beforeSummarySlot,
        {
          requestHeaders: options?.requestHeaders,
          measurementOperationId: options?.measurementOperationId,
          isCurrent: options?.isCurrent,
          rehydrateSessionSlotFromHistory,
        },
      );

      if (
        options?.resumeIfActive
        && resolveSessionStatus(session.status, {
          executionSummary: session.executionSummary ?? null,
          transcript: createTranscriptState(sessionId),
        }) === "running"
      ) {
        session = await resumeSession(sessionId, {
          requestHeaders: options?.requestHeaders,
          measurementOperationId: options?.measurementOperationId,
          ssh,
        });
        if (options?.isCurrent && !options.isCurrent()) {
          logDevSessionRuntimeEvent(sessionId, "resume_summary_ignored_not_current", {
            phase: session.executionSummary?.phase ?? null,
            status: session.status,
          });
          return;
        }
        const beforeResumeSummarySlot = getSessionRecord(sessionId);
        logDevSessionRuntimeEvent(sessionId, "resume_summary_received", {
          status: session.status,
          phase: session.executionSummary?.phase ?? null,
          pendingInteractionCount: session.executionSummary?.pendingInteractions?.length ?? 0,
          previousStatus: beforeResumeSummarySlot?.status ?? null,
          previousPhase: beforeResumeSummarySlot?.executionSummary?.phase ?? null,
          previousStreamConnectionState: beforeResumeSummarySlot?.streamConnectionState ?? null,
          previousIsStreaming: beforeResumeSummarySlot?.transcript.isStreaming ?? null,
          previousLastSeq: beforeResumeSummarySlot?.transcript.lastSeq ?? null,
          previousTurnCount: beforeResumeSummarySlot?.transcript.turnOrder.length ?? null,
        });
        applySessionSummary(sessionId, session, workspaceId);
        await reconcileHistoryTailAfterSettledSummary(
          sessionId,
          session,
          beforeResumeSummarySlot,
          {
            requestHeaders: options?.requestHeaders,
            measurementOperationId: options?.measurementOperationId,
            isCurrent: options?.isCurrent,
            rehydrateSessionSlotFromHistory,
          },
        );
      }
    } catch (error) {
      logDevSessionRuntimeEvent(sessionId, "summary_refresh_failed", {
        errorName: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : String(error),
      });
      if (import.meta.env.DEV) {
        console.debug("[session-runtime] session metadata refresh failed", error);
      }
    }
  }, [applySessionSummary, rehydrateSessionSlotFromHistory, ssh]);

  const createSessionStreamFlushController = useSessionStreamFlushControllerFactory({
    sessionStreamCache,
    mountSubagentChildSession,
    persistReconciledModePreferences,
    refreshSessionSlotMeta,
    rehydrateSessionSlotFromHistory,
    showToast,
  });

  const {
    closeSessionSlotStream,
    ensureSessionStreamConnected,
  } = useSessionStreamConnectionActions({
    createSessionStreamFlushController,
    refreshSessionSlotMeta,
    rehydrateSessionSlotFromHistory,
  });

  return {
    activateSession,
    applySessionSummary,
    closeSessionSlotStream,
    ensureSessionStreamConnected,
    rehydrateSessionSlotFromHistory,
    refreshSessionSlotMeta,
  };
}

async function reconcileHistoryTailAfterSettledSummary(
  sessionId: string,
  session: Session,
  previousSlot: ReturnType<typeof getSessionRecord>,
  options: {
    requestHeaders?: HeadersInit;
    measurementOperationId?: MeasurementOperationId | null;
    isCurrent?: () => boolean;
    rehydrateSessionSlotFromHistory: (
      sessionId: string,
      options?: {
        afterSeq?: number;
        requestHeaders?: HeadersInit;
        measurementOperationId?: MeasurementOperationId | null;
        timeoutMs?: number;
        isCurrent?: () => boolean;
      },
    ) => Promise<boolean>;
  },
): Promise<void> {
  if (!previousSlot) {
    logDevSessionRuntimeEvent(sessionId, "history_tail_reconcile_skipped", {
      reason: "missing_previous_slot",
      summaryStatus: session.status,
      summaryPhase: session.executionSummary?.phase ?? null,
    });
    return;
  }
  if (sessionSummaryIsActive(session)) {
    logDevSessionRuntimeEvent(sessionId, "history_tail_reconcile_skipped", {
      reason: "summary_active",
      summaryStatus: session.status,
      summaryPhase: session.executionSummary?.phase ?? null,
      previousStatus: previousSlot.status,
      previousPhase: previousSlot.executionSummary?.phase ?? null,
      previousIsStreaming: previousSlot.transcript.isStreaming,
      previousLastSeq: previousSlot.transcript.lastSeq,
    });
    return;
  }
  if (!slotLooksLocallyActive(previousSlot)) {
    logDevSessionRuntimeEvent(sessionId, "history_tail_reconcile_skipped", {
      reason: "local_not_active",
      summaryStatus: session.status,
      summaryPhase: session.executionSummary?.phase ?? null,
      previousStatus: previousSlot.status,
      previousPhase: previousSlot.executionSummary?.phase ?? null,
      previousIsStreaming: previousSlot.transcript.isStreaming,
      previousLastSeq: previousSlot.transcript.lastSeq,
    });
    return;
  }

  logDevSessionRuntimeEvent(sessionId, "history_tail_reconcile_started", {
    afterSeq: previousSlot.transcript.lastSeq,
    summaryStatus: session.status,
    summaryPhase: session.executionSummary?.phase ?? null,
    previousStatus: previousSlot.status,
    previousPhase: previousSlot.executionSummary?.phase ?? null,
    previousIsStreaming: previousSlot.transcript.isStreaming,
  });
  const applied = await options.rehydrateSessionSlotFromHistory(sessionId, {
    afterSeq: previousSlot.transcript.lastSeq,
    requestHeaders: options.requestHeaders,
    measurementOperationId: options.measurementOperationId,
    timeoutMs: 5_000,
    isCurrent: options.isCurrent,
  });
  const afterSlot = getSessionRecord(sessionId);
  logDevSessionRuntimeEvent(sessionId, "history_tail_reconcile_finished", {
    applied,
    afterStatus: afterSlot?.status ?? null,
    afterPhase: afterSlot?.executionSummary?.phase ?? null,
    afterIsStreaming: afterSlot?.transcript.isStreaming ?? null,
    afterLastSeq: afterSlot?.transcript.lastSeq ?? null,
    afterTurnCount: afterSlot?.transcript.turnOrder.length ?? null,
  });
}

function sessionSummaryIsActive(session: Session): boolean {
  const phase = session.executionSummary?.phase ?? null;
  return session.status === "starting"
    || session.status === "running"
    || phase === "starting"
    || phase === "running"
    || phase === "awaiting_interaction";
}

function slotLooksLocallyActive(slot: NonNullable<ReturnType<typeof getSessionRecord>>): boolean {
  const phase = slot.executionSummary?.phase ?? null;
  return slot.transcript.isStreaming
    || slot.status === "starting"
    || slot.status === "running"
    || phase === "starting"
    || phase === "running"
    || phase === "awaiting_interaction";
}
