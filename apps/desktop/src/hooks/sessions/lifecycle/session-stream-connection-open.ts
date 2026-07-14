import type { SessionStreamHandle } from "@anyharness/sdk";
import type { DesktopSshBridge } from "@proliferate/product-client/host/desktop-bridge";
import { openSessionStream } from "@/lib/access/anyharness/session-runtime";
import {
  clearSessionStreamHandle,
  setSessionStreamHandle,
} from "@/lib/access/anyharness/session-stream-handles";
import { resetSessionReconnectBackoff } from "@/lib/workflows/sessions/session-reconnect-state";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import {
  finishOrCancelMeasurementOperation,
  recordMeasurementWorkflowStep,
  startMeasurementOperation,
} from "@/lib/infra/measurement/debug-measurement";
import { logDevSessionRuntimeEvent } from "@/lib/infra/debug/dev-session-runtime-log";
import { markLatencyFlowLiveAttached } from "@/lib/infra/measurement/latency-flow";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionIngestStore } from "@/stores/sessions/session-ingest-store";
import {
  getMaterializedSessionId,
  getSessionRecord,
} from "@/stores/sessions/session-records";
import {
  isCurrentStreamHandle,
  shouldReconnectStream,
} from "@/hooks/sessions/lifecycle/session-runtime-helpers";
import { createFlushAwareSessionStreamHandle } from "@/hooks/sessions/lifecycle/session-stream-handle";
import { createSessionStreamRefreshController } from "@/hooks/sessions/lifecycle/session-stream-connection-refresh";
import { scheduleSessionStreamReconnect } from "@/hooks/sessions/lifecycle/session-stream-connection-reconnect";
import type {
  RefreshSessionSlotMeta,
  SessionStreamConnectOptions,
  UseSessionStreamConnectionActionsOptions,
} from "@/hooks/sessions/lifecycle/session-stream-connection-types";

interface OpenSessionStreamConnectionInput {
  sessionId: string;
  ssh: DesktopSshBridge | null;
  options: SessionStreamConnectOptions | undefined;
  createSessionStreamFlushController:
    UseSessionStreamConnectionActionsOptions["createSessionStreamFlushController"];
  refreshSessionSlotMeta: RefreshSessionSlotMeta;
  ensureSessionStreamConnected: (
    sessionId: string,
    options?: SessionStreamConnectOptions,
  ) => Promise<void>;
}

export async function openSessionStreamConnection({
  sessionId,
  ssh,
  options,
  createSessionStreamFlushController,
  refreshSessionSlotMeta,
  ensureSessionStreamConnected,
}: OpenSessionStreamConnectionInput): Promise<void> {
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
  let streamConnectMeasurementFinished = false;
  let suppressNextCloseReconnect = false;
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

  const refreshController = createSessionStreamRefreshController({
    sessionId,
    options,
    streamMeasurementOperationId,
    refreshSessionSlotMeta,
    isStillCurrent,
    isCurrentStream: () => {
      const materializedSessionId = getMaterializedSessionId(sessionId);
      return !!handle
        && !!materializedSessionId
        && isCurrentStreamHandle(materializedSessionId, handle);
    },
  });
  const scheduleReconnect = (delayMs = 350) => {
    scheduleSessionStreamReconnect({
      sessionId,
      delayMs,
      options,
      refreshSessionSlotMeta,
      ensureSessionStreamConnected,
      isStillCurrent,
    });
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
      suppressNextCloseReconnect = true;
      handle?.close();
    },
    scheduleReconnect,
    clearActiveSummaryRefreshTimer: refreshController.clearActiveSummaryRefreshTimer,
    scheduleActiveSummaryRefresh: refreshController.scheduleActiveSummaryRefresh,
    scheduleStartupReadyRefresh: refreshController.scheduleStartupReadyRefresh,
  });

  await openSessionStream(sessionId, {
    afterSeq,
    requestHeaders: options?.requestHeaders,
    measurementOperationId: streamMeasurementOperationId ?? undefined,
    ssh,
    onHandle: (nextHandle) => {
      if (!isStillCurrent()) {
        logDevSessionRuntimeEvent(sessionId, "stream_handle_ignored_not_current", {});
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
        logDevSessionRuntimeEvent(sessionId, "stream_handle_closed_missing_materialized_id", {});
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
      logDevSessionRuntimeEvent(sessionId, "stream_handle_registered", {
        materializedSessionId,
        afterSeq,
      });
    },
    onOpen: () => {
      const materializedSessionId = getMaterializedSessionId(sessionId);
      if (!isStillCurrent() || !handle || !materializedSessionId || !isCurrentStreamHandle(materializedSessionId, handle)) {
        logDevSessionRuntimeEvent(sessionId, "stream_open_ignored", {
          hasHandle: !!handle,
          materializedSessionId,
          stillCurrent: isStillCurrent(),
        });
        return;
      }
      useSessionDirectoryStore.getState().patchEntry(sessionId, {
        streamConnectionState: "open",
      });
      resetSessionReconnectBackoff(sessionId);
      useSessionIngestStore.getState().markCurrentIfContiguous(
        sessionId,
        getSessionRecord(sessionId)?.transcript.lastSeq ?? 0,
      );
      markLatencyFlowLiveAttached(sessionId);
      logLatency("session.stream.open", {
        sessionId,
        elapsedMs: Math.round(performance.now() - connectStartedAt),
      });
      logDevSessionRuntimeEvent(sessionId, "stream_open", {
        materializedSessionId,
        afterSeq,
        currentLastSeq: getSessionRecord(sessionId)?.transcript.lastSeq ?? null,
      });
      recordMeasurementWorkflowStep({
        operationId: streamMeasurementOperationId,
        step: "session.stream.open",
        startedAt: connectStartedAt,
      });
      refreshController.scheduleStartupReadyRefresh("stream_open", 3500);
      resolveOpen?.();
      finishStreamConnectMeasurement("completed");
    },
    onEvent: (envelope) => {
      const materializedSessionId = getMaterializedSessionId(sessionId);
      if (!isStillCurrent() || !handle || !materializedSessionId || !isCurrentStreamHandle(materializedSessionId, handle)) {
        logDevSessionRuntimeEvent(sessionId, "stream_event_ignored", {
          seq: envelope.seq,
          eventType: envelope.event.type,
          hasHandle: !!handle,
          materializedSessionId,
          stillCurrent: isStillCurrent(),
        });
        return;
      }
      logDevSessionRuntimeEvent(sessionId, "stream_event_enqueued", {
        seq: envelope.seq,
        eventType: envelope.event.type,
        turnId: envelope.turnId ?? null,
        itemId: envelope.itemId ?? null,
        currentLastSeq: getSessionRecord(sessionId)?.transcript.lastSeq ?? null,
      });
      streamFlushController.enqueue(envelope);
    },
    onError: () => {
      logDevSessionRuntimeEvent(sessionId, "stream_error", {
        currentLastSeq: getSessionRecord(sessionId)?.transcript.lastSeq ?? null,
      });
      streamFlushController.flushNow();
      streamFlushController.dispose();
      finishStreamConnectMeasurement("aborted");
      resolveOpen?.();
      refreshController.clearStartupReadyRefreshTimer();
      refreshController.clearActiveSummaryRefreshTimer();
      const materializedSessionId = getMaterializedSessionId(sessionId);
      if (!isStillCurrent() || !handle || !materializedSessionId || !isCurrentStreamHandle(materializedSessionId, handle)) {
        logDevSessionRuntimeEvent(sessionId, "stream_error_ignored_after_flush", {
          hasHandle: !!handle,
          materializedSessionId,
          stillCurrent: isStillCurrent(),
        });
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
      logDevSessionRuntimeEvent(sessionId, "stream_close", {
        currentLastSeq: getSessionRecord(sessionId)?.transcript.lastSeq ?? null,
      });
      streamFlushController.flushNow();
      streamFlushController.dispose();
      finishStreamConnectMeasurement(openResolved ? "completed" : "aborted");
      resolveOpen?.();
      refreshController.clearStartupReadyRefreshTimer();
      refreshController.clearActiveSummaryRefreshTimer();
      const materializedSessionId = getMaterializedSessionId(sessionId);
      if (!isStillCurrent() || !handle || !materializedSessionId || !isCurrentStreamHandle(materializedSessionId, handle)) {
        logDevSessionRuntimeEvent(sessionId, "stream_close_ignored_after_flush", {
          hasHandle: !!handle,
          materializedSessionId,
          stillCurrent: isStillCurrent(),
        });
        return;
      }

      clearSessionStreamHandle(materializedSessionId, handle);
      if (suppressNextCloseReconnect) {
        suppressNextCloseReconnect = false;
        return;
      }
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
}
