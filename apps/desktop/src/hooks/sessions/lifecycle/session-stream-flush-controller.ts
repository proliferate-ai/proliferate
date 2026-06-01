import type { SessionEventEnvelope } from "@anyharness/sdk";
import {
  createFrameStreamBatchScheduler,
} from "@proliferate/product-domain/chats/transcript/stream-batcher";
import { logDevSessionRuntimeEvent } from "@/lib/infra/debug/session-runtime-dev-sse";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import { getSessionRecord } from "@/stores/sessions/session-records";
import { applySessionStreamFlushBatch } from "@/hooks/sessions/lifecycle/session-stream-flush-apply";
import type {
  SessionStreamFlushController,
  SessionStreamFlushControllerOptions,
  SessionStreamFlushFactoryDeps,
  SessionStreamFlushScheduler,
} from "@/hooks/sessions/lifecycle/session-stream-flush-types";

const SESSION_STREAM_FLUSH_MAX_PAINT_WAIT_MS = 50;
const SESSION_STREAM_FLUSH_WATCHDOG_MS = 250;

export const animationFrameSessionStreamFlushScheduler: SessionStreamFlushScheduler = {
  schedule(callback) {
    return createFrameStreamBatchScheduler({
      requestAnimationFrame: typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : undefined,
      cancelAnimationFrame: typeof cancelAnimationFrame === "function"
        ? cancelAnimationFrame
        : undefined,
      setTimeout,
      clearTimeout: (handle) => {
        clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
      },
      maxPaintWaitMs: SESSION_STREAM_FLUSH_MAX_PAINT_WAIT_MS,
    }).schedule(callback);
  },
};

export function createSessionStreamFlushController(
  input: SessionStreamFlushControllerOptions & SessionStreamFlushFactoryDeps,
): SessionStreamFlushController {
  const scheduler = input.scheduler ?? animationFrameSessionStreamFlushScheduler;
  let queue: SessionEventEnvelope[] = [];
  let cancelScheduledFlush: (() => void) | null = null;
  let flushWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clearFlushWatchdog = () => {
    if (!flushWatchdogTimer) {
      return;
    }
    clearTimeout(flushWatchdogTimer);
    flushWatchdogTimer = null;
  };

  const scheduleFlushWatchdog = () => {
    if (flushWatchdogTimer || disposed) {
      return;
    }
    flushWatchdogTimer = setTimeout(() => {
      flushWatchdogTimer = null;
      if (cancelScheduledFlush) {
        cancelScheduledFlush();
        cancelScheduledFlush = null;
      }
      logDevSessionRuntimeEvent(input.sessionId, "stream_flush_watchdog_fired", {
        queuedCount: queue.length,
        firstSeq: queue[0]?.seq ?? null,
        lastSeq: queue[queue.length - 1]?.seq ?? null,
      });
      flush();
    }, SESSION_STREAM_FLUSH_WATCHDOG_MS);
  };

  const scheduleFlush = () => {
    if (disposed) {
      return;
    }
    scheduleFlushWatchdog();
    if (cancelScheduledFlush) {
      return;
    }
    cancelScheduledFlush = scheduler.schedule(() => {
      cancelScheduledFlush = null;
      clearFlushWatchdog();
      flush();
    });
  };

  const flush = () => {
    if (disposed || queue.length === 0) {
      clearFlushWatchdog();
      return;
    }
    const envelopes = queue;
    queue = [];
    clearFlushWatchdog();

    const stillCurrent = input.isStillCurrent();
    const currentStream = input.isCurrentStream();
    if (!stillCurrent || !currentStream) {
      logLatency("session.stream.flush.dropped_stale", {
        sessionId: input.sessionId,
        envelopeCount: envelopes.length,
        firstSeq: envelopes[0]?.seq ?? null,
        lastSeq: envelopes[envelopes.length - 1]?.seq ?? null,
        stillCurrent,
        currentStream,
      });
      return;
    }

    const result = applySessionStreamFlushBatch(input, envelopes);
    if (!result?.applied) {
      return;
    }

    logDevSessionRuntimeEvent(input.sessionId, "stream_flush_finished", {
      lastSeqAfter: result.afterSeq,
      queuedCount: queue.length,
      shouldDisconnectForGap: result.shouldDisconnectForGap,
    });

    if (result.shouldDisconnectForGap) {
      reconcileGapAndReconnect(input, result.afterSeq);
    }
  };

  return {
    enqueue(envelope) {
      if (disposed) {
        return;
      }
      queue.push(envelope);
      scheduleFlush();
    },
    flushNow() {
      if (cancelScheduledFlush) {
        cancelScheduledFlush();
        cancelScheduledFlush = null;
      }
      clearFlushWatchdog();
      flush();
    },
    dispose() {
      disposed = true;
      queue = [];
      if (cancelScheduledFlush) {
        cancelScheduledFlush();
        cancelScheduledFlush = null;
      }
      clearFlushWatchdog();
    },
  };
}

function reconcileGapAndReconnect(
  input: SessionStreamFlushControllerOptions & SessionStreamFlushFactoryDeps,
  afterSeq: number,
): void {
  logDevSessionRuntimeEvent(input.sessionId, "stream_gap_reconcile_started", {
    afterSeq,
    lastObservedSeq: afterSeq,
  });
  const reconcileHistoryTail = input.rehydrateSessionSlotFromHistory(input.sessionId, {
    afterSeq,
    requestHeaders: input.requestHeaders,
    measurementOperationId: input.streamMeasurementOperationId,
    timeoutMs: 5_000,
    isCurrent: input.isStillCurrent,
  });
  void reconcileHistoryTail.then((applied) => {
    const slotAfterHistory = getSessionRecord(input.sessionId);
    logDevSessionRuntimeEvent(input.sessionId, "stream_gap_reconcile_finished", {
      applied,
      afterStatus: slotAfterHistory?.status ?? null,
      afterPhase: slotAfterHistory?.executionSummary?.phase ?? null,
      afterIsStreaming: slotAfterHistory?.transcript.isStreaming ?? null,
      afterLastSeq: slotAfterHistory?.transcript.lastSeq ?? null,
    });
  }).catch((error: unknown) => {
    logDevSessionRuntimeEvent(input.sessionId, "stream_gap_reconcile_failed", {
      errorName: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : String(error),
    });
  }).finally(() => {
    input.scheduleReconnect(0);
  });
  input.clearActiveSummaryRefreshTimer();
  input.closeCurrentHandle();
}
