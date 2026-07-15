import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  mergeFetchedHistoryWithExistingEvents,
  mergeFetchedHistoryWithNewerEvents,
} from "@/lib/domain/sessions/history/history-event-merge";
import {
  appendHistoryTail,
  replaySessionHistory,
} from "@/lib/domain/sessions/stream/stream-state";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import {
  recordMeasurementMetric,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import type {
  MeasurementOperationId,
} from "@/lib/domain/telemetry/debug-measurement-catalog";
import { uniqueMeasurementOperationIds } from "@/lib/infra/measurement/operation-ids";
import { fetchSessionHistory } from "@/lib/access/anyharness/session-runtime";
import { useLinkedSessionMounting } from "@/hooks/chat/workflows/subagents/use-linked-session-mounting";
import { getSessionRecord } from "@/stores/sessions/session-records";
import {
  applyHistoryStateToStores,
  finishStandaloneApplyOperation,
  isSessionHistoryTimeoutAbort,
  markSessionApplyForNextCommit,
  recordHistoryStateCounts,
  resolveHistoryApplyOperationKind,
  SESSION_APPLY_MEASUREMENT_SURFACES,
  SESSION_HISTORY_APPLY_MAX_DURATION_MS,
} from "@/hooks/sessions/lifecycle/session-history-hydration-helpers";

interface SessionHistoryHydrationOptions {
  afterSeq?: number;
  beforeSeq?: number;
  limit?: number;
  turnLimit?: number;
  replace?: boolean;
  requestHeaders?: HeadersInit;
  measurementOperationId?: MeasurementOperationId | null;
  timeoutMs?: number;
  isCurrent?: () => boolean;
}

/**
 * Owns fetching, replaying, and applying historical session events.
 * Stream handle lifecycle stays in useSessionRuntimeActions.
 */
export function useSessionHistoryHydration() {
  const host = useProductHost();
  const ssh = host.desktop?.ssh ?? null;
  const cloudClient = host.cloud.client;
  const { mountSubagentChildrenFromEvents } = useLinkedSessionMounting();

  const rehydrateSessionSlotFromHistory = useCallback(async (
    sessionId: string,
    options?: SessionHistoryHydrationOptions,
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
            ssh,
            cloudClient,
          }
          : { ssh, cloudClient },
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
          reconcileEnvelopes: events,
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
          reconcileEnvelopes: events,
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
        reconcileEnvelopes: replacementEvents,
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
  }, [mountSubagentChildrenFromEvents, ssh, cloudClient]);

  return {
    rehydrateSessionSlotFromHistory,
  };
}
