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
  buildSessionHistoryFetchArgs,
  finishStandaloneApplyOperation,
  recordHistoryApplyStepMetrics,
  recordHistoryStateCounts,
  reportSessionHistoryRehydrateFailure,
  resolveHistoryApplyOperationKind,
  SESSION_APPLY_MEASUREMENT_SURFACES,
  SESSION_HISTORY_APPLY_MAX_DURATION_MS,
  type SessionHistoryHydrationOptions,
} from "#product/hooks/sessions/lifecycle/session-history-hydration-helpers";
import { useSessionHistorySubagentAuthority } from "#product/hooks/sessions/lifecycle/use-session-history-subagent-authority";
import { dedupeSessionOpenHydration } from "#product/hooks/sessions/lifecycle/session-history-hydration-dedupe";
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
import { dispatchWorkspacePinIntentEnvelopes } from "#product/hooks/sessions/lifecycle/workspace-pin-intent-dispatch";

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
        buildSessionHistoryFetchArgs({
          afterSeq,
          beforeSeq,
          limit: options?.limit,
          turnLimit: options?.turnLimit,
          requestHeaders: options?.requestHeaders,
          measurementOperationId: requestMeasurementOperationId,
          timeoutMs: options?.timeoutMs,
          ssh,
          cloudClient,
        }),
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
          dispatchWorkspacePinIntentEnvelopes(events, "history");
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
        dispatchWorkspacePinIntentEnvelopes(events, "history");
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
          events: nextState.events,
          transcript: nextState.transcript,
          reconcileEnvelopes: events,
        });
        dispatchWorkspacePinIntentEnvelopes(events, "history");
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
          totalEventCount: nextState.events.length,
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
      dispatchWorkspacePinIntentEnvelopes(replacementEvents, "history");
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

  // UX-latency R14: full session-open hydrations dedupe by session id so the
  // bootstrap kickoff and the transcript pane share one fetch + apply.
  const rehydrateSessionSlotFromHistory = useCallback((
    sessionId: string,
    options?: SessionHistoryHydrationOptions,
  ): Promise<boolean> => dedupeSessionOpenHydration(
    sessionId,
    options,
    () => runHydration(sessionId, options),
  ), [runHydration]);

  return {
    rehydrateSessionSlotFromHistory,
  };
}
