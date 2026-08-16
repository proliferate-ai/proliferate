import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  mergeFetchedHistoryWithExistingEvents,
  mergeFetchedHistoryWithNewerEvents,
} from "#product/lib/domain/sessions/history/history-event-merge";
import {
  appendHistoryTail,
  replaySessionHistory,
} from "#product/lib/domain/sessions/stream/stream-state";
import {
  logLatency,
  recordMeasurementMetric,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
  uniqueMeasurementOperationIds,
} from "#product/lib/infra/measurement/measurement-port";
import type {
  MeasurementOperationId,
} from "#product/lib/domain/telemetry/debug-measurement-catalog";
import { fetchSessionHistory } from "#product/lib/access/anyharness/session-runtime";
import { getSessionRecord } from "#product/stores/sessions/session-records";
import {
  applyHistoryStateToStores,
  finishStandaloneApplyOperation,
  recordHistoryApplyStepMetrics,
  recordHistoryStateCounts,
  reportSessionHistoryRehydrateFailure,
  resolveHistoryApplyOperationKind,
  SESSION_APPLY_MEASUREMENT_SURFACES,
  SESSION_HISTORY_APPLY_MAX_DURATION_MS,
} from "#product/hooks/sessions/lifecycle/session-history-hydration-helpers";
import { useSessionHistorySubagentAuthority } from "#product/hooks/sessions/lifecycle/use-session-history-subagent-authority";
import {
  beginRendererFlow,
  finishRendererFlow,
  markRendererFlowDataReady,
  markRendererFlowShellCommitted,
} from "#product/lib/infra/diagnostics/renderer-flow-timing";
import {
  buildSessionOpenBeginParams,
  buildSessionOpenDataReadyParams,
  buildSessionOpenFinishParams,
  buildSessionOpenShellCommittedParams,
  markSessionOpenFlowAbandoned,
} from "#product/hooks/sessions/lifecycle/session-open-flow-marks";

/**
 * UX-latency R14: in-flight dedupe for full session-open (non-incremental)
 * hydrations, keyed by session id. Two callers can now race for the same
 * session's transcript — the workspace-open bootstrap fires a fire-and-forget
 * kickoff (hydration moved off the critical path) and SessionTranscriptPane's
 * self-hydration effect fires independently. Without dedupe both would fetch
 * AND both would apply history to the stores and emit the session_open flow
 * marks twice. Sharing the whole operation (fetch + replay + store + marks)
 * guarantees exactly one fetch and one apply; the second caller receives the
 * first caller's result. Only full opens dedupe here — incremental
 * append/prepend fetches (afterSeq/beforeSeq) target different ranges and must
 * not share.
 */
const inFlightSessionOpenHydrations = new Map<string, Promise<boolean>>();

export function resetSessionHistoryHydrationInFlightForTest(): void {
  inFlightSessionOpenHydrations.clear();
}

export interface SessionHistoryHydrationOptions {
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
  const reconcileHydratedSubagents = useSessionHistorySubagentAuthority();

  const runHydration = useCallback(async (
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
      // UX-latency R1 (Q17): a full (non-incremental) hydration is the
      // session_open flow, which emits ONLY through the renderer flow-timing
      // family; see session-open-flow-marks.ts for param construction and the
      // rationale for skipping the legacy measurement-operation/logLatency
      // emits here. Incremental append/prepend fetches are not a fresh open.
      const isSessionOpenFlow = afterSeq == null && beforeSeq == null;
      if (isSessionOpenFlow) {
        beginRendererFlow(buildSessionOpenBeginParams(sessionId));
        markRendererFlowShellCommitted(buildSessionOpenShellCommittedParams(sessionId));
      } else {
        standaloneMeasurementOperationId = startMeasurementOperation({
          kind: resolveHistoryApplyOperationKind({ afterSeq, beforeSeq }),
          surfaces: SESSION_APPLY_MEASUREMENT_SURFACES,
          maxDurationMs: SESSION_HISTORY_APPLY_MAX_DURATION_MS,
        });
      }
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
      if (isSessionOpenFlow) {
        markRendererFlowDataReady(buildSessionOpenDataReadyParams(sessionId, events.length));
      }
      const currentSlot = getSessionRecord(sessionId);
      if (!currentSlot || (options?.isCurrent && !options.isCurrent())) {
        finishStandaloneApplyOperation(standaloneMeasurementOperationId, "aborted");
        if (isSessionOpenFlow) {
          markSessionOpenFlowAbandoned(sessionId, "session_slot_changed");
        }
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
        recordHistoryApplyStepMetrics(historyApplyOperationIds, {
          phase: "replay",
          startedAt: replayStartedAt,
          count: events.length,
        });

        if (!nextState.applied) {
          const mountStartedAt = performance.now();
          if (!await reconcileHydratedSubagents({
            sessionId,
            parentSessionId: currentSlot.materializedSessionId ?? sessionId,
            workspaceId: currentSlot.workspaceId,
            events,
            transcript: currentSlot.transcript,
            requestHeaders: options?.requestHeaders,
            isCurrent: options?.isCurrent,
          })) {
            finishStandaloneApplyOperation(standaloneMeasurementOperationId, "aborted");
            return false;
          }
          recordHistoryApplyStepMetrics(historyApplyOperationIds, {
            phase: "mount_subagents",
            startedAt: mountStartedAt,
          });
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
        recordHistoryApplyStepMetrics(historyApplyOperationIds, {
          phase: "store",
          startedAt: storeStartedAt,
        });
        for (const operationId of historyApplyOperationIds) {
          recordHistoryStateCounts(
            operationId,
            "after",
            nextState.state.events,
            nextState.state.transcript,
          );
        }
        const mountStartedAt = performance.now();
        if (!await reconcileHydratedSubagents({
          sessionId,
          parentSessionId: currentSlot.materializedSessionId ?? sessionId,
          workspaceId: currentSlot.workspaceId,
          events,
          transcript: nextState.state.transcript,
          requestHeaders: options?.requestHeaders,
          isCurrent: options?.isCurrent,
        })) {
          finishStandaloneApplyOperation(standaloneMeasurementOperationId, "aborted");
          return false;
        }
        recordHistoryApplyStepMetrics(historyApplyOperationIds, {
          phase: "mount_subagents",
          startedAt: mountStartedAt,
        });
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
        recordHistoryApplyStepMetrics(historyApplyOperationIds, {
          phase: "replay",
          startedAt: replayStartedAt,
          count: events.length,
        });

        const storeStartedAt = performance.now();
        applyHistoryStateToStores(sessionId, currentSlot, {
          events: replacementEvents,
          transcript: nextState.transcript,
          reconcileEnvelopes: events,
        });
        recordHistoryApplyStepMetrics(historyApplyOperationIds, {
          phase: "store",
          startedAt: storeStartedAt,
        });
        for (const operationId of historyApplyOperationIds) {
          recordHistoryStateCounts(
            operationId,
            "after",
            replacementEvents,
            nextState.transcript,
          );
        }
        const mountStartedAt = performance.now();
        if (!await reconcileHydratedSubagents({
          sessionId,
          parentSessionId: currentSlot.materializedSessionId ?? sessionId,
          workspaceId: currentSlot.workspaceId,
          events,
          transcript: nextState.transcript,
          requestHeaders: options?.requestHeaders,
          isCurrent: options?.isCurrent,
        })) {
          finishStandaloneApplyOperation(standaloneMeasurementOperationId, "aborted");
          return false;
        }
        recordHistoryApplyStepMetrics(historyApplyOperationIds, {
          phase: "mount_subagents",
          startedAt: mountStartedAt,
        });
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
      recordHistoryApplyStepMetrics(historyApplyOperationIds, {
        phase: "replay",
        startedAt: replayStartedAt,
        count: replacementEvents.length,
      });
      const storeStartedAt = performance.now();
      applyHistoryStateToStores(sessionId, currentSlot, {
        events: nextState.events,
        transcript: nextState.transcript,
        reconcileEnvelopes: replacementEvents,
      });
      recordHistoryApplyStepMetrics(historyApplyOperationIds, {
        phase: "store",
        startedAt: storeStartedAt,
      });
      for (const operationId of historyApplyOperationIds) {
        recordHistoryStateCounts(
          operationId,
          "after",
          nextState.events,
          nextState.transcript,
        );
      }
      const mountStartedAt = performance.now();
      if (!await reconcileHydratedSubagents({
        sessionId,
        parentSessionId: currentSlot.materializedSessionId ?? sessionId,
        workspaceId: currentSlot.workspaceId,
        events: replacementEvents,
        transcript: nextState.transcript,
        requestHeaders: options?.requestHeaders,
        isCurrent: options?.isCurrent,
      })) {
        finishStandaloneApplyOperation(standaloneMeasurementOperationId, "aborted");
        if (isSessionOpenFlow) {
          markSessionOpenFlowAbandoned(sessionId, "session_slot_changed");
        }
        return false;
      }
      recordHistoryApplyStepMetrics(historyApplyOperationIds, {
        phase: "mount_subagents",
        startedAt: mountStartedAt,
      });
      finishStandaloneApplyOperation(standaloneMeasurementOperationId, "completed", true);
      if (isSessionOpenFlow) {
        // Phase timings rerouted from the removed measurement operation onto the
        // canonical content_stable mark (see session-open-flow-marks.ts).
        finishRendererFlow(buildSessionOpenFinishParams(sessionId, {
          eventCount: replacementEvents.length,
          replayStartedAt,
          storeStartedAt,
          mountStartedAt,
          finishedAt: performance.now(),
        }));
      }
      return true;
    } catch (error) {
      markSessionOpenFlowAbandoned(sessionId, "session_history_rehydrate_failed");
      reportSessionHistoryRehydrateFailure({
        error,
        sessionId,
        operationId: options?.measurementOperationId,
        afterSeq: options?.afterSeq,
        beforeSeq: options?.beforeSeq,
        limit: options?.limit,
        turnLimit: options?.turnLimit,
        timeoutMs: options?.timeoutMs,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
      finishStandaloneApplyOperation(standaloneMeasurementOperationId, "error_sanitized");
      return false;
    }
  }, [cloudClient, reconcileHydratedSubagents, ssh]);

  const rehydrateSessionSlotFromHistory = useCallback((
    sessionId: string,
    options?: SessionHistoryHydrationOptions,
  ): Promise<boolean> => {
    // Only full session-open hydrations dedupe (see inFlightSessionOpenHydrations).
    const isSessionOpenHydration =
      (options?.afterSeq ?? null) === null && (options?.beforeSeq ?? null) === null;
    if (!isSessionOpenHydration) {
      return runHydration(sessionId, options);
    }
    const inFlight = inFlightSessionOpenHydrations.get(sessionId);
    if (inFlight) {
      return inFlight;
    }
    const promise = runHydration(sessionId, options);
    inFlightSessionOpenHydrations.set(sessionId, promise);
    void promise.finally(() => {
      if (inFlightSessionOpenHydrations.get(sessionId) === promise) {
        inFlightSessionOpenHydrations.delete(sessionId);
      }
    });
    return promise;
  }, [runHydration]);

  return {
    rehydrateSessionSlotFromHistory,
  };
}
