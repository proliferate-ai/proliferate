import { shouldSkipColdIdleSessionStream } from "@proliferate/product-domain/sessions/activity";
import {
  recordMeasurementMetric,
  recordMeasurementWorkflowStep,
} from "@/lib/infra/measurement/debug-measurement";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { getSessionRecord } from "@/stores/sessions/session-records";
import type {
  RefreshSessionSlotMeta,
  RehydrateSessionSlotFromHistory,
  SessionStreamConnectOptions,
} from "@/hooks/sessions/lifecycle/session-stream-connection-types";

interface PrepareSessionStreamConnectionDeps {
  refreshSessionSlotMeta: RefreshSessionSlotMeta;
  rehydrateSessionSlotFromHistory: RehydrateSessionSlotFromHistory;
}

export async function prepareSessionStreamConnection(
  sessionId: string,
  options: SessionStreamConnectOptions | undefined,
  deps: PrepareSessionStreamConnectionDeps,
): Promise<boolean> {
  if (options?.isCurrent && !options.isCurrent()) {
    return false;
  }
  const initialSlot = getSessionRecord(sessionId);
  if (!initialSlot) {
    return false;
  }

  if (!initialSlot.transcriptHydrated && options?.hydrateBeforeStream !== false) {
    const hydrateStartedAt = performance.now();
    await deps.rehydrateSessionSlotFromHistory(sessionId, {
      requestHeaders: options?.requestHeaders,
      measurementOperationId: options?.measurementOperationId,
      isCurrent: options?.isCurrent,
    });
    if (options?.isCurrent && !options.isCurrent()) {
      return false;
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
    return false;
  }

  if (
    !options?.forceReconnect
    && (
      slot.streamConnectionState === "connecting"
      || slot.streamConnectionState === "open"
    )
  ) {
    return false;
  }

  if (!options?.skipInitialRefresh) {
    const refreshStartedAt = performance.now();
    await deps.refreshSessionSlotMeta(sessionId, {
      resumeIfActive: options?.resumeIfActive ?? true,
      requestHeaders: options?.requestHeaders,
      measurementOperationId: options?.measurementOperationId,
      isCurrent: options?.isCurrent,
    });
    if (options?.isCurrent && !options.isCurrent()) {
      return false;
    }
    recordMeasurementWorkflowStep({
      operationId: options?.measurementOperationId,
      step: "session.stream.initial_refresh",
      startedAt: refreshStartedAt,
    });
  }

  const refreshedSlot = getSessionRecord(sessionId);
  if (options?.isCurrent && !options.isCurrent()) {
    return false;
  }
  if (shouldSkipColdIdleSessionStream(refreshedSlot, options?.allowColdIdleNoStream)) {
    recordMeasurementMetric({
      type: "workflow",
      operationId: options?.measurementOperationId ?? undefined,
      step: "session.stream.skip_cold_idle",
      durationMs: 0,
      outcome: "skipped",
    });
    return false;
  }

  return true;
}
